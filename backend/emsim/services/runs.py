"""The simulations of a job (context.md M6): what the worker process computes and saves.

Each runner takes the specimen (or the registered crystal for Bloch waves), the same parameters as
the previews and a folder, writes its results there and returns a list describing them. Arrays
are saved as `.npy` (the 4D-STEM data as a zarr folder) with the layout

    (run, depth, ...)      run = one value of the defocus and tilt series (one run if none)
                           depth = the thickness series, the exit surface last

and every result has a short PNG preview. Orientation is abTEM's: array[x, y] with x first.
`report(fraction, message)` tells the caller how far along the job is.
"""

from __future__ import annotations

import base64
import itertools
import os
from pathlib import Path
from typing import Any, Callable

import numpy as np
from ase import Atoms

from . import abtem_sim, bloch_sim, devices, discs, incostem

Report = Callable[[float, str], None]


# ---- helpers -----------------------------------------------------------------------------------


PNG_DPI = 300
PNG_SIDE = 2048  # the long side of a saved PNG, pixels: 6.8 inches at 300 dpi


def _save_png(path: Path, array: np.ndarray, cmap: str, log: bool = False,
              pixel: tuple[float, float] = (1.0, 1.0)) -> None:
    """A picture of array[x, y] (abTEM's orientation): `pixel` is the size of one pixel along x and
    y, and the picture is resampled so that its pixels are square. At least `PNG_SIDE` pixels on
    the long side, written with a resolution of `PNG_DPI`."""
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib import pyplot as plt
    from scipy.ndimage import zoom

    a = np.asarray(array, dtype=float)
    if log:
        top = a.max() if a.size else 0.0
        a = np.log10(np.clip(a, max(top * 1e-6, 1e-30), None)) if top > 0 else a
    lo, hi = float(a.min()), float(a.max())
    a = (a - lo) / (hi - lo) if hi > lo else np.zeros_like(a)
    px, py = float(pixel[0]), float(pixel[1])
    fine = min(px, py)
    # Square pixels, and enough of them: one factor for the whole picture, per axis.
    sx, sy = px / fine, py / fine
    scale = max(1.0, PNG_SIDE / max(a.shape[0] * sx, a.shape[1] * sy))
    # Nearest neighbour: every computed pixel stays a visible square, nothing is invented between.
    a = zoom(a, (sx * scale, sy * scale), order=0)
    path.parent.mkdir(parents=True, exist_ok=True)
    plt.imsave(path, abtem_sim.display_orientation(a), cmap=cmap, vmin=0.0, vmax=1.0,
               format="png", dpi=PNG_DPI)


class _DaskProgress:
    """A dask callback that turns finished tasks into a fraction between `lo` and `hi`."""

    def __init__(self, report: Report, lo: float, hi: float, message: str):
        from dask.callbacks import Callback

        outer = self

        class _Cb(Callback):
            def _start_state(self, dsk, state):
                outer.total = sum(len(state[k]) for k in ("ready", "waiting", "running", "finished"))

            def _posttask(self, key, result, dsk, state, worker_id):
                done = len(state["finished"])
                report(lo + (hi - lo) * done / max(outer.total, 1), message)

        self.total = 1
        self.cb = _Cb()

    def __enter__(self):
        self.cb.__enter__()
        return self

    def __exit__(self, *exc):
        self.cb.__exit__(*exc)


def _to_numpy(measurement) -> Any:
    if hasattr(measurement, "to_cpu"):
        measurement = measurement.to_cpu()
    return measurement


def _normalised(measurement) -> np.ndarray:
    """The measurement's array with the frozen-phonon axis averaged and a depth axis in front."""
    from abtem.core.axes import FrozenPhononsAxis, ThicknessAxis

    m = _to_numpy(measurement)
    a = np.asarray(m.array)
    meta = list(m.axes_metadata)
    fp = [i for i, ax in enumerate(meta) if isinstance(ax, FrozenPhononsAxis)]
    if fp:
        a = a.mean(axis=tuple(fp))
        meta = [ax for i, ax in enumerate(meta) if i not in fp]
    depth = [i for i, ax in enumerate(meta) if isinstance(ax, ThicknessAxis)]
    if depth:
        a = np.moveaxis(a, depth[0], 0)
    else:
        a = a[None]
    return a


def _depths(thickness: float, slice_thickness: float, wanted: list[float]) -> tuple[list[int], list[float]]:
    """Exit planes (0-based slice indices) and the depths (Å) they correspond to; exit surface last."""
    n = max(1, int(round(thickness / slice_thickness)))
    dz = thickness / n
    planes = sorted({min(n, max(1, int(round(t / dz)))) for t in wanted if 0 < t < thickness - 1e-6})
    planes = [k for k in planes if k < n] + [n]
    return [k - 1 for k in planes], [k * dz for k in planes]


def _crop_bin(a: np.ndarray, size: int | tuple[int, int], binning: int) -> np.ndarray:
    """The central `size` pixels (x, y; one number for both) of the last two axes (the direct beam
    in the middle), summed in blocks of `binning`."""
    b = max(binning, 1)
    sizes = []
    for n, want in zip(a.shape[-2:], (size, size) if isinstance(size, int) else size):
        s = min(int(want), n)
        sizes.append(max(s - s % b, b))
    (sx, sy), (nx, ny) = sizes, a.shape[-2:]
    cx, cy = nx // 2, ny // 2
    sub = a[..., cx - sx // 2 : cx - sx // 2 + sx, cy - sy // 2 : cy - sy // 2 + sy]
    if b > 1:
        sub = sub.reshape(*sub.shape[:-2], sx // b, b, sy // b, b).sum(axis=(-3, -1))
    return np.ascontiguousarray(sub)


# ---- multislice ----------------------------------------------------------------------------------


def _label(defocus: float | None, tilt: tuple[float, float] | None) -> str:
    bits = []
    if defocus is not None:
        bits.append(f"defocus {defocus:g} Å")
    if tilt is not None:
        bits.append(f"tilt ({tilt[0]:g}, {tilt[1]:g}) mrad")
    return ", ".join(bits) or "single run"


def run_multislice(
    atoms: Atoms, p: dict[str, Any], out: Path, report: Report, workers: int = 1
) -> list[dict[str, Any]]:
    import abtem
    import dask
    from abtem.core.config import config

    config["local_diagnostics.task_level_progress"] = False
    device, note = devices.resolve(str(p.get("device", "cpu")))
    sim = str(p.get("sim_type", "stem"))
    energy = float(p.get("energy_kv", 200.0)) * 1e3
    sampling = float(p.get("sampling", 0.05))
    dz = float(p.get("slice_thickness", 1.0))
    alpha = float(p.get("semiangle_mrad", 20.0))
    extent = (float(atoms.cell.lengths()[0]), float(atoms.cell.lengths()[1]))
    thickness = float(atoms.cell.lengths()[2])
    probe_mode = sim in ("cbed", "stem", "4dstem")
    if probe_mode and alpha <= 0:
        raise ValueError("The convergence angle must be positive.")
    amax = abtem_sim.alpha_max_mrad(sampling, p.get("energy_kv", 200.0))
    # One reciprocal pixel is lambda / L, so a box that is not square has a pixel for each axis.
    # `pattern` counts pixels of the coarser one; the other axis records the same angular range.
    dtheta_xy = [abtem_sim.diffraction_pixel_mrad(e, p.get("energy_kv", 200.0)) for e in extent]
    dtheta = max(dtheta_xy)

    planes, depths = _depths(thickness, dz, [float(t) for t in p.get("thicknesses") or []])
    phonons = int(p.get("phonons", 1))
    sigmas = {k: float(v) for k, v in (p.get("phonon_sigmas") or {}).items()}
    source: Any = atoms
    if phonons > 1 and any(v > 0 for v in sigmas.values()):
        source = abtem.FrozenPhonons(atoms, num_configs=phonons, sigmas=sigmas, seed=1)
    potential = abtem.Potential(
        source, sampling=sampling, slice_thickness=dz, projection="infinite",
        parametrization="lobato", exit_planes=tuple(planes), device=device,
    )

    defoci: list[float | None] = [float(d) for d in p.get("defocus_series") or []] or [None]
    if sim == "saed":
        defoci = [None]
    tilts: list[tuple[float, float] | None] = (
        [(float(a), float(b)) for a, b in p.get("tilt_series") or []] or [None]
    ) if sim in ("saed", "cbed") else [None]
    runs = list(itertools.product(defoci, tilts))
    labels = [_label(d, t) for d, t in runs]
    default_defocus = float(p.get("defocus", 0.0))
    extra = p.get("aberrations") or None

    pattern = int(p.get("pattern_size", 128))
    binning = max(1, int(p.get("binning", 1)))
    max_angle = min(amax * 0.999, (pattern / 2 + 1) * dtheta)
    pattern_xy = tuple(max(binning, int(round(pattern * dtheta / d))) for d in dtheta_xy)

    fov = p.get("scan_fov") or [0.0, 0.0, extent[0], extent[1]]
    step = float(p.get("scan_step") or abtem_sim.nyquist_step_a(alpha, p.get("energy_kv", 200.0)) if probe_mode else 0)
    detectors = p.get("detectors") or []

    if note:
        report(0.0, note)
    results: list[dict[str, Any]] = []
    store: dict[str, Any] = {}  # name -> list of arrays (one per run)
    exit_waves: list[np.ndarray] = []

    for r, (df, tilt) in enumerate(runs):
        lo, hi = r / len(runs), (r + 1) / len(runs)
        msg = f"Run {r + 1} of {len(runs)}" if len(runs) > 1 else "Multislice"
        ab = abtem_sim.probe_aberrations(default_defocus if df is None else df, extra=extra)
        tilt_kw = {"tilt": tilt} if tilt is not None else {}
        with dask.config.set(num_workers=max(1, workers)), _DaskProgress(report, lo, hi, msg):
            if sim == "stem" or sim == "4dstem":
                probe = abtem.Probe(
                    energy=energy, semiangle_cutoff=alpha, aberrations=ab, device=device
                )
                probe.grid.match(potential)
                scan = abtem.GridScan(
                    start=(fov[0], fov[1]), end=(fov[0] + fov[2], fov[1] + fov[3]),
                    sampling=step, potential=potential,
                )
                if sim == "stem":
                    dets = [abtem.AnnularDetector(d["inner"], d["outer"], ) for d in detectors]
                    if not dets:
                        raise ValueError("Add at least one detector (Detectors tab).")
                    res = probe.scan(potential, scan=scan, detectors=dets, lazy=True).compute(
                        progress_bar=False
                    )
                    res = res if isinstance(res, (list, tuple)) else [res]
                    for d, m in zip(detectors, res):
                        store.setdefault(f"stem_{d['name']}", []).append(_normalised(m))
                else:
                    det = abtem.PixelatedDetector(max_angle=max_angle, resample=False)
                    m = probe.scan(potential, scan=scan, detectors=det, lazy=True).compute(
                        progress_bar=False
                    )
                    arr = _crop_bin(_normalised(m), pattern_xy, binning)
                    store.setdefault("4dstem", []).append(arr.astype(np.float32))
            elif sim == "cbed":
                probe = abtem.Probe(
                    energy=energy, semiangle_cutoff=alpha, aberrations=ab, device=device, **tilt_kw
                )
                probe.grid.match(potential)
                cx, cy = fov[0] + fov[2] / 2, fov[1] + fov[3] / 2
                waves = probe.build(scan=(cx, cy), lazy=True).multislice(potential)
                dp = waves.diffraction_patterns(max_angle=max_angle, block_direct=False)
                arr = _crop_bin(_normalised(dp.compute(progress_bar=False)), pattern_xy, binning)
                store.setdefault(sim, []).append(arr.astype(np.float32))
            else:  # hrtem, saed: a plane wave
                wave = abtem.PlaneWave(energy=energy, device=device, **tilt_kw)
                wave.grid.match(potential)
                exit_ = wave.multislice(potential, lazy=True).compute(progress_bar=False)
                if sim == "saed":
                    dp = exit_.diffraction_patterns(max_angle=max_angle, block_direct=False)
                    arr = _crop_bin(_normalised(dp), pattern_xy, binning)
                    store.setdefault("saed", []).append(arr.astype(np.float32))
                else:
                    aperture = float(p.get("objective_aperture_mrad") or 0.0)
                    ctf = abtem.CTF(
                        energy=energy, aberration_coefficients=ab,
                        semiangle_cutoff=aperture if aperture > 0 else np.inf,
                    )
                    img = _to_numpy(exit_.apply_ctf(ctf).intensity())
                    store.setdefault("hrtem", []).append(_normalised(img).astype(np.float32))
                    ew = _normalised(_to_numpy(exit_))
                    exit_waves.append(ew.astype(np.complex64))
        report(hi, msg)

    # ---- save ----------------------------------------------------------------------------------
    dx = (extent[0] / max(1, int(round(extent[0] / sampling))), extent[1] / max(1, int(round(extent[1] / sampling))))
    for name, arrays in store.items():
        data = np.stack(arrays)  # (run, depth, ...)
        meta: dict[str, Any] = {
            "name": name, "runs": labels, "depths": depths, "shape": list(data.shape),
            "axes": ["run", "depth"], "sim_type": sim, "energy_kv": energy / 1e3,
        }
        if name.startswith("stem_"):
            meta.update(kind="image", axes=["run", "depth", "x", "y"], kind_label=name[5:],
                        pixel=[step, step], unit="Å", origin=[fov[0], fov[1]])
            cmap, log = "gray", False
        elif name in ("hrtem",):
            meta.update(kind="image", axes=["run", "depth", "x", "y"], pixel=list(dx), unit="Å")
            cmap, log = "gray", False
        else:  # patterns
            meta.update(kind="pattern", axes=["run", "depth", "x", "y", "kx", "ky"][: data.ndim],
                        pixel_mrad=[d * binning for d in dtheta_xy], binning=binning,
                        size=[int(data.shape[-2]), int(data.shape[-1])])
            if name == "4dstem":
                meta["scan_pixel"] = [step, step]  # the real-space pixel, for a dose per area
                meta["semiangle_mrad"] = alpha  # the viewer's first virtual detector (bright field)
            cmap, log = "inferno", True
        file = f"{name}.zarr" if name == "4dstem" else f"{name}.npy"
        if name == "4dstem":
            import zarr

            z = zarr.open(str(out / file), mode="w", shape=data.shape, dtype=data.dtype,
                          chunks=(1, 1, *data.shape[2:4], min(data.shape[4], 64), min(data.shape[5], 64)))
            z[:] = data
            z.attrs.update({k: v for k, v in meta.items()})
            show = data[-1, -1].mean(axis=(0, 1))  # the mean diffraction pattern
            meta["axes"] = ["run", "depth", "x", "y", "kx", "ky"]
            meta["scan_shape"] = list(data.shape[2:4])
        else:
            np.save(out / file, data)
            show = data[-1, -1]
        png = f"{name}.png"
        _save_png(out / png, show, cmap, log, pixel=tuple(meta.get("pixel_mrad") or meta.get("pixel") or (1, 1)))
        results.append({**meta, "file": file, "preview": png,
                        "bytes": int(data.nbytes)})
    if exit_waves:
        ew = np.stack(exit_waves)
        np.save(out / "exit_wave.npy", ew)
        _save_png(out / "exit_wave_phase.png", np.angle(ew[-1, -1]), "twilight", pixel=tuple(dx))
        results.append({"name": "exit_wave", "kind": "wave", "file": "exit_wave.npy",
                        "preview": "exit_wave_phase.png", "shape": list(ew.shape),
                        "axes": ["run", "depth", "x", "y"], "depths": depths, "runs": labels,
                        "pixel": list(dx), "unit": "Å", "bytes": int(ew.nbytes)})
    return results


# ---- Bloch waves ---------------------------------------------------------------------------------


def run_bloch(
    atoms: Atoms, p: dict[str, Any], out: Path, report: Report, workers: int = 1,
    cache: bloch_sim.ModeCache | None = None,
) -> list[dict[str, Any]]:
    device, note = devices.resolve(str(p.get("device", "cpu")))
    if note:
        report(0.0, note)
    sim = str(p.get("sim_type", "saed"))
    zone = tuple(float(v) for v in p["zoneAxis"])
    energy = float(p.get("energy_kv", 200.0)) * 1e3
    thick = [float(t) for t in p.get("thicknesses") or []] or [200.0]
    sigma = p.get("thermal_sigma")
    k_max, sg_max = float(p.get("k_max", 2.0)), float(p.get("sg_max", 0.02))
    results: list[dict[str, Any]] = []

    def progress(done: int, total: int) -> None:
        report(0.05 + 0.9 * done / max(total, 1), f"Directions {done:,} of {total:,}")

    report(0.02, "Preparing the beams")
    if sim == "saed":
        setup = bloch_sim.prepare(atoms, zone, energy, k_max=k_max, sg_max=sg_max,
                                  thermal_sigma=sigma)
        pat = bloch_sim.saed(setup, thick, device=device, workers=workers, cache=cache)
        np.savez(out / "saed.npz", hkl=pat.hkl, qxy=pat.qxy, thicknesses=pat.thicknesses,
                 intensity=pat.intensity)
        _spots_png(out / "saed.png", pat.qxy, pat.intensity[-1])
        results.append({"name": "saed", "kind": "spots", "file": "saed.npz", "preview": "saed.png",
                        "sim_type": "saed",
                        "depths": [float(t) for t in pat.thicknesses], "beams": int(len(pat.hkl)),
                        "bytes": int(pat.intensity.nbytes)})
    else:
        pixel = float(p.get("pixel_size", 0.02))
        res = bloch_sim.cbed(
            atoms, zone, energy, float(p.get("alpha_mrad", 5.0)), thick, pixel, k_max=k_max,
            sg_max=sg_max, lacbed=sim == "lacbed", device=device, progress=progress,
            workers=workers, cache=cache, thermal_sigma=sigma,
        )
        if sim == "cbed":
            np.save(out / "cbed.npy", res.images)
            _save_png(out / "cbed.png", res.images[-1], "inferno", log=True)
            lam = bloch_sim.energy2wavelength(energy)
            n_tilts = len(bloch_sim.disc_tilts(float(p.get("alpha_mrad", 5.0)), pixel, lam)[1])
            results.append({"name": "cbed", "kind": "pattern", "file": "cbed.npy",
                            "sim_type": "cbed", "pixel_mrad": [res.pixel_size * lam * 1e3] * 2,
                            "normalisation": n_tilts,  # every incident direction adds 1 to the sum
                            "preview": "cbed.png", "axes": ["depth", "kx", "ky"],
                            "shape": list(res.images.shape), "pixel_inv_a": pixel,
                            "depths": [float(t) for t in res.thicknesses],
                            "bytes": int(res.images.nbytes)})
        else:
            keys = sorted(res.discs or {})
            discs.save(out / "lacbed.npz", keys, res.discs, res.thicknesses, res.mask)
            _save_png(out / "lacbed.png", res.images[-1], "inferno")
            lam = bloch_sim.energy2wavelength(energy)
            n_tilts = int(res.mask.sum())
            results.append({"name": "lacbed", "kind": "discs", "file": "lacbed.npz",
                            "sim_type": "lacbed", "preview": "lacbed.png", "beams": len(keys),
                            "pixel_mrad": [res.pixel_size * lam * 1e3] * 2,
                            "pixel_inv_a": pixel,
                            "normalisation": n_tilts,  # every incident direction adds 1 to the sum
                            "note": "One disc per beam, saved in lacbed.npz under its indices "
                                    "(for example z['0_0_0'] is the direct beam, a stack over "
                                    "the thicknesses).",
                            "axes": ["depth", "kx", "ky"],
                            "shape": [len(res.thicknesses), *res.images.shape[-2:]],
                            "ranges": discs.ranges(keys),
                            "depths": [float(t) for t in res.thicknesses],
                            "bytes": int(sum(v.nbytes for v in res.discs.values()))})
    return results


def _spots_png(path: Path, qxy: np.ndarray, intensity: np.ndarray) -> None:
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib import pyplot as plt

    fig, ax = plt.subplots(figsize=(6.8, 6.8), dpi=PNG_DPI)
    ax.set_facecolor("black")
    s = 4 + 400 * np.sqrt(np.clip(intensity / max(intensity.max(), 1e-30), 0, 1))
    ax.scatter(-qxy[:, 0], qxy[:, 1], s=s, c="white", linewidths=0)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.savefig(path, bbox_inches="tight", facecolor="black", dpi=PNG_DPI)
    plt.close(fig)


# ---- INCOSTEM ------------------------------------------------------------------------------------


def run_incostem(atoms: Atoms, p: dict[str, Any], out: Path, report: Report) -> list[dict[str, Any]]:
    report(0.1, "Computing the image")
    r = incostem.adf_image(atoms, p)
    shape = tuple(r["shape"])
    img = np.frombuffer(base64.b64decode(r["image"]), dtype="<f4").reshape(shape)
    np.save(out / "incostem.npy", img)
    _save_png(out / "incostem.png", img, "gray", pixel=tuple(r["pixel"]))
    meta = {k: v for k, v in r.items() if k not in ("image", "png", "psf")}
    results = [{"name": "incostem", "kind": "image", "file": "incostem.npy",
                "preview": "incostem.png", "axes": ["x", "y"], "shape": list(shape),
                "sim_type": "incostem",
                "pixel": r["pixel"], "unit": "Å", "info": meta, "bytes": int(img.nbytes)}]
    report(1.0, "Done")
    return results


def run(
    method: str, atoms: Atoms, params: dict[str, Any], out: Path, report: Report,
    workers: int = 1, cache: bloch_sim.ModeCache | None = None,
) -> list[dict[str, Any]]:
    out.mkdir(parents=True, exist_ok=True)
    if os.environ.get("EMSIM_TESTING") and params.get("_test") == "crash":  # only reachable with EMSIM_TESTING (see jobs.py)
        os._exit(7)
    if os.environ.get("EMSIM_TESTING") and params.get("_test") == "sleep":
        import time

        for i in range(600):
            report(min(0.9, i / 600), "Sleeping")
            time.sleep(0.1)
    if method == "multislice":
        return run_multislice(atoms, params, out, report, workers)
    if method == "bloch":
        return run_bloch(atoms, params, out, report, workers, cache)
    if method == "incostem":
        return run_incostem(atoms, params, out, report)
    raise ValueError(f"Unknown method {method!r}.")
