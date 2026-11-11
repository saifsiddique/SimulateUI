"""What a detector would record (context.md M6.5): the pixel size, a Gaussian blur, the dose and shot
noise, applied to the saved results of a finished run.

The simulation always saves the ideal result at its native sampling; this module derives the rest
from those files, so the settings can be changed and applied again without simulating again.
The order is fixed:

    native result -> pixel size (Fourier interpolation) -> Gaussian smoothing -> dose -> shot noise

Units. Images (HRTEM, STEM, INCOSTEM) have their pixel in Å; diffraction patterns (SAED, CBED,
4D-STEM) in mrad. Patterns hold the fraction of the incident electrons in each pixel (the whole
pattern sums to 1), so interpolation keeps their sum; images hold a value per pixel (a fraction of
the probe's electrons for STEM, the intensity relative to the incident beam for HRTEM), so
interpolation keeps their values. Expected counts = value x electrons, where the electrons are

    HRTEM                           dose per area (e-/Å²) x the area of the output pixel
    STEM, INCOSTEM, 4D-STEM         probe current x dwell time, per position
    SAED, CBED (any method)         beam current x exposure time, in the pattern

Fourier interpolation adds no information: a finer pixel is a band-limited resampling, a coarser
one is a reduction without aliasing. The edges of a picture are not periodic, so it is mirror-padded
before the transform and cropped after; the pixel size reached is reported.
"""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path
from typing import Any

import numpy as np

from . import records

#: Electrons in a current of 1 pA flowing for 1 µs.
E_PER_PA_US = 1e-12 * 1e-6 / 1.602176634e-19

#: Result kinds that are not processed, and why.
SKIPPED = {
    "wave": "The exit wave is complex and has no counts; it is not processed.",
}


# ---- pixel size ------------------------------------------------------------------------------------


def _resize_axis(F: np.ndarray, m: int, axis: int) -> np.ndarray:
    """Crop or zero-pad a centred (fftshifted) spectrum to m samples along `axis`."""
    n = F.shape[axis]
    if m == n:
        return F
    c_old, c_new = n // 2, m // 2
    lo = min(c_old, c_new)
    hi = min(n - c_old, m - c_new)
    out_shape = list(F.shape)
    out_shape[axis] = m
    out = np.zeros(out_shape, dtype=F.dtype)
    src = [slice(None)] * F.ndim
    dst = [slice(None)] * F.ndim
    src[axis] = slice(c_old - lo, c_old + hi)
    dst[axis] = slice(c_new - lo, c_new + hi)
    out[tuple(dst)] = F[tuple(src)]
    return out


def fft_resize(a: np.ndarray, mx: int, my: int, keep: str = "values") -> np.ndarray:
    """The last two axes of `a` on a grid of (mx, my) samples over the same extent, by Fourier
    interpolation. `keep` is "values" (the mean is kept: images) or "sum" (the total is kept:
    patterns)."""
    nx, ny = a.shape[-2:]
    out = np.empty((*a.shape[:-2], mx, my), dtype=np.float64)
    flat_in = a.reshape(-1, nx, ny)
    flat_out = out.reshape(-1, mx, my)
    scale = (mx * my) / (nx * ny) if keep == "values" else 1.0
    for i in range(flat_in.shape[0]):
        F = np.fft.fftshift(np.fft.fft2(flat_in[i]))
        F = _resize_axis(_resize_axis(F, mx, 0), my, 1)
        flat_out[i] = np.fft.ifft2(np.fft.ifftshift(F)).real * scale
    return out


def _pad_width(n: int) -> int:
    return min(n - 1, max(2, n // 8))


def _plan(n: int, p: float, target: float) -> tuple[int, int, int, float]:
    """One axis: the mirror padding, the size of the padded transform, the size of the output and
    the pixel size reached. The padded size is the nearest whole number of target pixels; the
    output (cropped from its centre) has the same parity, and is as close to the field of view as
    that allows."""
    pad = _pad_width(n)
    total = n + 2 * pad
    m_total = max(2, int(round(total * p / target)))
    want = n * p / target
    m = max(1, int(round(want)))
    if (m_total - m) % 2:
        m = m + 1 if want > m or m == 1 else m - 1
    m = min(m, m_total)
    return pad, m_total, m, total * p / m_total


def target_shape(shape: tuple[int, int], native: tuple[float, float], target: float
                 ) -> tuple[tuple[int, int], tuple[float, float]]:
    """The shape of the output and the pixel size actually reached, for a target pixel size."""
    plans = [_plan(n, p, target) for n, p in zip(shape, native)]
    return (plans[0][2], plans[1][2]), (plans[0][3], plans[1][3])


def resample(a: np.ndarray, native: tuple[float, float], target: float, keep: str
             ) -> tuple[np.ndarray, tuple[float, float]]:
    """`a` (..., nx, ny) at the pixel size `native` (x, y) on a grid of pixels of size `target`.
    Returns the new array and the pixel size reached. The size of a pixel that is already the
    target (within 0.1 %) is left alone."""
    nx, ny = a.shape[-2:]
    if max(abs(native[0] / target - 1), abs(native[1] / target - 1)) < 1e-3:
        return a, native
    (padx, mxp, mx, gx), (pady, myp, my, gy) = (_plan(nx, native[0], target),
                                                 _plan(ny, native[1], target))[0:2]
    padded = np.pad(a, [(0, 0)] * (a.ndim - 2) + [(padx, padx), (pady, pady)], mode="reflect")
    big = fft_resize(padded, mxp, myp, keep)
    ox, oy = (mxp - mx) // 2, (myp - my) // 2
    return np.ascontiguousarray(big[..., ox : ox + mx, oy : oy + my]), (gx, gy)


def smooth(a: np.ndarray, sigma: float, pixel: tuple[float, float]) -> np.ndarray:
    """A Gaussian blur of standard deviation `sigma` (in the unit of the pixel size) on the last
    two axes."""
    if sigma <= 0:
        return a
    from scipy.ndimage import gaussian_filter

    s = (0.0,) * (a.ndim - 2) + (sigma / pixel[0], sigma / pixel[1])
    return gaussian_filter(a, sigma=s, mode="reflect")


# ---- dose and noise --------------------------------------------------------------------------------


def electrons(dose: dict[str, Any] | None, sim_type: str, pixel: tuple[float, float]) -> float | None:
    """The electrons that one unit of the (normalised) result stands for, or None without a dose."""
    if not dose:
        return None
    if sim_type == "hrtem":
        d = dose.get("dose_per_area")
        if not d or d <= 0:
            raise ValueError("HRTEM needs a dose per area (e-/Å²).")
        return float(d) * pixel[0] * pixel[1]
    n = dose.get("electrons")
    if n:
        return float(n)  # per scan position, or in the pattern
    i, t = dose.get("current_pa"), dose.get("time_us")
    if not i or not t or i <= 0 or t <= 0:
        raise ValueError("Give the electrons per position (or per pattern), or a current and a time.")
    return float(i) * float(t) * E_PER_PA_US


def shot_noise(expected: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    return rng.poisson(np.clip(expected, 0.0, None)).astype(np.uint32)


# ---- one result ------------------------------------------------------------------------------------


def _native_pixel(r: dict[str, Any]) -> tuple[float, float] | None:
    v = r.get("pixel_mrad") if r["kind"] in ("pattern", "discs") else r.get("pixel")
    return (float(v[0]), float(v[1])) if v else None


def _chain(block: np.ndarray, r: dict[str, Any], s: dict[str, Any], native: tuple[float, float],
           keep: str) -> tuple[np.ndarray, tuple[float, float]]:
    a = np.asarray(block, dtype=np.float64) / float(r.get("normalisation") or 1.0)
    px = native
    if s["pixel_mode"] == "target":
        a, px = resample(a, native, float(s["target"]), keep)
        if keep == "sum":
            # The interpolation rings below zero around sharp spots; counts cannot be negative.
            # Cut the negative part and rescale every pattern so that its total is kept.
            total = a.sum(axis=(-2, -1), keepdims=True)
            a = np.clip(a, 0.0, None)
            now = a.sum(axis=(-2, -1), keepdims=True)
            a = a * np.divide(total, now, out=np.ones_like(total), where=now > 0)
    return smooth(a, float(s.get("smoothing") or 0.0), px), px


def _counts(a: np.ndarray, e: float | None, s: dict[str, Any], rng: np.random.Generator
            ) -> tuple[np.ndarray, np.ndarray | None]:
    """The expected counts (or the values, without a dose) and the noisy samples."""
    if e is None:
        return a.astype(np.float32), None
    expected = a * e
    if not s.get("noise"):
        return expected.astype(np.float32), None
    n = max(1, int(s.get("samples") or 1))
    noisy = np.stack([shot_noise(expected, rng) for _ in range(n)])
    return expected.astype(np.float32), noisy if n > 1 else noisy[0]


def _preview(path: Path, show: np.ndarray, r: dict[str, Any], pixel: tuple[float, float]) -> None:
    from .runs import _save_png

    pattern = r["kind"] == "pattern"
    _save_png(path, show, "inferno" if pattern else "gray", log=pattern, pixel=pixel)


def _process_image_or_pattern(d: Path, r: dict[str, Any], s: dict[str, Any], rng) -> dict[str, Any]:
    native = _native_pixel(r)
    if native is None:
        raise ValueError(f"{r['name']}: this run does not record its pixel size; run it again.")
    keep = "sum" if r["kind"] == "pattern" else "values"
    sim = str(r.get("sim_type") or "")
    name = r["name"]
    zarr_input = r["file"].endswith(".zarr")
    out: dict[str, Any] = {"unit": "mrad" if r["kind"] == "pattern" else "Å", "samples": 1}
    if zarr_input:
        import zarr

        z = zarr.open(str(d / r["file"]), mode="r")
        # 4D-STEM: (run, depth, x, y, kx, ky); one scan row at a time, the patterns are the last axes.
        shape = tuple(z.shape)
        (mx, my), got = (
            target_shape(shape[-2:], native, float(s["target"]))
            if s["pixel_mode"] == "target" else (shape[-2:], native)
        )
        e = electrons(s.get("dose"), sim, got)
        n_samples = max(1, int(s.get("samples") or 1)) if e is not None and s.get("noise") else 0
        out_shape = (*shape[:-2], mx, my)
        pz = zarr.open(str(d / f"{name}_processed.zarr"), mode="w", shape=out_shape,
                       dtype="float32", chunks=(1, 1, *out_shape[2:3], 1, min(mx, 64), min(my, 64)))
        nz = None
        if n_samples:
            nshape = (n_samples, *out_shape) if n_samples > 1 else out_shape
            nz = zarr.open(str(d / f"{name}_noisy.zarr"), mode="w", shape=nshape, dtype="uint32",
                           chunks=((1,) if n_samples > 1 else ()) + (1, 1, 1, 1, min(mx, 64), min(my, 64)))
        total = np.zeros((mx, my))
        for i in range(shape[2]):
            block = np.asarray(z[:, :, i])  # (run, depth, y, kx, ky)
            a, got = _chain(block, r, s, native, keep)
            exp, noisy = _counts(a, e, s, rng)
            pz[:, :, i] = exp
            if nz is not None and noisy is not None:
                if n_samples > 1:
                    nz[:, :, :, i] = noisy
                else:
                    nz[:, :, i] = noisy
            shown = noisy if noisy is not None and n_samples == 1 else (noisy[0] if noisy is not None else exp)
            total += np.asarray(shown)[-1, -1].sum(axis=0)
        show = total / (shape[2] * shape[3])
        out.update(file=f"{name}_processed.zarr", noisy=f"{name}_noisy.zarr" if nz is not None else None,
                   shape=list(out_shape), samples=n_samples or 1)
    else:
        data = np.load(d / r["file"])
        a, got = _chain(data, r, s, native, keep)
        e = electrons(s.get("dose"), sim, got)
        exp, noisy = _counts(a, e, s, rng)
        np.save(d / f"{name}_processed.npy", exp)
        out.update(file=f"{name}_processed.npy", noisy=None, shape=list(exp.shape))
        first = exp
        if noisy is not None:
            np.save(d / f"{name}_noisy.npy", noisy)
            out.update(noisy=f"{name}_noisy.npy", samples=int(noisy.shape[0]) if noisy.ndim > exp.ndim else 1)
            first = noisy[0] if noisy.ndim > exp.ndim else noisy
        show = np.asarray(first)[(-1,) * (np.asarray(first).ndim - 2)]
    out["pixel"] = [float(got[0]), float(got[1])]
    out["electrons"] = None if e is None else float(e)
    out["preview"] = f"{name}_processed.png"
    _preview(d / out["preview"], show, r, got)
    out["counts_max"] = float(np.max(show)) if e is not None else None
    return out


def _process_discs(d: Path, r: dict[str, Any], s: dict[str, Any], rng) -> dict[str, Any]:
    """LACBED: every disc is a pattern (pixel size, blur, dose, noise), saved under its indices in
    `lacbed_processed.npz` (expected counts) and `lacbed_noisy.npz` (counts), as `lacbed.npz`."""
    from . import discs as store
    from .runs import _save_png

    native = _native_pixel(r)
    if native is None:
        raise ValueError(f"{r['name']}: this run does not record its pixel size; run it again.")
    data = store.load(d / r["file"])
    name = r["name"]
    out_exp, out_noisy = {}, {}
    got, e, n_samples = native, None, 1
    for h, stack in data["discs"].items():
        a, got = _chain(stack, r, s, native, "sum")
        e = electrons(s.get("dose"), "lacbed", got)
        exp, noisy = _counts(a, e, s, rng)
        out_exp[h] = exp
        if noisy is not None:
            out_noisy[h] = noisy
            n_samples = int(noisy.shape[0]) if noisy.ndim > exp.ndim else 1
    hkl = list(data["discs"])
    store.save(d / f"{name}_processed.npz", hkl, out_exp, data["thicknesses"])
    if out_noisy:
        store.save(d / f"{name}_noisy.npz", hkl, out_noisy, data["thicknesses"])
    zero = (0, 0, 0) if (0, 0, 0) in out_exp else hkl[0]
    shown = out_noisy.get(zero, out_exp[zero])
    shown = np.asarray(shown)
    if shown.ndim > out_exp[zero].ndim:
        shown = shown[0]
    _save_png(d / f"{name}_processed.png", shown[-1], "inferno", log=True, pixel=got)
    shape = list(out_exp[zero].shape)
    return {"file": f"{name}_processed.npz", "noisy": f"{name}_noisy.npz" if out_noisy else None,
            "preview": f"{name}_processed.png", "shape": shape, "pixel": [float(got[0]), float(got[1])],
            "unit": "mrad", "electrons": None if e is None else float(e), "samples": n_samples,
            "counts_max": float(np.max(shown)) if e is not None else None}


def _process_spots(d: Path, r: dict[str, Any], s: dict[str, Any], rng) -> dict[str, Any]:
    from .runs import _spots_png

    z = np.load(d / r["file"])
    e = electrons(s.get("dose"), str(r.get("sim_type") or "saed"), (1.0, 1.0))
    exp, noisy = _counts(np.asarray(z["intensity"], dtype=float), e, s, rng)
    name = r["name"]
    arrays = {k: z[k] for k in z.files if k != "intensity"}
    arrays["intensity"] = exp
    if noisy is not None:
        arrays["noisy"] = noisy
    np.savez(d / f"{name}_processed.npz", **arrays)
    last = exp if noisy is None else (noisy[0] if noisy.ndim > exp.ndim else noisy)
    _spots_png(d / f"{name}_processed.png", z["qxy"], np.asarray(last)[-1])
    return {"file": f"{name}_processed.npz", "noisy": None, "preview": f"{name}_processed.png",
            "shape": list(exp.shape), "pixel": None, "unit": "", "electrons": e,
            "samples": 1 if noisy is None or noisy.ndim == exp.ndim else int(noisy.shape[0]),
            "counts_max": None if e is None else float(np.max(last))}


def active(s: dict[str, Any]) -> bool:
    """Whether the settings change anything."""
    return s.get("pixel_mode") == "target" or float(s.get("smoothing") or 0) > 0 or bool(s.get("dose"))


def process(directory: Path, results: list[dict[str, Any]], settings: dict[str, Any]
            ) -> list[dict[str, Any]]:
    """Process every result of a finished run (`directory` is its `results/` folder) and write the
    files next to the ideal ones. Returns the results with a `processed` entry each."""
    s = dict(settings)
    if s.get("noise") and not s.get("dose"):
        raise ValueError("Shot noise needs a dose.")
    if s.get("pixel_mode") == "target" and not float(s.get("target") or 0) > 0:
        raise ValueError("The target pixel size must be positive.")
    rng = np.random.default_rng(int(s.get("seed") or 0))
    out = []
    for r in results:
        r = {k: v for k, v in r.items() if k not in ("processed", "processed_note")}
        r = records.upgrade(directory, r)  # runs of earlier versions: the calibration they lack
        kind = r["kind"]
        if kind in SKIPPED:
            r["processed"], r["processed_note"] = None, SKIPPED[kind]
        elif kind == "spots":
            r["processed"] = _process_spots(directory, r, s, rng)
        elif kind == "discs":
            r["processed"] = _process_discs(directory, r, s, rng)
        else:
            r["processed"] = _process_image_or_pattern(directory, r, s, rng)
        if r.get("processed"):  # the viewer adds it to the picture's address, so a new one is fetched
            r["processed"]["stamp"] = int(time.time() * 1000)
        out.append(r)
    _write_json(directory, s, out)
    return out


def reset(directory: Path, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Remove every processed file of a run and what the records say about them; the ideal results
    stay. Returns the results without their `processed` entries."""
    for f in [*directory.glob("*_processed.*"), *directory.glob("*_noisy.*")]:
        if f.is_dir():
            shutil.rmtree(f, ignore_errors=True)
        else:
            f.unlink(missing_ok=True)
    out = [{k: v for k, v in r.items() if k not in ("processed", "processed_note")} for r in results]
    f = directory / "results.json"
    if f.is_file():
        doc = json.loads(f.read_text(encoding="utf8"))
        doc.get("setup_params", {}).pop("output_processing", None)
        doc["output"] = out
        f.write_text(json.dumps(doc, indent=2), encoding="utf8")
    return out


def _write_json(directory: Path, settings: dict[str, Any], results: list[dict[str, Any]]) -> None:
    f = directory / "results.json"
    doc = json.loads(f.read_text(encoding="utf8")) if f.is_file() else {}
    doc.setdefault("setup_params", {})["output_processing"] = settings
    doc["output"] = results
    f.write_text(json.dumps(doc, indent=2), encoding="utf8")
