"""Bloch-wave simulations (context.md M5): SAED, CBED and LACBED.

Built on abTEM's `abtem.bloch` structure factors and conventions (beam along +z of the rotated
cell; De Graef's structure matrix with abTEM's relativistic prefactor). What is ours:

- orientation from a zone axis [uvw] (and an optional in-plane direction),
- beam selection for a whole set of incident tilts at once,
- a batched eigen-solver over incident tilts (CPU: numpy, GPU: cupy), with the off-diagonal
  structure matrix computed once and only the diagonal (excitation errors) changing per tilt,
- placing the beams of every tilt into CBED discs / per-beam LACBED discs.

All abTEM calls are in this file (context.md 5.3).
"""

from __future__ import annotations

import atexit
import math
import os
import shutil
import tempfile
import threading
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from ase import Atoms
from ase.cell import Cell

from abtem.bloch.dynamical import StructureFactor
from abtem.bloch.utils import get_reflection_condition, make_hkl_grid
from abtem.core.constants import kappa
from abtem.core.energy import energy2sigma, energy2wavelength

from .bloch_core import (  # noqa: F401  (re-exported)
    CACHE_LIMIT_BYTES,
    BlochSetup,
    Device,
    _apply,
    _Entry,
    _modes,
    _to_numpy,
    _worker_chunk,
    _worker_init,
    _xp,
    default_batch,
    excitation_errors,
    mode_bytes,
    mode_key,
    tilt_rotation,
)


# --------------------------------------------------------------------------------------------
# Orientation
# --------------------------------------------------------------------------------------------


def orientation_matrix(
    cell: np.ndarray, zone_axis: tuple[float, float, float], x_direction=None
) -> np.ndarray:
    """Rotation R whose rows are the specimen x, y, z axes in the crystal's Cartesian frame.

    z is along the zone axis [uvw] (cartesian M.uvw, ASE cell rows are a, b, c), so a vector v in
    the crystal frame has specimen coordinates R @ v. `x_direction` is an optional Cartesian
    vector projected onto the plane normal to z; by default the shortest reciprocal lattice
    vector perpendicular to z is used, then a or b.
    """
    cell = np.asarray(cell, dtype=float)
    z = np.asarray(zone_axis, dtype=float) @ cell
    z /= np.linalg.norm(z)
    candidates = []
    if x_direction is not None:
        candidates.append(np.asarray(x_direction, dtype=float))
    else:
        rec = np.linalg.inv(cell).T  # rows a*, b*, c*
        hkl = make_hkl_grid(Cell(cell), 3.0 * np.linalg.norm(rec, axis=1).max())
        g = hkl @ rec
        on_zone = np.abs(g @ z) < 1e-6 * np.linalg.norm(g, axis=1).clip(1e-12)
        g = g[on_zone & (np.linalg.norm(g, axis=1) > 1e-9)]
        if len(g):
            # Shortest first; ties broken towards +x, then +y for a reproducible choice.
            order = np.lexsort((-g[:, 1], -g[:, 0], np.round(np.linalg.norm(g, axis=1), 8)))
            candidates.append(g[order[0]])
    candidates += [cell[0], cell[1], np.array([1.0, 0, 0]), np.array([0, 1.0, 0])]
    for c in candidates:
        x = c - (c @ z) * z
        if np.linalg.norm(x) > 1e-6 * np.linalg.norm(c):
            x /= np.linalg.norm(x)
            break
    y = np.cross(z, x)
    return np.vstack([x, y, z])


# --------------------------------------------------------------------------------------------
# Setup: structure factors, beams, structure matrix
# --------------------------------------------------------------------------------------------


def potential_prefactor(energy: float) -> float:
    """Converts abTEM structure factors [Å] into the structure-matrix couplings U_g [1/Å^2]."""
    return energy2sigma(energy) / (kappa * energy2wavelength(energy) * np.pi)


def sigma_argument(atoms: Atoms, thermal_sigma):
    """abTEM's `thermal_sigma`: a number, or a dict by element. A dict is completed with 0 for the
    elements it does not list (a mixed site can leave one out of the specimen but not out of the
    unit cell)."""
    if isinstance(thermal_sigma, dict):
        return {el: float(thermal_sigma.get(el, 0.0)) for el in set(atoms.get_chemical_symbols())}
    return 0.0 if thermal_sigma is None else float(thermal_sigma)


def _structure_factor_table(atoms, g_max_sf, parametrization, thermal_sigma, occupancy):
    # centering "P": keep every hkl; systematic absences come out as zero structure factors.
    sf = StructureFactor(
        atoms,
        g_max=g_max_sf,
        parametrization=parametrization,
        thermal_sigma=sigma_argument(atoms, thermal_sigma),
        occupancy=1.0 if occupancy is None else occupancy,
        cutoff="taper",
        device="cpu",
        centering="P",
    )
    built = sf.build(lazy=False)
    arr = _to_numpy(built.array)
    table = {tuple(int(v) for v in h): arr[i] for i, h in enumerate(sf.hkl)}
    return table, sf.hkl


def prepare(
    atoms: Atoms,
    zone_axis: tuple[float, float, float],
    energy: float,
    k_max: float = 2.0,
    sg_max: float = 0.05,
    tilts: np.ndarray | None = None,
    x_direction=None,
    parametrization: str = "lobato",
    thermal_sigma: float | dict | None = None,
    occupancy: float | dict | None = None,
    centering: str = "P",
    hkl: np.ndarray | None = None,
    full_matrix: bool = True,
) -> BlochSetup:
    """Structure factors, beam selection and the off-diagonal structure matrix.

    Beams: |g| < k_max, allowed by `centering`, and |s_g| < sg_max for at least one incident
    direction in `tilts` ((m, 2) rad; default: only the zone axis). Pass `hkl` to fix the beams.
    Couplings U_{g-h} are computed out to 2 k_max (taper beyond 0.95 of 2.2 k_max), so every pair
    of beams couples. `thermal_sigma` [Å] (Debye-Waller) and `occupancy` are a number, a
    per-element dict or a per-atom sequence, as abTEM's StructureFactor accepts them.
    """
    cell = np.asarray(atoms.cell.array, dtype=float)
    R = orientation_matrix(cell, zone_axis, x_direction)
    rec = np.linalg.inv(cell).T
    wavelength = energy2wavelength(energy)

    if hkl is None:
        cand = make_hkl_grid(atoms.cell, k_max)
        cand = cand[get_reflection_condition(cand, centering)]
        g = (cand @ rec) @ R.T
        if tilts is None or len(tilts) == 0:
            sg = excitation_errors(g, wavelength)
            keep = np.abs(sg) < sg_max
        else:
            keep = np.zeros(len(cand), dtype=bool)
            Rt = tilt_rotation(tilts[:, 0], tilts[:, 1])
            for start in range(0, len(Rt), 256):
                gt = np.einsum("tij,nj->tni", Rt[start : start + 256], g)
                keep |= (np.abs(excitation_errors(gt, wavelength)) < sg_max).any(axis=0)
        keep |= np.all(cand == 0, axis=1)
        hkl = cand[keep]
    hkl = np.asarray(hkl, dtype=int)
    # Put the direct beam first.
    order = np.argsort(~np.all(hkl == 0, axis=1), kind="stable")
    hkl = hkl[order]
    g = (hkl @ rec) @ R.T

    table, _ = _structure_factor_table(atoms, 2.2 * k_max, parametrization, thermal_sigma,
                                       occupancy)
    U = np.zeros((len(hkl), len(hkl)), dtype=np.complex128)
    pre = potential_prefactor(energy)
    if full_matrix:
        gmh = hkl[:, None, :] - hkl[None, :, :]
        for i in range(len(hkl)):
            for j in range(len(hkl)):
                if i != j:
                    U[i, j] = table.get(tuple(int(v) for v in gmh[i, j]), 0.0) * pre
    else:
        # Preview only needs each beam's coupling to the direct beam, not the n² matrix.
        for i, h in enumerate(hkl):
            key = tuple(int(v) for v in h)
            if key != (0, 0, 0):
                U[i, 0] = table.get(key, 0.0) * pre

    return BlochSetup(
        energy=energy,
        wavelength=wavelength,
        hkl=hkl,
        g=g,
        U=U,
        k_max=k_max,
        sg_max=sg_max,
        rotation=R,
        info={"parametrization": parametrization, "thermal_sigma": thermal_sigma},
    )


# --------------------------------------------------------------------------------------------
# Solver
# --------------------------------------------------------------------------------------------


#: The one folder for temporary solves. Its contents are deleted when the program starts and when
#: it exits (`purge_cache_dir`), so a crash cannot leave gigabytes behind for long.
CACHE_DIR = Path(tempfile.gettempdir()) / "emsim-cache"


def purge_cache_dir() -> None:
    """Delete everything in the temporary folder (and the folder), and the `temp` folders that runs
    leave in their own folders (a run keeps its saved solve in <run folder>/temp)."""
    shutil.rmtree(CACHE_DIR, ignore_errors=True)
    try:
        from . import jobs

        for t in jobs.projects_dir().glob("*/*/*/temp"):
            shutil.rmtree(t, ignore_errors=True)
    except Exception:  # a failed clean-up must never stop the program from starting or ending
        pass


class ModeCache:
    """The Bloch modes of the last solve, kept in a temporary file.

    Changing only the thickness (or the list of thicknesses) needs no new eigen-solve: the modes
    are read back and only the phases change. The file is removed as soon as a solve with other
    parameters is saved, with `clear()`, and when the program exits. At most one solve is kept.
    """

    def __init__(self, base_dir: str | os.PathLike | None = None, limit_bytes: int | None = None):
        self._base = str(CACHE_DIR if base_dir is None else base_dir)
        self.limit_bytes = CACHE_LIMIT_BYTES if limit_bytes is None else limit_bytes
        self._entry: _Entry | None = None
        self._lock = threading.RLock()
        atexit.register(self.clear)

    def lookup(self, key: str) -> _Entry | None:
        with self._lock:
            e = self._entry
            return e if e is not None and e.complete and e.key == key else None

    def fits(self, n_beams: int, n_tilts: int) -> bool:
        need = mode_bytes(n_beams, n_tilts)
        if need > self.limit_bytes:
            return False
        try:
            base = Path(self._base)
            while not base.exists() and base != base.parent:
                base = base.parent
            free = shutil.disk_usage(base).free
        except OSError:
            return False
        return need <= 0.5 * free

    def begin(self, key: str, n_tilts: int, n_beams: int) -> _Entry | None:
        """Start saving a solve (the previous one is deleted); None if it would not fit."""
        with self._lock:
            if not self.fits(n_beams, n_tilts):
                return None
            self.clear()
            Path(self._base).mkdir(parents=True, exist_ok=True)
            directory = Path(tempfile.mkdtemp(prefix="emsim-bloch-", dir=self._base))
            e = _Entry(key, directory, n_tilts, n_beams)
            try:
                e.allocate()
            except OSError:
                shutil.rmtree(directory, ignore_errors=True)
                return None
            self._entry = e
            return e

    def finish(self, entry: _Entry) -> None:
        with self._lock:
            entry.complete = True

    def abort(self, entry: _Entry) -> None:
        with self._lock:
            if self._entry is entry:
                self.clear()

    def clear(self) -> None:
        with self._lock:
            e, self._entry = self._entry, None
        if e is not None:
            shutil.rmtree(e.directory, ignore_errors=True)
            if e.directory.parent.name == "temp":  # a run's temp folder, now empty
                try:
                    e.directory.parent.rmdir()
                except OSError:
                    pass

    def export(self) -> dict | None:
        """Where the saved solve is, so another process can use it (see `adopt`)."""
        e = self._entry
        if e is None or not e.complete:
            return None
        return {"key": e.key, "directory": str(e.directory), "n_tilts": e.m, "n_beams": e.n}

    def adopt(self, saved: dict | None) -> None:
        """Take over a solve another process saved (`export`); None forgets the current one.
        The files are not deleted by this call."""
        with self._lock:
            self._entry = None
            if saved and Path(saved["directory"]).is_dir():
                e = _Entry(saved["key"], Path(saved["directory"]), saved["n_tilts"], saved["n_beams"])
                e.complete = True
                self._entry = e

    @property
    def info(self) -> dict:
        e = self._entry
        return {"saved": bool(e and e.complete), "bytes": e.nbytes if e and e.complete else 0,
                "directory": str(e.directory.parent) if e and e.complete else str(CACHE_DIR)}


#: The solve the app keeps (the Run step, M6, passes it as `cache`); the Compute tab shows and
#: deletes it.
CACHE = ModeCache()
atexit.register(purge_cache_dir)


def solve(
    setup: BlochSetup,
    thicknesses,
    tilts: np.ndarray | None = None,
    device: Device = "cpu",
    batch: int | None = None,
    progress=None,
    workers: int = 1,
    cache: ModeCache | None = None,
    min_parallel_seconds: float = 4.0,
) -> tuple[np.ndarray, dict]:
    """Complex beam amplitudes, shape (m_tilts, n_thickness, n_beams) (m = 1 without tilts), and
    what was done: `{"reused": bool, "saved": bool, "workers": int, "seconds": float}`.

    With a `cache` the modes are saved, and a later call with the same setup and tilts and other
    thicknesses reads them back instead of solving again. `workers` > 1 solves the tilts in that
    many processes (CPU only; every process uses one BLAS thread). A solve estimated at less than
    `min_parallel_seconds` on one process stays in this one: starting processes costs about two
    seconds. Measured on Si [110] (235 beams, 797 directions): 1.9x with 2 processes, 2.8x with 4 to 8.
    """
    import time

    t0 = time.perf_counter()
    thick = np.atleast_1d(np.asarray(thicknesses, dtype=float))
    tilts = np.zeros((1, 2)) if tilts is None else np.asarray(tilts, dtype=float).reshape(-1, 2)
    n = setup.num_beams
    m = len(tilts)
    batch = default_batch(n) if batch is None else batch
    out = np.zeros((m, len(thick), n), dtype=np.complex128)
    info = {"reused": False, "saved": False, "workers": 1}

    key = mode_key(setup, tilts) if cache is not None else None
    entry = cache.lookup(key) if cache is not None else None
    if entry is not None:
        with entry.maps("r") as (B, gamma):
            for start in range(0, m, batch):
                sl = slice(start, min(start + batch, m))
                out[sl] = _apply(np.asarray(B[sl]), np.asarray(gamma[sl]), thick, setup.wavelength, device)
                if progress is not None:
                    progress(sl.stop, m)
        info.update(reused=True, saved=True, seconds=time.perf_counter() - t0)
        return out, info

    writer = cache.begin(key, m, n) if cache is not None else None
    try:
        if (workers > 1 and device == "cpu" and m > 1
                and 2.0e-9 * n**3 * m >= min_parallel_seconds):
            w = min(workers, m)
            chunk = max(1, min(batch, math.ceil(m / (2 * w))))
            with ProcessPoolExecutor(max_workers=w, initializer=_worker_init,
                                     initargs=(setup, writer)) as pool:
                futures = [pool.submit(_worker_chunk, s, tilts[s : s + chunk], thick)
                           for s in range(0, m, chunk)]
                done = 0
                for f in as_completed(futures):
                    start, psi = f.result()
                    out[start : start + len(psi)] = psi
                    done += len(psi)
                    if progress is not None:
                        progress(done, m)
            info["workers"] = w
        else:
            xp = _xp(device)
            U = xp.asarray(setup.U)
            maps = writer.maps("r+") if writer is not None else None
            Bm, gm = maps.__enter__() if maps is not None else (None, None)
            try:
                for start in range(0, m, batch):
                    sl = slice(start, min(start + batch, m))
                    B, gamma = _modes(setup, tilts[sl], device, U=U)
                    if Bm is not None:
                        Bm[sl] = B
                        gm[sl] = gamma
                    out[sl] = _apply(B, gamma, thick, setup.wavelength, device)
                    if progress is not None:
                        progress(sl.stop, m)
            finally:
                if maps is not None:
                    maps.__exit__(None, None, None)
    except BaseException:
        if writer is not None:
            cache.abort(writer)
        raise
    if writer is not None:
        cache.finish(writer)
        info["saved"] = True
    info["seconds"] = time.perf_counter() - t0
    return out, info


def amplitudes(
    setup: BlochSetup,
    thicknesses,
    tilts: np.ndarray | None = None,
    device: Device = "cpu",
    batch: int | None = None,
    progress=None,
    workers: int = 1,
    cache: ModeCache | None = None,
) -> np.ndarray:
    """Complex beam amplitudes, shape (m_tilts, n_thickness, n_beams); see `solve`."""
    return solve(setup, thicknesses, tilts, device, batch, progress, workers, cache)[0]


# --------------------------------------------------------------------------------------------
# SAED
# --------------------------------------------------------------------------------------------


@dataclass
class SpotPattern:
    hkl: np.ndarray  # (n, 3)
    qxy: np.ndarray  # (n, 2) specimen-frame position [1/Å]
    thicknesses: np.ndarray  # (t,)
    intensity: np.ndarray  # (t, n)


def saed(
    setup: BlochSetup, thicknesses, device: Device = "cpu", workers: int = 1,
    cache: ModeCache | None = None,
) -> SpotPattern:
    psi = amplitudes(setup, thicknesses, device=device, workers=workers, cache=cache)[0]
    return SpotPattern(
        hkl=setup.hkl.copy(),
        qxy=setup.g[:, :2].copy(),
        thicknesses=np.atleast_1d(np.asarray(thicknesses, dtype=float)),
        intensity=np.abs(psi) ** 2,
    )


# --------------------------------------------------------------------------------------------
# CBED / LACBED
# --------------------------------------------------------------------------------------------


def disc_tilts(alpha_mrad: float, pixel_size: float, wavelength: float):
    """Incident directions on the pixel grid inside the condenser aperture.

    Returns (pixels (m, 2) int, tilts (m, 2) rad, radius_px). A pixel of `pixel_size` [1/Å]
    corresponds to an angle of pixel_size * wavelength.
    """
    r = int(np.round(alpha_mrad * 1e-3 / wavelength / pixel_size))
    ij = np.stack(np.meshgrid(np.arange(-r, r + 1), np.arange(-r, r + 1), indexing="ij"), -1)
    ij = ij.reshape(-1, 2)
    ij = ij[np.hypot(ij[:, 0], ij[:, 1]) <= r]
    return ij, ij * pixel_size * wavelength, r


@dataclass
class CBEDResult:
    thicknesses: np.ndarray
    images: np.ndarray  # (t, N, N) for CBED
    pixel_size: float  # 1/Å
    center: tuple[int, int]
    mask: np.ndarray  # (N, N) covered pixels
    hkl: np.ndarray
    discs: dict | None = None  # LACBED: hkl tuple -> (t, D, D)


def cbed(
    atoms: Atoms,
    zone_axis,
    energy: float,
    alpha_mrad: float,
    thicknesses,
    pixel_size: float,
    k_max: float = 2.0,
    sg_max: float = 0.05,
    pattern_size: float | None = None,
    lacbed: bool = False,
    lacbed_beams=None,
    device: Device = "cpu",
    progress=None,
    workers: int = 1,
    cache: ModeCache | None = None,
    **prepare_kwargs,
) -> CBEDResult:
    """CBED (discs placed at g + tilt and summed incoherently) or LACBED (one disc per beam).

    `pattern_size` [1/Å] is the half-width of the CBED image (default: k_max + 2 alpha).
    LACBED returns, for each beam (or those in `lacbed_beams`), its intensity over the incident
    directions as a (2r+1)^2 disc; `images` then holds the bright-field disc (000).
    """
    wavelength = energy2wavelength(energy)
    pix, tilts, r = disc_tilts(alpha_mrad, pixel_size, wavelength)
    setup = prepare(atoms, zone_axis, energy, k_max=k_max, sg_max=sg_max, tilts=tilts,
                    **prepare_kwargs)
    thick = np.atleast_1d(np.asarray(thicknesses, dtype=float))
    intens = np.abs(amplitudes(setup, thick, tilts=tilts, device=device, progress=progress,
                               workers=workers, cache=cache)) ** 2

    if lacbed:
        D = 2 * r + 1
        wanted = None if lacbed_beams is None else {tuple(int(v) for v in h) for h in lacbed_beams}
        discs = {}
        for b, h in enumerate(setup.hkl):
            key = tuple(int(v) for v in h)
            if wanted is not None and key not in wanted:
                continue
            img = np.zeros((len(thick), D, D))
            img[:, pix[:, 0] + r, pix[:, 1] + r] = intens[:, :, b].T
            discs[key] = img
        mask = np.zeros((D, D), dtype=bool)
        mask[pix[:, 0] + r, pix[:, 1] + r] = True
        bf = discs.get((0, 0, 0), np.zeros((len(thick), D, D)))
        return CBEDResult(thick, bf, pixel_size, (r, r), mask, setup.hkl, discs)

    half = pattern_size if pattern_size is not None else k_max + 2 * r * pixel_size
    N = 2 * int(np.ceil(half / pixel_size)) + 1
    c = N // 2
    images = np.zeros((len(thick), N, N))
    mask = np.zeros((N, N), dtype=bool)
    gpix = np.round(setup.g[:, :2] / pixel_size).astype(int)  # (n, 2)
    for t_i, (pi, pj) in enumerate(pix):
        x = gpix[:, 0] + pi + c
        y = gpix[:, 1] + pj + c
        ok = (x >= 0) & (y >= 0) & (x < N) & (y < N)
        mask[x[ok], y[ok]] = True
        np.add.at(images, (slice(None), x[ok], y[ok]), intens[t_i][:, ok])
    return CBEDResult(thick, images, pixel_size, (c, c), mask, setup.hkl)


def disc_count(r: int) -> int:
    """Pixels of the integer grid inside a disc of radius r (as `disc_tilts` builds it)."""
    if r <= 0:
        return 1
    i = np.arange(-r, r + 1)
    return int(np.sum(2 * np.floor(np.sqrt(r * r - i * i)).astype(int) + 1))


def disc_edge_tilts(alpha_mrad: float, pixel_size: float, wavelength: float, n: int = 720):
    """The centre and the rim of the condenser disc (rad): the excitation error is linear in the
    tilt, so the beams that any tilt in the disc excites are found from the rim alone."""
    r = int(np.round(alpha_mrad * 1e-3 / wavelength / pixel_size))
    if r <= 0:
        return np.zeros((1, 2)), r
    ang = np.linspace(0.0, 2 * np.pi, n, endpoint=False)
    rim = r * pixel_size * wavelength * np.stack([np.cos(ang), np.sin(ang)], axis=1)
    return np.vstack([np.zeros((1, 2)), rim]), r


def preview_pattern(
    atoms: Atoms,
    zone_axis,
    energy_ev: float,
    k_max: float = 2.0,
    sg_max: float = 0.02,
    sim_type: str = "saed",
    alpha_mrad: float = 4.0,
    pixel_size: float = 0.02,
    thermal_sigma: float | dict | None = None,
    workers: int = 1,
) -> dict:
    """Beams inside k_max and |s_g|, with kinematic weights. No eigen-solve.

    CBED and LACBED keep every beam that any incident direction of the disc excites (so the count,
    and the time, are those of the run). The solve time is estimated from n^3 per incident
    direction (about 30 ms for 260 beams on one CPU thread, measured for Si [110]); `workers`
    processes share the directions. The saved solve (`ModeCache`) that lets a change of thickness
    skip the eigen-solve is `cache_bytes` big.
    """
    wavelength = energy2wavelength(energy_ev)
    convergent = sim_type in ("cbed", "lacbed") and alpha_mrad > 0
    tilts, r = None, 0
    n_tilts = 1
    if convergent:
        tilts, r = disc_edge_tilts(alpha_mrad, pixel_size, wavelength)
        n_tilts = disc_count(r)
    setup = prepare(
        atoms, zone_axis, energy_ev, k_max=k_max, sg_max=sg_max, tilts=tilts,
        thermal_sigma=thermal_sigma, full_matrix=False,
    )
    weight = np.abs(setup.U[:, 0]) ** 2
    if weight.max() > 0:
        weight = weight / weight.max()
    sg = excitation_errors(setup.g, setup.wavelength)
    used = max(1, min(int(workers), n_tilts))
    seconds = 2.0e-9 * setup.num_beams ** 3 * n_tilts / used
    cache_bytes = mode_bytes(setup.num_beams, n_tilts)
    warnings: list[str] = []
    if seconds > 600:
        warnings.append(
            f"The solve is estimated at {seconds / 60:.0f} min "
            f"({setup.num_beams} beams x {n_tilts} incident directions, {used} "
            f"process{'es' if used > 1 else ''}). A coarser pattern pixel "
            "(fewer directions) or a smaller k max (fewer beams) shortens it."
        )
    if convergent and r < 6:
        finer = alpha_mrad * 1e-3 / wavelength / 10
        warnings.append(
            f"The discs are only {2 * r + 1} pixels across, so they come out as small polygons, "
            f"not circles. A pattern pixel of about {finer:.3f} Å⁻¹ gives 10 pixels in the radius "
            "(more incident directions, a longer solve)."
        )
    if setup.num_beams > 1500:
        warnings.append(
            f"{setup.num_beams} beams: the matrix solve grows with the cube of the beam count. "
            "Lower k max or |s_g| max."
        )
    return {
        "n_beams": setup.num_beams,
        "k_max": k_max,
        "sg_max": sg_max,
        "wavelength": setup.wavelength,
        "n_tilts": n_tilts,
        "disc_radius_px": r,
        "workers": used,
        "seconds": float(seconds),
        # A saved solve lets a change of thickness skip the eigen-solve (see `ModeCache`).
        "cache_bytes": int(cache_bytes),
        "cache_limit_bytes": int(CACHE_LIMIT_BYTES),
        "cache_fits": bool(cache_bytes <= CACHE_LIMIT_BYTES),
        "warnings": warnings,
        "beams": [
            {
                "hkl": [int(v) for v in setup.hkl[i]],
                "q": [float(setup.g[i, 0]), float(setup.g[i, 1])],
                "g": float(np.linalg.norm(setup.g[i])),
                "sg": float(sg[i]),
                "kinematic": float(weight[i]),
            }
            for i in range(setup.num_beams)
        ],
    }


def structure_factors(
    atoms: Atoms,
    zone_axis,
    energy_ev: float,
    g_max: float = 5.0,
    sg_cap: float = 0.1,
    thermal_sigma: float | dict | None = None,
    parametrization: str = "lobato",
    limit: int = 20000,
) -> dict:
    """The kinematic structure factors |F_g| (abTEM's, in Å) of the reflections seen along a zone
    axis, out to `g_max`: every reflection of the zero-order Laue zone, and those of higher zones
    that lie within `sg_cap` of the Ewald sphere at the zone axis. Positions are in the specimen
    frame (beam along +z), so they match the pattern drawn in the UI. Systematic absences come out
    as zero. Beyond `limit` reflections only the strongest are kept (`truncated`)."""
    cell = np.asarray(atoms.cell.array, dtype=float)
    R = orientation_matrix(cell, zone_axis)
    rec = np.linalg.inv(cell).T
    wavelength = energy2wavelength(energy_ev)
    hkl = make_hkl_grid(atoms.cell, g_max)
    g = (hkl @ rec) @ R.T
    sg = excitation_errors(g, wavelength)
    zolz = np.abs(g[:, 2]) < 1e-6
    keep = (np.linalg.norm(g, axis=1) <= g_max) & (zolz | (np.abs(sg) < sg_cap))
    hkl, g, sg, zolz = hkl[keep], g[keep], sg[keep], zolz[keep]
    # the table only needs g_max; abTEM's taper starts at 0.95 of its cutoff
    table, _ = _structure_factor_table(atoms, 1.1 * g_max, parametrization, thermal_sigma, None)
    f = np.array([abs(table.get(tuple(int(v) for v in h), 0.0)) for h in hkl])
    truncated = len(f) > limit
    if truncated:
        top = np.argsort(-f)[:limit]
        top = np.union1d(top, np.flatnonzero(np.all(hkl == 0, axis=1)))
        hkl, g, sg, zolz, f = hkl[top], g[top], sg[top], zolz[top], f[top]
    gn = np.linalg.norm(g, axis=1)
    order = np.argsort(gn, kind="stable")
    return {
        "wavelength": wavelength,
        "g_max": g_max,
        "n": int(len(order)),
        "truncated": bool(truncated),
        "f_max": float(f[gn > 1e-9].max(initial=0.0)),
        "refl": [
            {
                "hkl": [int(v) for v in hkl[i]],
                "q": [float(g[i, 0]), float(g[i, 1])],
                "g": float(gn[i]),
                "sg": float(sg[i]),
                "zolz": bool(zolz[i]),
                "f": float(f[i]),
            }
            for i in order
        ],
    }
