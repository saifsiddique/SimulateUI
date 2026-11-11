"""The numerics of the Bloch solve that need nothing from abTEM (context.md M5, U5).

Worker processes of `bloch_sim.solve` import only this module: numpy and threadpoolctl, not abTEM,
which costs several seconds per process. `bloch_sim` re-exports every name here.
"""

from __future__ import annotations

import hashlib
import os
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import numpy as np
from threadpoolctl import threadpool_limits

Device = Literal["cpu", "gpu"]


def _xp(device: Device):
    if device == "gpu":
        import cupy

        return cupy
    return np


def _to_numpy(a):
    return a.get() if hasattr(a, "get") else np.asarray(a)


def tilt_rotation(tx, ty) -> np.ndarray:
    """Rotations (..., 3, 3) that take the incident direction (tx, ty) [rad] onto +z.

    The incident wavevector is k = k0 (sin-ish tx, ty, 1)/norm; applying R to the specimen-frame
    g vectors puts that k along +z, where abTEM's excitation-error formula applies.
    """
    tx = np.asarray(tx, dtype=float)
    ty = np.asarray(ty, dtype=float)
    k = np.stack([np.tan(tx), np.tan(ty), np.ones_like(tx)], axis=-1)
    k /= np.linalg.norm(k, axis=-1, keepdims=True)
    # Rodrigues: rotate k onto z about axis k x z.
    zhat = np.array([0.0, 0.0, 1.0])
    axis = np.cross(k, zhat)
    s = np.linalg.norm(axis, axis=-1)
    c = k[..., 2]
    R = np.broadcast_to(np.eye(3), k.shape[:-1] + (3, 3)).copy()
    nz = s > 1e-15
    if np.any(nz):
        a = axis[nz] / s[nz, None]
        K = np.zeros(a.shape[:-1] + (3, 3))
        K[..., 0, 1], K[..., 0, 2] = -a[..., 2], a[..., 1]
        K[..., 1, 0], K[..., 1, 2] = a[..., 2], -a[..., 0]
        K[..., 2, 0], K[..., 2, 1] = -a[..., 1], a[..., 0]
        sn = s[nz][:, None, None]
        cs = c[nz][:, None, None]
        R[nz] = np.eye(3) + sn * K + (1 - cs) * (K @ K)
    return R


@dataclass
class BlochSetup:
    energy: float  # eV
    wavelength: float  # Å
    hkl: np.ndarray  # (n, 3) int, the beams
    g: np.ndarray  # (n, 3) specimen-frame g vectors [1/Å], beam along +z
    U: np.ndarray  # (n, n) complex: structure-matrix off-diagonal (prefactor applied), diag 0
    k_max: float
    sg_max: float
    rotation: np.ndarray  # (3, 3) crystal -> specimen
    info: dict = field(default_factory=dict)

    @property
    def num_beams(self) -> int:
        return len(self.hkl)


def excitation_errors(g: np.ndarray, wavelength: float) -> np.ndarray:
    """abTEM's convention (k along +z): s_g = -(2 g_z + lambda |g|^2) / 2."""
    return (-2 * g[..., 2] - wavelength * np.sum(g * g, axis=-1)) / 2.0


def default_batch(n: int) -> int:
    """Tilts per eigen-solve batch: about 256 MB of working matrices."""
    return max(1, int(256 * 1024**2 // (4 * 16 * n * n)))


def _modes(setup: BlochSetup, tilts: np.ndarray, device: Device = "cpu", U=None):
    """The Bloch modes of a batch of incident directions, as numpy arrays.

    The Bloch equation (U + diag(2 k0 s_g)) C = 2 k0 gamma B C with B = diag(1 + g_z/k0) is
    symmetrised as in abTEM 1.0.11: with M = B^-1/2, A = M (U + diag(2 k0 s_g)) M is Hermitian,
    A = C' diag(v) C'^H, gamma = v lambda / 2, C = M C', and
    psi(z) = M C' exp(2 pi i gamma z) C'^H M^-1 psi0. No absorption, so `eigh` is used.
    Returns `B[t, i, j] = M_i C_ij alpha_j` (alpha = C^H M^-1 psi0) and `gamma[t, j]`: the beam
    amplitudes at depth z are then psi_i(z) = sum_j B_ij exp(2 pi i gamma_j z). Nothing here
    depends on the thickness, which is why a solve can be kept and reused for other depths.
    """
    xp = _xp(device)
    n = setup.num_beams
    k0 = 1.0 / setup.wavelength
    if U is None:
        U = xp.asarray(setup.U)
    Rt = tilt_rotation(tilts[:, 0], tilts[:, 1])
    g = np.einsum("tij,nj->tni", Rt, setup.g)  # (b, n, 3)
    sg = excitation_errors(g, setup.wavelength)
    Mii = 1.0 / np.sqrt(1.0 + g[..., 2] / k0)  # (b, n)
    Mx = xp.asarray(Mii)
    A = U[None] * (Mx[:, :, None] * Mx[:, None, :])
    idx = xp.arange(n)
    A[:, idx, idx] = xp.asarray(2 * k0 * sg * Mii**2)
    if device == "gpu":
        v, C = xp.linalg.eigh(A)
    else:
        # Multi-threaded BLAS is ~15x slower than one thread for matrices of a few hundred
        # beams (oversubscription); parallelism over tilts is by processes (`solve`).
        with threadpool_limits(1):
            v, C = xp.linalg.eigh(A)
    gamma = v * setup.wavelength / 2.0  # (b, n)
    alpha = xp.conj(C[:, 0, :]) / Mx[:, 0:1]  # direct beam first (prepare() guarantees it)
    B = Mx[:, :, None] * C * alpha[:, None, :]
    return _to_numpy(B), _to_numpy(gamma)


def _apply(B: np.ndarray, gamma: np.ndarray, z: np.ndarray, wavelength: float, device: Device = "cpu"):
    """Beam amplitudes (b, t, n) at the depths `z` from saved modes."""
    xp = _xp(device)
    phase = xp.exp(2j * np.pi * xp.asarray(z)[None, :, None] * xp.asarray(gamma)[:, None, :])
    return _to_numpy(xp.einsum("bij,btj->bti", xp.asarray(B), phase))


# ---- the saved solve ----------------------------------------------------------------------------

#: A saved solve larger than this is not kept (GB; also never more than half of the free disk).
CACHE_LIMIT_BYTES = int(float(os.environ.get("EMSIM_BLOCH_CACHE_GB", "16")) * 1024**3)


def mode_bytes(n_beams: int, n_tilts: int) -> int:
    """Size of a saved solve: B (complex) and gamma (real) for every incident direction."""
    return n_tilts * (16 * n_beams * n_beams + 8 * n_beams)


def mode_key(setup: BlochSetup, tilts: np.ndarray) -> str:
    """Identifies everything a solve depends on except the thickness and the device."""
    h = hashlib.sha1()
    h.update(repr((setup.energy, setup.wavelength, setup.k_max, setup.sg_max)).encode())
    for a in (setup.hkl, setup.g, setup.U, setup.rotation, np.asarray(tilts, dtype=float)):
        h.update(str(a.shape).encode())
        h.update(np.ascontiguousarray(a).tobytes())
    return h.hexdigest()


class _Entry:
    """One saved solve: two files in a private temporary directory."""

    def __init__(self, key: str, directory: Path, n_tilts: int, n_beams: int):
        self.key = key
        self.directory = directory
        self.m = n_tilts
        self.n = n_beams
        self.path_b = directory / "modes_B.dat"
        self.path_g = directory / "modes_gamma.dat"
        self.complete = False

    @property
    def nbytes(self) -> int:
        return mode_bytes(self.n, self.m)

    def allocate(self) -> None:
        for path, size in ((self.path_b, 16 * self.m * self.n * self.n), (self.path_g, 8 * self.m * self.n)):
            with open(path, "wb") as f:
                f.truncate(size)

    @contextmanager
    def maps(self, mode: str = "r"):
        """The two arrays as memory maps (closed afterwards, so the files can be deleted)."""
        B = np.memmap(self.path_b, dtype=np.complex128, mode=mode, shape=(self.m, self.n, self.n))
        g = np.memmap(self.path_g, dtype=np.float64, mode=mode, shape=(self.m, self.n))
        try:
            yield B, g
            if mode != "r":
                B.flush()
                g.flush()
        finally:
            for a in (B, g):
                try:
                    a._mmap.close()  # type: ignore[attr-defined]
                except Exception:
                    pass


# ---- the solve, in processes ----------------------------------------------------------------------

_WORKER: dict = {}


def _worker_init(setup: BlochSetup, entry: _Entry | None) -> None:
    _WORKER["setup"] = setup
    _WORKER["entry"] = entry
    _WORKER["U"] = np.asarray(setup.U)


def _worker_chunk(start: int, tilts: np.ndarray, thick: np.ndarray):
    setup = _WORKER["setup"]
    B, gamma = _modes(setup, tilts, "cpu", U=_WORKER["U"])
    entry = _WORKER["entry"]
    if entry is not None:
        with entry.maps("r+") as (Bm, gm):
            Bm[start : start + len(tilts)] = B
            gm[start : start + len(tilts)] = gamma
    return start, _apply(B, gamma, thick, setup.wavelength, "cpu")
