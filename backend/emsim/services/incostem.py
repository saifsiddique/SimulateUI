"""INCOSTEM: incoherent ADF-STEM images of very thin specimens (context.md §5.5, §7.MU step U6).

The model is Kirkland's (Advanced Computing in Electron Microscopy, 2nd ed., ch. 5-6), written
here from the published equations. No code of the book's programs is used or translated; the
original program was run only to make reference images for the tests.

    I(r) = [ PSF  (*)  O ](r),      O(r) = sum_j occ_j sigma(Z_j) delta(r - r_j)

* O: every atom of the specimen, projected along the beam (x, y only), deposited on the image grid
  over its four nearest pixels (bilinear), with wrap-around: the specimen is periodic.
* sigma(Z): the partial cross section of one atom for the detector, in A^2,
  sigma = 2 pi  int_{theta_min}^{theta_max} theta |f(theta / lambda)|^2 d theta, where the scattering
  amplitude of the atom in the phase-grating (Moliere) approximation is
  f(k) = (2 pi / lambda) int_0^{r_max} r J0(2 pi k r) [ sin(s v(r)) + i (1 - cos(s v(r))) ] dr,
  v(r) the projected atomic potential (V A), s the interaction parameter (rad / (V A)), r_max = 6 A.
* PSF: the intensity of the probe (aperture alpha, all the aberrations of the multislice, abTEM's
  names and sign conventions), normalised to a total of 1, averaged over a Gaussian spread of
  defocus, convolved with a Gaussian source, and with its transfer set to zero beyond 2 alpha /
  lambda (the intensity of a band-limited probe has no frequencies above that).

So a pixel of the image is the fraction of the incident electrons that the atoms in the probe
scatter onto the detector. Noise: counts = Poisson(I x probe current x dwell time / e).

The model ignores channelling and multiple scattering: it is right for a few atoms in a column.
"""

from __future__ import annotations

import base64
import time
from functools import lru_cache
from typing import Any

import numpy as np
from ase import Atoms
from ase.data import atomic_numbers, chemical_symbols
from scipy.special import j0

from . import abtem_sim
from .abtem_sim import display_orientation, radial_profile, wavelength_a

#: Radius to which the atomic scattering amplitude is integrated (Å).
R_MAX = 6.0
#: Above this thickness (Å) the incoherent model is not trusted.
THIN_LIMIT = 50.0
#: Largest image grid for the whole box (pixels in x * y).
MAX_GRID_PIXELS = 4096 * 4096
#: Electrons per pA per µs.
ELECTRONS_PER_PA_US = 6.24146
FWHM_TO_SIGMA = 1.0 / (2.0 * np.sqrt(2.0 * np.log(2.0)))
#: Gauss-Hermite points of the defocus spread.
N_DEFOCUS = 9


def _xp(device: str):
    if device == "gpu":
        import cupy

        return cupy
    return np


def _to_numpy(a):
    return a.get() if hasattr(a, "get") else np.asarray(a)


# --------------------------------------------------------------------------------------------
# Partial cross sections
# --------------------------------------------------------------------------------------------


def _projected_potential(symbol: str, parametrization: str):
    from abtem.parametrizations import KirklandParametrization, LobatoParametrization

    table = {"kirkland": KirklandParametrization, "lobato": LobatoParametrization}
    if parametrization not in table:
        raise ValueError(f"Unknown parametrization {parametrization!r} (kirkland or lobato).")
    return table[parametrization]().projected_potential(symbol)


@lru_cache(maxsize=512)
def cross_section(
    symbol: str, energy_kv: float, theta_min: float, theta_max: float,
    parametrization: str = "kirkland",
) -> float:
    """Partial cross section (Å²) of one atom for the annulus theta_min..theta_max (rad)."""
    if symbol not in atomic_numbers:
        raise ValueError(f"Unknown element {symbol!r}.")
    if not (0.0 <= theta_min < theta_max):
        raise ValueError("The detector needs 0 <= inner angle < outer angle.")
    from abtem.core.energy import energy2sigma

    lam = wavelength_a(energy_kv)
    s = float(energy2sigma(energy_kv * 1e3))
    v = _projected_potential(symbol, parametrization)
    # r on a log grid from 1e-5 Å (the potential is log-singular at 0, integrably) to R_MAX
    r = np.geomspace(1e-5, R_MAX, 6000)
    phase = s * np.asarray(v(r), dtype=float)
    re, im = np.sin(phase), 1.0 - np.cos(phase)
    # Gauss-Legendre in theta; |f|^2 is smooth on the scale of the ringing of the finite r_max
    n = int(np.clip(60 * (theta_max - theta_min) / lam * R_MAX * 0.3, 200, 1500))
    x, w = np.polynomial.legendre.leggauss(n)
    theta = 0.5 * (theta_max - theta_min) * x + 0.5 * (theta_max + theta_min)
    wt = 0.5 * (theta_max - theta_min) * w
    k = theta / lam
    total = 0.0
    for start in range(0, n, 100):  # chunks keep the (k x r) matrix small
        kk = k[start : start + 100]
        bessel = r[None, :] * j0(2.0 * np.pi * kk[:, None] * r[None, :])
        fr = np.trapezoid(bessel * re[None, :], r, axis=1)
        fi = np.trapezoid(bessel * im[None, :], r, axis=1)
        f2 = (2.0 * np.pi / lam) ** 2 * (fr**2 + fi**2)
        total += float(np.sum(2.0 * np.pi * theta[start : start + 100] * f2 * wt[start : start + 100]))
    return total


# --------------------------------------------------------------------------------------------
# The specimen function and the point-spread function
# --------------------------------------------------------------------------------------------


def specimen_function(
    xy: np.ndarray, weight: np.ndarray, extent: tuple[float, float], shape: tuple[int, int],
) -> np.ndarray:
    """Σ weight δ(r − r_j) on a periodic grid: each atom over its four nearest pixels.

    Pixel (i, j) sits at (i dx, j dy) with dx = extent / n, the origin at pixel (0, 0). The
    weights of the four pixels are the bilinear ones, so the sum of the grid is Σ weight.
    """
    nx, ny = shape
    u = xy[:, 0] / (extent[0] / nx)
    v = xy[:, 1] / (extent[1] / ny)
    iu, iv = np.floor(u).astype(np.int64), np.floor(v).astype(np.int64)
    fu, fv = u - iu, v - iv
    out = np.zeros(shape, dtype=np.float64)
    for di, wu in ((0, 1.0 - fu), (1, fu)):
        for dj, wv in ((0, 1.0 - fv), (1, fv)):
            np.add.at(out, ((iu + di) % nx, (iv + dj) % ny), weight * wu * wv)
    return out


def _chi(xp, kx, ky, lam: float, aberrations: dict[str, float]):
    """χ(k) in radians: χ = (2π/λ) Σ C_nm α^(n+1)/(n+1) cos(m(φ − φ_nm)), α = λ|k|, φ = atan2.

    `aberrations` has abTEM's names: magnitudes C10 (= −defocus), C12, C21, C23, C30, ... in Å and
    the angles phi12, phi21, ... in radians.
    """
    alpha = lam * xp.sqrt(kx**2 + ky**2)
    phi = xp.arctan2(ky, kx)
    chi = xp.zeros_like(alpha)
    for name, c in aberrations.items():
        if not name.startswith("C") or not c:
            continue
        n, m = int(name[1]), int(name[2])
        phi_nm = aberrations.get(f"phi{name[1:]}", 0.0)
        chi = chi + c * alpha ** (n + 1) / (n + 1) * (xp.cos(m * (phi - phi_nm)) if m else 1.0)
    return 2.0 * np.pi / lam * chi


def transfer(
    shape: tuple[int, int], extent: tuple[float, float], energy_kv: float, alpha_mrad: float,
    aberrations: dict[str, float], source_fwhm: float = 0.0, defocus_spread_fwhm: float = 0.0,
    device: str = "cpu",
):
    """The optical transfer function of the point-spread function, on the FFT grid of the box:
    the Fourier transform of the PSF density (∫ PSF = 1 so the value at k = 0 is 1, in the units
    of 'per pixel'), and the PSF density itself (Å⁻²)."""
    xp = _xp(device)
    nx, ny = shape
    dx, dy = extent[0] / nx, extent[1] / ny
    lam = wavelength_a(energy_kv)
    kx = xp.asarray(np.fft.fftfreq(nx, dx))[:, None] * xp.ones((1, ny))
    ky = xp.asarray(np.fft.fftfreq(ny, dy))[None, :] * xp.ones((nx, 1))
    kmag = xp.sqrt(kx**2 + ky**2)
    aperture = (lam * kmag <= alpha_mrad * 1e-3).astype(float)
    # defocus spread: Gauss-Hermite quadrature of a Gaussian of the given FWHM
    base = dict(aberrations)
    c10 = base.get("C10", 0.0)
    if defocus_spread_fwhm > 0:
        nodes, weights = np.polynomial.hermite.hermgauss(N_DEFOCUS)
        shifts = np.sqrt(2.0) * defocus_spread_fwhm * FWHM_TO_SIGMA * nodes
        weights = weights / np.sqrt(np.pi)
    else:
        shifts, weights = np.zeros(1), np.ones(1)
    intensity = xp.zeros((nx, ny))
    for shift, wgt in zip(shifts, weights):
        ab = {**base, "C10": c10 - float(shift)}  # a defocus Δf shifts C10 = −Δf by −shift
        psi = xp.fft.ifft2(aperture * xp.exp(-1j * _chi(xp, kx, ky, lam, ab)))
        intensity = intensity + float(wgt) * (xp.abs(psi) ** 2)
    intensity = intensity / (intensity.sum() * dx * dy)  # ∫ PSF = 1
    otf = xp.fft.fft2(intensity)
    if source_fwhm > 0:
        sigma = source_fwhm * FWHM_TO_SIGMA
        otf = otf * xp.exp(-2.0 * np.pi**2 * sigma**2 * kmag**2)
    otf = otf * (lam * kmag <= 2.0 * alpha_mrad * 1e-3)
    psf = xp.fft.ifft2(otf).real
    return otf, psf


# --------------------------------------------------------------------------------------------
# The image
# --------------------------------------------------------------------------------------------


def _projected(atoms: Atoms) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """x, y (Å, wrapped into the box), the atomic numbers and the occupancies of the atoms."""
    cell = np.asarray(atoms.cell.lengths(), dtype=float)
    xy = np.mod(atoms.positions[:, :2], cell[:2])
    occ = np.asarray(atoms.arrays.get("occupancy", np.ones(len(atoms))), dtype=float)
    return xy, np.asarray(atoms.numbers), occ


def grid_for(extent: tuple[float, float], pixel: float) -> tuple[int, int]:
    """Pixels of the whole box for a requested pixel size (the box is a whole number of pixels)."""
    if not pixel > 0:
        raise ValueError("The pixel size must be positive.")
    nx, ny = max(8, round(extent[0] / pixel)), max(8, round(extent[1] / pixel))
    if nx * ny > MAX_GRID_PIXELS:
        raise ValueError(
            f"A pixel size of {pixel} Å makes {nx} × {ny} pixels for the whole box; use at least "
            f"{(extent[0] * extent[1] / MAX_GRID_PIXELS) ** 0.5:.3f} Å."
        )
    return nx, ny


def fov_slices(
    fov: tuple[float, float, float, float] | None, extent: tuple[float, float], shape: tuple[int, int],
) -> tuple[slice, slice, list[float]]:
    """The pixels of the field of view [x0, y0, w, h] (Å) and the field they really cover. The
    default is the whole box. The field is kept inside the box."""
    nx, ny = shape
    dx, dy = extent[0] / nx, extent[1] / ny
    x0, y0, w, h = fov if fov is not None else (0.0, 0.0, extent[0], extent[1])
    i0 = int(np.clip(round(x0 / dx), 0, nx - 1))
    j0_ = int(np.clip(round(y0 / dy), 0, ny - 1))
    i1 = int(np.clip(i0 + max(2, round(w / dx)), i0 + 2, nx))
    j1 = int(np.clip(j0_ + max(2, round(h / dy)), j0_ + 2, ny))
    return slice(i0, i1), slice(j0_, j1), [i0 * dx, j0_ * dy, (i1 - i0) * dx, (j1 - j0_) * dy]


def _b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a, dtype="<f4").tobytes()).decode("ascii")


def adf_image(atoms: Atoms, params: dict[str, Any]) -> dict[str, Any]:
    """The incoherent ADF-STEM image of a specimen (and what it was made of); see the module doc."""
    t0 = time.perf_counter()
    energy = float(params.get("energy_kv", 200.0))
    alpha = float(params.get("semiangle_mrad", 20.0))
    adf = (float(params.get("adf_min_mrad", 50.0)), float(params.get("adf_max_mrad", 200.0)))
    param_name = str(params.get("parametrization", "kirkland"))
    pixel = float(params.get("pixel_size", 0.1))
    device = str(params.get("device", "cpu"))
    if not alpha > 0:
        raise ValueError("The convergence semi-angle must be positive.")
    if not adf[0] < adf[1]:
        raise ValueError("The ADF inner angle must be smaller than the outer angle.")
    cell = atoms.cell.lengths()
    extent = (float(cell[0]), float(cell[1]))
    thickness = float(cell[2])
    grid = params.get("grid")  # exact pixels of the whole box (tests, "nx × ny")
    shape = (int(grid[0]), int(grid[1])) if grid else grid_for(extent, pixel)
    lam = wavelength_a(energy)
    aberr = abtem_sim.probe_aberrations(
        float(params.get("defocus", 0.0)), float(params.get("cs_mm", 0.0)),
        float(params.get("c5_mm", 0.0)), params.get("aberrations") or None,
    )

    # partial cross sections, per element
    xy, numbers, occ = _projected(atoms)
    sigmas: dict[int, float] = {}
    for z in sorted(set(int(n) for n in numbers)):
        sigmas[z] = cross_section(chemical_symbols[z], energy, adf[0] * 1e-3, adf[1] * 1e-3, param_name)
    weight = np.array([sigmas[int(n)] for n in numbers]) * occ

    xp = _xp(device)
    spec = xp.asarray(specimen_function(xy, weight, extent, shape))
    otf, psf = transfer(
        shape, extent, energy, alpha, aberr, float(params.get("source_fwhm", 0.0)),
        float(params.get("defocus_spread_fwhm", 0.0)), device,
    )
    full = _to_numpy(xp.fft.ifft2(xp.fft.fft2(spec) * otf).real)
    sx, sy, fov_real = fov_slices(params.get("fov"), extent, shape)
    img = np.ascontiguousarray(full[sx, sy])

    noise = params.get("noise")
    scale = None
    if noise:
        scale = float(noise["current_pa"]) * float(noise["dwell_us"]) * ELECTRONS_PER_PA_US
        rng = np.random.default_rng(int(noise.get("seed", 0)))
        img = rng.poisson(np.clip(img, 0.0, None) * scale).astype(np.float64)

    # the PSF for the view: centred, a window of a few probe widths
    psf_c = np.fft.fftshift(_to_numpy(psf))
    dxy = (extent[0] / shape[0], extent[1] / shape[1])
    half = int(min(psf_c.shape[0], psf_c.shape[1]) // 2)
    reach = max(int(round(6.0 * 0.61 * lam / (alpha * 1e-3) / min(dxy))), 24)
    r = min(half, reach)
    cx, cy = psf_c.shape[0] // 2, psf_c.shape[1] // 2
    win = psf_c[cx - r : cx + r, cy - r : cy + r]
    prof = radial_profile(win, float(np.mean(dxy)))

    warnings: list[str] = []
    if thickness > THIN_LIMIT:
        warnings.append(
            f"The specimen is {thickness:.0f} Å thick. The incoherent model ignores channelling and "
            f"multiple scattering and is valid for very thin specimens (about {THIN_LIMIT:.0f} Å or less)."
        )
    p_nyq = lam / (4.0 * alpha * 1e-3)
    if max(dxy) > p_nyq * 1.001:
        warnings.append(
            f"The pixel size {max(dxy):.3f} Å is coarser than λ / (4 α) = {p_nyq:.3f} Å: the "
            "probe intensity is under-sampled and the image is blurred."
        )
    top = float(img.max()) if img.size else 0.0
    return {
        "wavelength": lam,
        "shape": [int(img.shape[0]), int(img.shape[1])],
        "grid": [int(shape[0]), int(shape[1])],
        "pixel": [float(dxy[0]), float(dxy[1])],
        "fov": fov_real,
        "box": [extent[0], extent[1]],
        "extent": [fov_real[2], fov_real[3]],
        "image": _b64(img),
        "png": abtem_sim._png(img, cmap="gray", max_side=1024),
        "vmin": float(img.min()) if img.size else 0.0,
        "vmax": top,
        "mean": float(img.mean()) if img.size else 0.0,
        "sigmas": [
            {"symbol": chemical_symbols[z], "z": z, "sigma": float(s),
             "atoms": int((numbers == z).sum())}
            for z, s in sigmas.items()
        ],
        "psf": {
            "png": abtem_sim._png(win, cmap="inferno", max_side=384),
            "extent": [win.shape[0] * dxy[0], win.shape[1] * dxy[1]],
            "profile": prof,
        },
        "thickness": thickness,
        "n_atoms": int(len(atoms)),
        "counts_scale": scale,
        "noisy": bool(noise),
        "warnings": warnings,
        "seconds": time.perf_counter() - t0,
    }
