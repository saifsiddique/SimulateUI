"""What the results viewer asks of a finished run (context.md M7): one frame of a result as numbers,
a 4D-STEM diffraction pattern or virtual image, the spots of a Bloch SAED, and the exports.

The saved arrays have the layout (see `runs.py`)

    (run, depth, ...)      run = one value of the defocus / tilt series, depth = the thickness series

with 4D-STEM as (run, depth, x, y, kx, ky) and a Bloch CBED as (depth, kx, ky). A processed result
(M6.5) has the same layout, with its own pixel size; when it holds shot noise (`noisy`) the noisy
file is what is shown, and with several noise samples it has one more axis in front.

Frames go to the browser as float32 numbers in *display orientation* (row 0 is the top, +y up, as
the PNG previews), so the browser draws the intensity scale, the colour map, the scale bar and the
line profiles itself and a slider only fetches the next frame.
"""

from __future__ import annotations

import io
import json
from collections import OrderedDict
from pathlib import Path
from typing import Any

import numpy as np

from . import discs as discs_store
from .abtem_sim import display_orientation


class ViewerError(ValueError):
    """The request does not match the result (a missing file, an index out of range)."""


# ---- opening a result ----------------------------------------------------------------------------


def find(results: list[dict[str, Any]], name: str) -> dict[str, Any]:
    for r in results:
        if r["name"] == name:
            return r
    raise ViewerError(f"This run has no result called {name!r}.")


def _trailing(r: dict[str, Any]) -> int:
    """Axes that are not a series: the two of an image or pattern; four for 4D-STEM (scan, pattern)."""
    return 4 if r["name"] == "4dstem" else 2


def _lead(r: dict[str, Any]) -> list[str]:
    """The names of the series axes in front (`run`, `depth`), from the record."""
    if r["name"] == "4dstem":
        return ["run", "depth"]
    axes = r.get("axes") or []
    return [a for a in axes[:-2] if a in ("run", "depth")]


def open_array(directory: Path, r: dict[str, Any], source: str, sample: int = 0):
    """The array of a result (a numpy array, or a zarr array for 4D-STEM), its pixel size and unit.
    `source` is "native" (the ideal simulation) or "processed" (after the Postprocessing card)."""
    p = r.get("processed") if source == "processed" else None
    if source == "processed" and not p:
        raise ViewerError("This result has not been processed.")
    file = (p.get("noisy") or p["file"]) if p else r["file"]
    path = directory / file
    if not path.exists():
        raise ViewerError(f"The file {file} is missing from the run's folder.")
    if file.endswith(".zarr"):
        import zarr

        a = zarr.open(str(path), mode="r")
    else:
        a = np.load(path, mmap_mode="r")
    n_lead = len(_lead(r))
    if a.ndim == n_lead + _trailing(r) + 1:  # several noise samples: a sample axis in front
        a = a[min(max(sample, 0), a.shape[0] - 1)]
    pixel = (p.get("pixel") if p else (r.get("pixel_mrad") if r["kind"] == "pattern" else r.get("pixel")))
    unit = (p.get("unit") if p else None) or ("mrad" if r["kind"] == "pattern" else r.get("unit", ""))
    return a, (tuple(float(v) for v in pixel) if pixel else None), unit


def _open_discs(directory: Path, r: dict[str, Any], source: str):
    """The LACBED discs of a result (native, or processed: the noisy file when there is one)."""
    p = r.get("processed") if source == "processed" else None
    if source == "processed" and not p:
        raise ViewerError("This result has not been processed.")
    file = (p.get("noisy") or p["file"]) if p else r["file"]
    if not (directory / file).exists():
        raise ViewerError(f"The file {file} is missing from the run's folder.")
    pixel = p.get("pixel") if p else r.get("pixel_mrad")
    return discs_store.load(directory / file), (tuple(pixel) if pixel else None), None


def beams(directory: Path, r: dict[str, Any], source: str = "native") -> dict[str, Any]:
    """The beams of a LACBED result: every (h, k, l) that has a disc, and the range of each index."""
    if r["kind"] != "discs":
        raise ViewerError("This result has no beams.")
    data, _, _ = _open_discs(directory, r, source)
    return {"hkl": [list(h) for h in data["hkl"]], "ranges": discs_store.ranges(data["hkl"])}


def _index(a, r: dict[str, Any], run: int, depth: int):
    """The sub-array at one run and depth (series axes the result does not have are skipped)."""
    idx: list[int] = []
    for role in _lead(r):
        want = run if role == "run" else depth
        idx.append(min(max(int(want), 0), a.shape[len(idx)] - 1))
    return a[tuple(idx)] if idx else a


def _pack(img: np.ndarray, pixel: tuple[float, float] | None, unit: str, **extra: Any) -> dict[str, Any]:
    """A frame for the browser. `img` is in display orientation (rows, columns). The frame's
    description is a dict; the numbers are under "array" (the API sends them as raw bytes)."""
    img = np.ascontiguousarray(img, dtype=np.float32)
    finite = img[np.isfinite(img)]
    return {
        "shape": [int(img.shape[0]), int(img.shape[1])],
        "pixel": list(pixel) if pixel else None,
        "unit": unit,
        "min": float(finite.min()) if finite.size else 0.0,
        "max": float(finite.max()) if finite.size else 0.0,
        **extra,
        "array": img,  # the numbers; the API sends them as raw bytes beside the rest
    }


_BLOCKS: "OrderedDict[tuple, np.ndarray]" = OrderedDict()


def _block4d(directory: Path, r: dict[str, Any], source: str, run: int, depth: int, sample: int):
    """The (x, y, kx, ky) block of one run and depth, kept in memory for the next request (dragging
    a detector slider asks for many virtual images of the same block)."""
    p = r.get("processed") if source == "processed" else None
    key = (str(directory), r["name"], source, run, depth, sample, p.get("stamp") if p else None)
    hit = _BLOCKS.get(key)
    if hit is not None:
        _BLOCKS.move_to_end(key)
        return hit
    a, pixel, unit = open_array(directory, r, source, sample)
    block = np.asarray(_index(a, r, run, depth), dtype=np.float32)
    _BLOCKS[key] = block
    while len(_BLOCKS) > 2 or sum(b.nbytes for b in _BLOCKS.values()) > 2e9:
        if len(_BLOCKS) <= 1:
            break
        _BLOCKS.popitem(last=False)
    return block


# ---- frames ----------------------------------------------------------------------------------------


def frame(directory: Path, r: dict[str, Any], *, source: str = "native", run: int = 0, depth: int = 0,
          sample: int = 0, part: str = "intensity", h: int = 0, k: int = 0, l: int = 0
          ) -> dict[str, Any]:
    """One 2D frame of an image, pattern, exit wave or LACBED disc, at a run and a depth."""
    kind = r["kind"]
    if kind == "spots":
        raise ViewerError("A spot pattern has no frames; ask for its spots.")
    if kind == "discs":
        data, pixel, _ = _open_discs(directory, r, source)
        key = (int(h), int(k), int(l))
        if key not in data["discs"]:
            rg = discs_store.ranges(data["hkl"])
            raise ViewerError(
                f"There is no disc for {key[0]} {key[1]} {key[2]}. The beams have h from {rg['h'][0]} "
                f"to {rg['h'][1]}, k from {rg['k'][0]} to {rg['k'][1]}, l from {rg['l'][0]} to "
                f"{rg['l'][1]}, but not every combination is a beam.")
        stack = data["discs"][key]
        if stack.ndim == 4:  # noise samples in front
            stack = stack[min(max(sample, 0), stack.shape[0] - 1)]
        d = min(max(int(depth), 0), stack.shape[0] - 1)
        return _pack(display_orientation(np.asarray(stack[d])), pixel, "mrad" if pixel else "",
                     hkl=list(key), label=f"{key[0]} {key[1]} {key[2]}")
    if r["name"] == "4dstem":
        return pattern(directory, r, source=source, run=run, depth=depth, sample=sample)
    a, pixel, unit = open_array(directory, r, source, sample)
    sub = np.asarray(_index(a, r, run, depth))
    if np.iscomplexobj(sub):
        sub = {"phase": np.angle(sub), "amplitude": np.abs(sub)}.get(part, np.abs(sub) ** 2)
        if part == "phase":
            unit = unit or "Å"
    return _pack(display_orientation(sub), pixel, unit)


def pattern(directory: Path, r: dict[str, Any], *, source: str = "native", run: int = 0, depth: int = 0,
            sample: int = 0, row: int | None = None, col: int | None = None) -> dict[str, Any]:
    """A 4D-STEM diffraction pattern: the one at a pixel of the (displayed) real-space picture, or
    the mean over the whole scan."""
    if r["name"] != "4dstem":
        raise ViewerError("Only 4D-STEM has a pattern for every scan position.")
    _, pixel, unit = open_array(directory, r, source, sample)
    block = _block4d(directory, r, source, run, depth, sample)  # (x, y, kx, ky)
    nx, ny = int(block.shape[0]), int(block.shape[1])
    if row is None or col is None:
        data = block.mean(axis=(0, 1), dtype=np.float64)
        where = None
    else:
        # display_orientation: row i, column j is array element [nx - 1 - j, ny - 1 - i]
        ix = min(max(nx - 1 - int(col), 0), nx - 1)
        iy = min(max(ny - 1 - int(row), 0), ny - 1)
        data = np.asarray(block[ix, iy])
        where = [int(row), int(col)]
    return _pack(display_orientation(data), pixel, unit, position=where, scan_shape=[nx, ny])


def virtual_image(directory: Path, r: dict[str, Any], *, source: str = "native", run: int = 0,
                  depth: int = 0, sample: int = 0, shape: str = "disk", inner: float = 0.0,
                  outer: float = 10.0, cx: float = 0.0, cy: float = 0.0) -> dict[str, Any]:
    """A virtual image of a 4D-STEM scan: the intensity inside a disk or an annulus of the
    diffraction pattern (radii in mrad, centre offset from the direct beam in mrad)."""
    if r["name"] != "4dstem":
        raise ViewerError("A virtual image needs 4D-STEM data.")
    if shape not in ("disk", "annulus"):
        raise ViewerError("The virtual detector is a disk or an annulus.")
    _, pixel, _ = open_array(directory, r, source, sample)
    if not pixel:
        raise ViewerError("This result does not record its diffraction pixel.")
    block = _block4d(directory, r, source, run, depth, sample)  # (x, y, kx, ky)
    nkx, nky = block.shape[2:]
    # the direct beam is at pixel n // 2 of each axis (see runs._crop_bin)
    kx = (np.arange(nkx) - nkx // 2) * pixel[0] - cx
    ky = (np.arange(nky) - nky // 2) * pixel[1] - cy
    rr = np.hypot(kx[:, None], ky[None, :])
    lo = 0.0 if shape == "disk" else max(0.0, float(inner))
    mask = ((rr >= lo) & (rr <= float(outer))).astype(np.float32)
    if shape == "disk":
        mask = (rr <= float(outer)).astype(np.float32)
    img = np.tensordot(block, mask, axes=([2, 3], [0, 1]))  # (x, y)
    scan = r.get("scan_pixel")
    return _pack(display_orientation(img), tuple(scan) if scan else None, "Å",
                 pixels_in_detector=int(mask.sum()))


# ---- Bloch spot patterns -----------------------------------------------------------------------------


def spots(directory: Path, r: dict[str, Any], *, source: str = "native", depth: int = 0,
          sample: int = 0) -> dict[str, Any]:
    """The spots of a Bloch SAED at one thickness: Miller indices, positions (Å⁻¹) and intensities."""
    if r["kind"] != "spots":
        raise ViewerError("This result is not a spot pattern.")
    p = r.get("processed") if source == "processed" else None
    if source == "processed" and not p:
        raise ViewerError("This result has not been processed.")
    z = np.load(directory / (p["file"] if p else r["file"]))
    key = "noisy" if p and "noisy" in z.files else "intensity"
    inten = np.asarray(z[key], dtype=float)
    if inten.ndim == 3:  # a noise sample axis in front
        inten = inten[min(max(sample, 0), inten.shape[0] - 1)]
    d = min(max(int(depth), 0), inten.shape[0] - 1)
    return {
        "hkl": np.asarray(z["hkl"]).tolist(),
        "qxy": np.asarray(z["qxy"], dtype=float).tolist(),
        "intensity": inten[d].tolist(),
        "depth": float(np.asarray(z["thicknesses"])[d]) if "thicknesses" in z.files else None,
        "unit": "Å⁻¹",
    }


# ---- export --------------------------------------------------------------------------------------------


def frame_array(fr: dict[str, Any]) -> np.ndarray:
    """The numbers of a packed frame."""
    return fr["array"]


def export_frame(fr: dict[str, Any], fmt: str, meta: dict[str, Any]) -> tuple[bytes, str, str]:
    """A frame as TIFF (float32, with its pixel size) or NPY: (bytes, media type, extension)."""
    a = frame_array(fr)
    buf = io.BytesIO()
    if fmt == "npy":
        np.save(buf, a)
        return buf.getvalue(), "application/octet-stream", "npy"
    if fmt == "tiff":
        import tifffile

        px = fr.get("pixel")
        kw: dict[str, Any] = {}
        if px:
            kw = {"resolution": (1.0 / px[0], 1.0 / px[1]), "resolutionunit": "NONE"}
        tifffile.imwrite(buf, a, metadata={**meta, "unit": fr.get("unit", ""), "pixel": px,
                                           "orientation": "rows from the top (+y up), columns +x to the left"},
                         **kw)
        return buf.getvalue(), "image/tiff", "tif"
    raise ViewerError("Frames export as TIFF or NPY.")


def export_hdf5(directory: Path, r: dict[str, Any], path: Path, source: str, job: dict[str, Any]) -> None:
    """The whole result as an HDF5 file: `data` in the saved layout plus its calibration as attributes
    (readable with h5py, no extra package). Spot patterns and LACBED discs keep their named arrays."""
    import h5py

    with h5py.File(path, "w") as f:
        f.attrs["name"] = r["name"]
        f.attrs["kind"] = r["kind"]
        f.attrs["job"] = job.get("name", "")
        f.attrs["method"] = str(job.get("method", ""))
        f.attrs["source"] = source
        for key in ("energy_kv", "sim_type"):
            if r.get(key) is not None:
                f.attrs[key] = r[key]
        if r["kind"] == "discs":
            data, pixel, _ = _open_discs(directory, r, source)
            g = f.create_group("discs")  # discs["h_k_l"] is one beam: (depth, y, x), or (sample, ...)
            for h, stack in data["discs"].items():
                g.create_dataset(discs_store.name(h), data=stack, compression="gzip")
            f.create_dataset("hkl", data=np.array(data["hkl"], dtype=int))
            f.create_dataset("thicknesses_A", data=data["thicknesses"])
            if data["mask"] is not None:
                f.create_dataset("mask", data=data["mask"])
            g.attrs["axes"] = json.dumps(["depth", "kx", "ky"])
            g.attrs["unit"] = "mrad"
            if pixel:
                g.attrs["pixel"] = np.asarray(pixel)
            return
        if r["kind"] == "spots":
            p = r.get("processed") if source == "processed" else None
            z = np.load(directory / (p["file"] if p else r["file"]))
            for k in z.files:
                f.create_dataset(k, data=z[k], compression="gzip")
            return
        a, pixel, unit = open_array(directory, r, source)
        if hasattr(a, "chunks") and r["name"] == "4dstem":
            ds = f.create_dataset("data", shape=a.shape, dtype=a.dtype, chunks=True, compression="gzip")
            for i in range(a.shape[2]):  # one scan row at a time
                ds[:, :, i] = a[:, :, i]
        else:
            f.create_dataset("data", data=np.asarray(a), compression="gzip")
        axes = r.get("axes")
        n = f["data"].ndim
        lead = _lead(r)
        names = (["sample"] if n > len(lead) + _trailing(r) else []) + lead
        names += ["x", "y", "kx", "ky"] if r["name"] == "4dstem" else (
            ["kx", "ky"] if r["kind"] == "pattern" else ["x", "y"])
        f["data"].attrs["axes"] = json.dumps(names if len(names) == n else (axes or []))
        f["data"].attrs["unit"] = unit
        if pixel:
            f["data"].attrs["pixel"] = np.asarray(pixel)
        if r.get("scan_pixel"):
            f["data"].attrs["scan_pixel_A"] = np.asarray(r["scan_pixel"])
        if r.get("depths") is not None:
            f["data"].attrs["depths_A"] = np.asarray(r["depths"], dtype=float)
        if r.get("runs"):
            f["data"].attrs["runs"] = json.dumps(r["runs"])
        f["data"].attrs["orientation"] = "array[x, y]: x first, as abTEM"
