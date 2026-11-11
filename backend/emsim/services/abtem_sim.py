"""abTEM parameter previews (context.md M4).

Stats are exact (sampling, gpts, maximum angle, Nyquist step). The pictures are cheap: the potential
is projected once per specimen and sampling (infinite projection, no frozen phonons, at most 1024
pixels a side) and the probe is one position. A full simulation is never started here. Every abTEM
call in this module is below.

The pictures are sent in the display orientation of the "down the beam" view (context.md §7.M3):
looking along +z with +y up the screen, +x points to the left. Their extents are sent with them so
the frontend can draw overlays and scale bars in angstrom.
"""

from __future__ import annotations

import base64
import io
import re
from typing import Any

import numpy as np
from ase import Atoms

from abtem.core.energy import energy2wavelength

from .estimate import EstimateRequest, estimate


def wavelength_a(energy_kv: float) -> float:
    """Relativistic wavelength in angstrom. abTEM takes the energy in eV."""
    return float(energy2wavelength(energy_kv * 1e3))


def alpha_max_mrad(sampling_a: float, energy_kv: float) -> float:
    """Antialiasing limit: (2/3) of the Nyquist angle, in mrad. Nyquist is λ / (2 Δx)."""
    if sampling_a <= 0:
        raise ValueError("Sampling must be positive.")
    return (2.0 / 3.0) * wavelength_a(energy_kv) / (2.0 * sampling_a) * 1e3


def nyquist_step_a(alpha_mrad: float, energy_kv: float) -> float:
    """Largest scan step that samples a probe of semiangle α: λ / (4 α), α in radians."""
    alpha = alpha_mrad * 1e-3
    if alpha <= 0:
        raise ValueError("The convergence angle must be positive.")
    return wavelength_a(energy_kv) / (4.0 * alpha)


def diffraction_pixel_mrad(cell_a: float, energy_kv: float) -> float:
    """One reciprocal pixel of a cell of side L, in mrad: λ / L."""
    if cell_a <= 0:
        raise ValueError("The cell size must be positive.")
    return wavelength_a(energy_kv) / cell_a * 1e3


def gpts_for(extent: tuple[float, float], sampling: float) -> tuple[int, int]:
    return tuple(max(1, int(round(e / sampling))) for e in extent)  # type: ignore[return-value]


def display_orientation(array: np.ndarray) -> np.ndarray:
    """abTEM's [x, y] array as image rows (top = +y) and columns (left = +x)."""
    return np.asarray(array)[::-1, ::-1].T


def _png(array: np.ndarray, cmap: str = "magma", max_side: int = 384) -> str:
    """One pixel per array element (no axes or margins), at most `max_side` pixels a side."""
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib import pyplot as plt

    a = display_orientation(array).astype(float)
    if max(a.shape) > max_side:
        from scipy.ndimage import zoom

        a = zoom(a, max_side / max(a.shape), order=1)
    buf = io.BytesIO()
    plt.imsave(buf, a, cmap=cmap, format="png")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _quiet() -> None:
    from abtem.core.config import config

    config["local_diagnostics.task_level_progress"] = False


MAX_POTENTIAL_GPTS = 1024


def project_potential(atoms: Atoms, sampling: float) -> np.ndarray:
    """Projected potential at the simulation's sampling (coarser if that is above 1024 pixels)."""
    import abtem

    _quiet()
    extent = (float(atoms.cell.lengths()[0]), float(atoms.cell.lengths()[1]))
    coarse = max(sampling, max(extent) / MAX_POTENTIAL_GPTS)
    potential = abtem.Potential(
        atoms, sampling=coarse, slice_thickness=max(atoms.cell.lengths()[2], 1.0),
        projection="infinite", parametrization="lobato", device="cpu",
    )
    image = potential.project().compute()
    return np.asarray(image.array)


_potential_cache: dict[tuple, np.ndarray] = {}


def _cached_potential(atoms: Atoms, sampling: float) -> np.ndarray:
    """The projected potential, reused while only the beam or detector settings change."""
    key = (id(atoms), len(atoms), tuple(np.round(atoms.cell.lengths(), 6)), round(sampling, 6))
    hit = _potential_cache.get(key)
    if hit is None:
        if len(_potential_cache) > 8:
            _potential_cache.clear()
        hit = _potential_cache[key] = project_potential(atoms, sampling)
    return hit


def kinematic_discs(
    potential: np.ndarray, extent: tuple[float, float], q_max: float, limit: int = 600,
    floor: float = 1e-5,
) -> list[list[float]]:
    """Zero-order Laue zone reflections from the projected potential: [qx, qy, I] in 1/Å.

    In the kinematic (first Born) approximation the amplitude of reflection g of the zero-order
    zone is the Fourier coefficient of the projected potential at g. The box is periodic, so only
    the reciprocal points of the repeat cell are non-zero. I is relative to the strongest g ≠ 0;
    the direct beam comes first with I = 1. At most `limit` reflections inside q_max are kept.
    """
    v = np.asarray(potential, dtype=float)
    if v.ndim != 2 or min(v.shape) < 2:
        return [[0.0, 0.0, 1.0]]
    nx, ny = v.shape
    f = np.abs(np.fft.fft2(v)) ** 2
    qx = np.fft.fftfreq(nx, d=extent[0] / nx)
    qy = np.fft.fftfreq(ny, d=extent[1] / ny)
    QX, QY = np.meshgrid(qx, qy, indexing="ij")
    q = np.hypot(QX, QY)
    f[0, 0] = 0.0
    top = f.max()
    if top <= 0:
        return [[0.0, 0.0, 1.0]]
    keep = (f > floor * top) & (q <= q_max)
    idx = np.argwhere(keep)
    order = np.argsort(-f[keep])[:limit]
    out = [[0.0, 0.0, 1.0]]
    for i, j in idx[order]:
        out.append([float(QX[i, j]), float(QY[i, j]), float(f[i, j] / top)])
    return out


MAX_PROBE_GPTS = 512


def probe_window(energy_kv: float, alpha_mrad: float, defocus_a: float) -> tuple[float, int]:
    """Sampling and pixel count of the probe picture: wide enough for the defocused disc and the
    first rings, fine enough for the aperture (2/3 of Nyquist at α)."""
    lam = wavelength_a(energy_kv)
    alpha = alpha_mrad * 1e-3
    fwhm = 0.61 * lam / alpha
    sampling = min(0.1, lam / (3.0 * alpha))
    want = max(4.0, 2.0 * (alpha * abs(defocus_a) + 6.0 * fwhm))
    n = int(min(MAX_PROBE_GPTS, max(32, np.ceil(want / sampling))))
    return sampling, n


def probe_aberrations(
    defocus_a: float, cs_mm: float = 0.0, c5_mm: float = 0.0, extra: dict[str, float] | None = None,
) -> dict[str, float]:
    """abTEM's aberrations: C10 = -defocus (positive defocus is underfocus), Cs and C5 mm -> Å,
    then the named coefficients of `extra`, which win."""
    out = {"C10": -defocus_a, "C30": cs_mm * 1e7, "C50": c5_mm * 1e7}
    for k, v in (extra or {}).items():
        if not re.fullmatch(r"(C|phi)[1-5]\d", k):
            raise ValueError(f"Unknown aberration {k!r} (use abTEM's names: C12, phi12, C30, ...).")
        out[k] = float(v)
    return out


def probe_image(
    energy_kv: float, alpha_mrad: float, defocus_a: float, cs_mm: float, c5_mm: float = 0.0,
    extra: dict[str, float] | None = None,
) -> np.ndarray:
    import abtem

    _quiet()
    sampling, n = probe_window(energy_kv, alpha_mrad, defocus_a)
    probe = abtem.Probe(
        energy=energy_kv * 1e3,
        semiangle_cutoff=alpha_mrad,
        sampling=sampling,
        gpts=(n, n),
        aberrations=probe_aberrations(defocus_a, cs_mm, c5_mm, extra),
        device="cpu",
    )
    waves = probe.build().compute()
    return np.asarray(waves.intensity().array)


def probe_export(params: dict[str, Any], fmt: str) -> tuple[bytes, str, str]:
    """The probe intensity at the entrance surface as a data file: (bytes, media type, extension).

    `npz` holds `intensity` (rows = x, columns = y, abTEM's order), `sampling` and `extent` (Å),
    `energy_kv`, `semiangle_mrad`, `defocus` and the aberrations used. `csv` is the intensity alone
    with the sampling in a comment line."""
    energy = float(params.get("energy_kv", 200.0))
    alpha = float(params.get("semiangle_mrad", 20.0))
    defocus = float(params.get("defocus", 0.0))
    if alpha <= 0:
        raise ValueError("The convergence angle must be positive.")
    extra = params.get("aberrations") or None
    sampling, _ = probe_window(energy, alpha, defocus)
    image = probe_image(
        energy, alpha, defocus, float(params.get("cs_mm", 0.0)), float(params.get("c5_mm", 0.0)), extra
    )
    extent = [image.shape[0] * sampling, image.shape[1] * sampling]
    buf = io.BytesIO()
    if fmt == "npz":
        names = sorted((extra or {}).keys())
        np.savez(
            buf, intensity=image, sampling=sampling, extent=np.array(extent), energy_kv=energy,
            semiangle_mrad=alpha, defocus=defocus,
            aberration_names=np.array(names), aberration_values=np.array([(extra or {})[k] for k in names]),
        )
        return buf.getvalue(), "application/octet-stream", "npz"
    text = io.StringIO()
    text.write(f"# probe intensity, rows = x, columns = y; sampling {sampling:.6g} A, "
               f"{energy:g} kV, alpha {alpha:g} mrad, defocus {defocus:g} A\n")
    np.savetxt(text, image, delimiter=",", fmt="%.6e")
    return text.getvalue().encode("utf8"), "text/csv", "csv"


def radial_profile(image: np.ndarray, sampling: float) -> dict[str, Any]:
    """Azimuthal average about the intensity centroid (peak = 1), the FWHM read from it, and the
    radius that holds 99 % of the intensity (the tail)."""
    a = np.asarray(image, dtype=float)
    total = a.sum() if a.ndim == 2 else 0.0
    if total <= 0:
        return {"r": [], "intensity": [], "fwhm": None, "tail": None}
    x = (np.arange(a.shape[0]) * sampling)[:, None]
    y = (np.arange(a.shape[1]) * sampling)[None, :]
    cx, cy = float((a * x).sum() / total), float((a * y).sum() / total)
    r = np.hypot(x - cx, y - cy)
    r_max = min(cx, cy, a.shape[0] * sampling - cx, a.shape[1] * sampling - cy)
    bins = max(8, int(r_max / sampling))  # rings one pixel wide
    edges = np.linspace(0.0, max(r_max, sampling), bins + 1)
    which = np.digitize(r.ravel(), edges) - 1
    ok = (which >= 0) & (which < bins)
    sums = np.bincount(which[ok], weights=a.ravel()[ok], minlength=bins)
    counts = np.bincount(which[ok], minlength=bins)
    filled = counts > 0
    prof = sums[filled] / counts[filled]
    centres = (0.5 * (edges[1:] + edges[:-1]))[filled]
    prof = prof / (prof.max() or 1.0)
    fwhm = None
    below = np.nonzero(prof < 0.5)[0]
    if below.size and below[0] > 0:
        i = below[0]
        t = (prof[i - 1] - 0.5) / (prof[i - 1] - prof[i])
        fwhm = float(2.0 * (centres[i - 1] + t * (centres[i] - centres[i - 1])))
    order = np.argsort(r.ravel())
    cum = np.cumsum(a.ravel()[order]) / total
    tail = float(r.ravel()[order][min(int(np.searchsorted(cum, 0.99)), cum.size - 1)])
    return {
        "r": [float(v) for v in centres],
        "intensity": [float(v) for v in prof],
        "fwhm": fwhm,
        "tail": tail,
    }


def preview(atoms: Atoms, params: dict[str, Any]) -> dict[str, Any]:
    """Stats, warnings and small pictures for one parameter set. Never runs a simulation."""
    energy = float(params.get("energy_kv", 200.0))
    sampling = float(params.get("sampling", 0.05))
    slice_thickness = float(params.get("slice_thickness", 1.0))
    alpha = float(params.get("semiangle_mrad", 20.0))
    sim = str(params.get("sim_type", "stem"))
    probe_mode = sim in ("cbed", "stem", "4dstem")
    defocus = float(params.get("defocus", 0.0))
    extent = (float(atoms.cell.lengths()[0]), float(atoms.cell.lengths()[1]))
    thickness = float(atoms.cell.lengths()[2])
    gpts = gpts_for(extent, sampling)
    n_slices = max(1, int(round(thickness / slice_thickness)))
    amax = alpha_max_mrad(sampling, energy)
    dtheta = diffraction_pixel_mrad(min(extent), energy)
    nyquist = nyquist_step_a(alpha, energy) if probe_mode and alpha > 0 else None
    scan_step = float(params.get("scan_step") or (nyquist or sampling))
    fov = params.get("scan_fov") or [0.0, 0.0, extent[0], extent[1]]
    n_scan = 1
    if sim in ("stem", "4dstem"):
        n_scan = max(1, int(fov[2] / scan_step)) * max(1, int(fov[3] / scan_step))
    pattern = int(params.get("pattern_size", 128))
    binning = max(1, int(params.get("binning", 1)))
    binned = max(1, pattern // binning)
    detectors = params.get("detectors") or []

    warnings: list[str] = []
    for det in detectors:
        outer = det.get("outer")
        if outer is not None and float(outer) > amax + 1e-6:
            warnings.append(
                f"{det.get('name', 'Detector')} outer angle {float(outer):.0f} mrad is beyond "
                f"the maximum simulated angle {amax:.0f} mrad. Use a finer sampling."
            )
    if probe_mode and dtheta > 0 and (2.0 * alpha) / dtheta < 10.0:
        warnings.append(
            f"The bright-field disk is under-sampled ({(2.0 * alpha) / dtheta:.1f} pixels across; "
            "want at least 10). The cell is small for this convergence angle."
        )
    if nyquist is not None and scan_step > nyquist * 1.001 and sim in ("stem", "4dstem"):
        warnings.append(
            f"Scan step {scan_step:.3f} Å is coarser than the Nyquist step {nyquist:.3f} Å."
        )
    fwhm = 0.61 * wavelength_a(energy) / (alpha * 1e-3) if probe_mode and alpha > 0 else 0.0
    alpha_cap = 40.0
    if probe_mode and alpha > alpha_cap:
        warnings.append(
            f"α = {alpha:.0f} mrad is above the usual {alpha_cap:.0f} mrad for {sim.upper()}."
        )
    if sim == "lacbed" and params.get("lacbed_mode", "defocused-probe") == "defocused-probe":
        needed = 2.0 * alpha * 1e-3 * abs(defocus)
        if needed > min(extent):
            warnings.append(
                f"The specimen is too small for this defocus: the defocused probe is about "
                f"{needed:.0f} Å across, the box {min(extent):.0f} Å."
            )
    phonons = int(params.get("phonons", 1))
    sigmas = {str(k): float(v) for k, v in (params.get("phonon_sigmas") or {}).items()}
    if phonons > 1 and not any(v > 0 for v in sigmas.values()):
        warnings.append(
            f"{phonons} frozen-phonon configurations with a thermal sigma of 0 are all the same: "
            "set the displacement sigma (Potential tab)."
        )
    depths = [float(t) for t in params.get("thicknesses") or []]
    if any(t > thickness + 1e-6 for t in depths):
        warnings.append(
            f"The thickness series goes beyond the specimen ({thickness:.0f} Å thick); "
            "depths past the exit surface are not reached."
        )
    defoci = [float(d) for d in params.get("defocus_series") or []] if sim != "saed" else []
    tilts = (params.get("tilt_series") or []) if sim in ("saed", "cbed") else []
    n_runs = max(1, len(defoci)) * max(1, len(tilts))
    margin = params.get("fov_margin")
    if margin is not None and fwhm and float(margin) < 2.0 * fwhm:
        warnings.append(
            f"The scan area is {float(margin):.1f} Å from the box edge, but the probe is about "
            f"{fwhm:.1f} Å wide. Its tails wrap around the periodic box."
        )

    images: dict[str, str] = {}
    extents: dict[str, list[float]] = {}
    discs: list[list[float]] = []
    profile: dict[str, Any] | None = None
    lam = wavelength_a(energy)
    try:
        pot = _cached_potential(atoms, sampling)
        # Square root of the potential: the peaks are sharp, the light atoms would vanish.
        images["potential"] = _png(np.sqrt(np.clip(pot - pot.min(), 0.0, None)))
        extents["potential"] = [extent[0], extent[1]]
        # Up to the largest angle the simulation keeps, a little more for the discs at the edge.
        discs = kinematic_discs(pot, extent, 1.05 * amax * 1e-3 / lam, limit=2000)
    except Exception as e:  # the numbers are still useful if the picture fails
        warnings.append(f"Potential preview failed: {type(e).__name__}: {e}")
    if probe_mode and alpha > 0:
        try:
            p_sampling, _ = probe_window(energy, alpha, defocus)
            pr = probe_image(
                energy, alpha, defocus, float(params.get("cs_mm", 0.0)),
                float(params.get("c5_mm", 0.0)), params.get("aberrations") or None,
            )
            images["probe"] = _png(pr, cmap="inferno")
            extents["probe"] = [pr.shape[0] * p_sampling, pr.shape[1] * p_sampling]
            profile = radial_profile(pr, p_sampling)
        except Exception as e:
            warnings.append(f"Probe preview failed: {type(e).__name__}: {e}")

    det_shape = (binned, binned) if sim in ("cbed", "4dstem", "saed") else None
    mem = estimate(EstimateRequest(
        gpts=gpts, n_slices=n_slices, frozen_phonons=int(params.get("phonons", 1)),
        scan_positions=n_scan, detector_shape=det_shape,
        n_detectors=len(detectors) if sim == "stem" else 0,
        device=params.get("device", "cpu"), workers=int(params.get("workers", 1)),
    ))
    # Each defocus and tilt of a series is a run of its own; each depth of the thickness series
    # is one more saved output of every run.
    n_saved = len([t for t in depths if t < thickness - 1e-6]) + 1
    mem.seconds *= n_runs
    mem.output_bytes *= n_runs * n_saved
    return {
        "wavelength": wavelength_a(energy),
        "gpts": list(gpts),
        "sampling": sampling,
        "n_slices": n_slices,
        "alpha_max_mrad": amax,
        "nyquist_step": nyquist,
        "scan_step": scan_step,
        "n_scan": n_scan,
        "diffraction_pixel_mrad": dtheta,
        # λ / L along x and y: set by the box (and the voltage), not by the potential sampling.
        "diffraction_pixel_xy": [diffraction_pixel_mrad(extent[0], energy),
                                 diffraction_pixel_mrad(extent[1], energy)],
        "bf_disk_pixels": (2.0 * alpha) / dtheta if dtheta else None,
        "probe_fwhm": fwhm or None,
        "pattern_size": pattern,
        "binning": binning,
        "binned_size": binned,
        "memory": mem.model_dump(),
        "images": images,
        "extents": extents,
        "discs": discs,
        "probe_profile": profile,
        "warnings": warnings,
        # A defocused convergent probe is one multislice; summing tilted plane waves is many.
        "thicknesses": depths,
        "phonon_sigmas": sigmas,
        "series": {"runs": n_runs, "saved_depths": n_saved, "defoci": len(defoci),
                   "tilts": len(tilts)},
    }
