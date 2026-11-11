"""Jobs: run a simulation in the background, follow it, cancel it (context.md M6)."""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response

from ..models.jobs import DetectorSettings, JobRequest
from ..services import detector, records, viewer
from ..services import jobs as job_service
from ..services import specimen as specimens
from ..services import structure as structures

router = APIRouter(tags=["jobs"])


def _unknown(kind: str, message: str) -> HTTPException:
    return HTTPException(status_code=404, detail={"code": kind, "message": message})


@router.post("/jobs")
def post_job(req: JobRequest) -> dict:
    body = dict(req.body)
    if req.method == "bloch":
        item = structures.store.get(str(body.get("structureId", "")))
        if item is None:
            raise _unknown("unknown_structure", "Load the structure again (the server forgot it).")
        atoms = item[1]
    else:
        atoms = specimens.store.get(str(body.get("specimenId", "")))
        if atoms is None:
            raise _unknown("unknown_specimen", "Build the specimen again (the server forgot it).")
    return job_service.manager.submit(req.method, body, atoms, req.project, req.name)


@router.get("/jobs")
def get_jobs(limit: int = 10000) -> list[dict]:
    return job_service.manager.list_jobs(limit)


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = job_service.manager.get(job_id)
    if job is None:
        raise _unknown("unknown_job", "There is no such job.")
    return job


@router.delete("/jobs/{job_id}")
def delete_job(job_id: str, remove: bool = False) -> dict:
    """Cancel the job if it is running or waiting. With `remove=true` its folder is deleted too."""
    if job_service.manager.get(job_id) is None:
        raise _unknown("unknown_job", "There is no such job.")
    if remove:
        job_service.manager.delete(job_id)
        return {"id": job_id, "removed": True}
    return job_service.manager.cancel(job_id) or {}


@router.post("/jobs/{job_id}/detector")
def post_detector(job_id: str, settings: DetectorSettings) -> dict:
    """Apply the detector settings (pixel size, blur, dose, noise) to a finished job's results.
    The ideal results are not touched; the processed files are written next to them."""
    job = job_service.manager.get(job_id)
    if job is None:
        raise _unknown("unknown_job", "There is no such job.")
    if job["state"] != "done":
        raise HTTPException(status_code=409, detail={
            "code": "job_not_done", "message": "Only a finished run has results to process."})
    try:
        results = detector.process(
            Path(job["directory"]) / "results", job["results"], settings.model_dump()
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"code": "bad_detector", "message": str(e)})
    return job_service.manager.set_results(job_id, results) or {}


@router.delete("/jobs/{job_id}/detector")
def delete_detector(job_id: str) -> dict:
    """Remove every processed file of a finished job; the ideal results stay."""
    job = job_service.manager.get(job_id)
    if job is None:
        raise _unknown("unknown_job", "There is no such job.")
    results = detector.reset(Path(job["directory"]) / "results", job["results"])
    return job_service.manager.set_results(job_id, results) or {}


@router.post("/jobs/{job_id}/open")
def open_job_folder(job_id: str, exports: bool = False) -> dict:
    """Open the job's folder in the file manager of the computer the server runs on."""
    job = job_service.manager.get(job_id)
    if job is None:
        raise _unknown("unknown_job", "There is no such job.")
    folder = Path(job["directory"])
    if exports:
        folder = _exports(job)
    if not folder.is_dir():
        raise _unknown("unknown_folder", "The folder of this job is gone.")
    try:
        job_service.open_folder(folder)
    except OSError as e:
        raise HTTPException(status_code=500, detail={"code": "open_failed", "message": str(e)})
    return {"id": job_id, "directory": str(folder)}


@router.get("/jobs/{job_id}/files/{name:path}")
def get_job_file(job_id: str, name: str) -> FileResponse:
    job = job_service.manager.get(job_id)
    if job is None:
        raise _unknown("unknown_job", "There is no such job.")
    root = (Path(job["directory"]) / "results").resolve()
    path = (root / name).resolve()
    if root not in path.parents or not path.is_file():
        raise _unknown("unknown_file", "There is no such file in this job.")
    # The files of a run can be written again (the processed ones), so the browser must ask.
    return FileResponse(path, headers={"Cache-Control": "no-cache"})


# ---- the results viewer (context.md M7) ------------------------------------------------------------------


def _result(job_id: str, name: str) -> tuple[dict, Path, dict]:
    job = job_service.manager.get(job_id)
    if job is None:
        raise _unknown("unknown_job", "There is no such job.")
    if job["state"] != "done":
        raise HTTPException(status_code=409, detail={
            "code": "job_not_done", "message": "Only a finished run has results to view."})
    try:
        r = viewer.find(job["results"], name)
    except viewer.ViewerError as e:
        raise _unknown("unknown_result", str(e))
    d = Path(job["directory"]) / "results"
    return job, d, records.upgrade(d, r)  # runs of earlier versions: the calibration they lack


def _viewer_call(fn, *args, **kw):
    try:
        return fn(*args, **kw)
    except viewer.ViewerError as e:
        raise HTTPException(status_code=422, detail={"code": "bad_view", "message": str(e)})


def _send(fr: dict) -> Response:
    """A frame as raw float32 bytes (little endian) with its description in the `X-Frame` header:
    no base64, no JSON parsing of a large array."""
    arr = fr.pop("array")
    return Response(arr.astype("<f4", copy=False).tobytes(), media_type="application/octet-stream",
                    headers={"X-Frame": json.dumps(fr), "Cache-Control": "no-cache"})


@router.get("/jobs/{job_id}/frame")
def get_frame(job_id: str, result: str, source: str = "native", run: int = 0, depth: int = 0,
              sample: int = 0, part: str = "intensity", h: int = 0, k: int = 0, l: int = 0,
              v: int | None = None
              ) -> Response:
    """One 2D frame of a result in display orientation (see `_send`). `v` is ignored."""
    _, d, r = _result(job_id, result)
    return _send(_viewer_call(viewer.frame, d, r, source=source, run=run, depth=depth,
                              sample=sample, part=part, h=h, k=k, l=l))


@router.get("/jobs/{job_id}/pattern")
def get_pattern(job_id: str, result: str = "4dstem", source: str = "native", run: int = 0,
                depth: int = 0, sample: int = 0, row: int | None = None,
                col: int | None = None, v: int | None = None) -> Response:
    """4D-STEM: the diffraction pattern at a pixel of the real-space picture (or the mean one)."""
    _, d, r = _result(job_id, result)
    return _send(_viewer_call(viewer.pattern, d, r, source=source, run=run, depth=depth,
                              sample=sample, row=row, col=col))


@router.get("/jobs/{job_id}/virtual")
def get_virtual(job_id: str, result: str = "4dstem", source: str = "native", run: int = 0,
                depth: int = 0, sample: int = 0, shape: str = "disk", inner: float = 0.0,
                outer: float = 10.0, cx: float = 0.0, cy: float = 0.0, v: int | None = None
                ) -> Response:
    """4D-STEM: the virtual image of a disk or annulus in the diffraction pattern (mrad)."""
    _, d, r = _result(job_id, result)
    return _send(_viewer_call(viewer.virtual_image, d, r, source=source, run=run, depth=depth,
                              sample=sample, shape=shape, inner=inner, outer=outer, cx=cx, cy=cy))


@router.get("/jobs/{job_id}/beams")
def get_beams(job_id: str, result: str = "lacbed", source: str = "native") -> dict:
    """LACBED: the beams that have a disc, and the range of h, k and l."""
    _, d, r = _result(job_id, result)
    return _viewer_call(viewer.beams, d, r, source=source)


@router.get("/jobs/{job_id}/spots")
def get_spots(job_id: str, result: str = "saed", source: str = "native", depth: int = 0,
              sample: int = 0, v: int | None = None) -> dict:
    """Bloch SAED: the spots at one thickness."""
    _, d, r = _result(job_id, result)
    return _viewer_call(viewer.spots, d, r, source=source, depth=depth, sample=sample)


def _exports(job: dict) -> Path:
    folder = Path(job["directory"]) / "Exports"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._") or "export"


@router.post("/jobs/{job_id}/export")
def export_result(job_id: str, result: str, format: str = "tiff", source: str = "native",
                  run: int = 0, depth: int = 0, sample: int = 0, part: str = "intensity",
                  h: int = 0, k: int = 0, l: int = 0) -> dict:
    """Save an export in the run's `Exports` folder: `tiff` and `npy` are the frame shown (float32,
    display orientation); `h5` is the whole result with its calibration as attributes."""
    job, d, r = _result(job_id, result)
    stem = _safe(f"{r['name']}_{source}")
    if format == "h5":
        path = _exports(job) / f"{stem}.h5"
        _viewer_call(viewer.export_hdf5, d, r, path, source, job)
    else:
        fr = _viewer_call(viewer.frame, d, r, source=source, run=run, depth=depth, sample=sample,
                          part=part, h=h, k=k, l=l)
        body, _, ext = _viewer_call(viewer.export_frame, fr, format,
                                    {"job": job["name"], "result": r["name"], "run": run,
                                     "depth": depth})
        extra = f"_{part}" if r["kind"] == "wave" else ""
        if r["kind"] == "discs":
            extra = f"_{h}_{k}_{l}"
        path = _exports(job) / f"{stem}{extra}_run{run + 1}_depth{depth + 1}.{ext}"
        path.write_bytes(body)
    return {"path": str(path), "name": path.name, "folder": str(path.parent)}


@router.post("/jobs/{job_id}/export-png")
async def export_png(job_id: str, request: Request, name: str = "image") -> dict:
    """Save the picture the browser drew (the request body is the PNG) in the `Exports` folder."""
    job = job_service.manager.get(job_id)
    if job is None:
        raise _unknown("unknown_job", "There is no such job.")
    data = await request.body()
    if not data.startswith(bytes([0x89]) + b"PNG"):
        raise HTTPException(status_code=422, detail={"code": "bad_png", "message": "Not a PNG."})
    path = _exports(job) / f"{_safe(name)}.png"
    path.write_bytes(data)
    return {"path": str(path), "name": path.name, "folder": str(path.parent)}


@router.websocket("/jobs/{job_id}")
async def job_socket(ws: WebSocket, job_id: str) -> None:
    """Sends the job record whenever it changes, and once more when it ends."""
    await ws.accept()
    last = None
    try:
        while True:
            job = job_service.manager.get(job_id)
            if job is None:
                await ws.send_json({"error": "unknown_job"})
                break
            key = (job["state"], round(job["fraction"], 3), job["message"], job["queue_position"])
            if key != last:
                await ws.send_json(job)
                last = key
            if job["state"] not in job_service.ACTIVE:
                break
            await asyncio.sleep(0.25)
    except WebSocketDisconnect:
        return
    await ws.close()
