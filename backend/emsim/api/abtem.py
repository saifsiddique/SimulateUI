from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response

from ..models.abtem import AbtemPreviewRequest
from ..services import abtem_sim
from ..services import specimen as specimens

router = APIRouter(tags=["abtem"])


@router.post("/abtem/probe")
def post_probe(req: AbtemPreviewRequest, fmt: str = "npz") -> Response:
    """The probe intensity as a data file (`fmt` = npz or csv); the request is the preview's."""
    if fmt not in ("npz", "csv"):
        raise HTTPException(
            status_code=422, detail={"code": "bad_parameters", "message": "Format is npz or csv."}
        )
    try:
        data, media, ext = abtem_sim.probe_export(req.model_dump(), fmt)
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"code": "bad_parameters", "message": str(e)})
    return Response(
        content=data, media_type=media,
        headers={"Content-Disposition": f'attachment; filename="probe.{ext}"'},
    )


@router.post("/abtem/preview")
def post_preview(req: AbtemPreviewRequest) -> dict:
    atoms = specimens.store.get(req.specimenId)
    if atoms is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "unknown_specimen", "message": "Build the specimen again (the server forgot it)."},
        )
    try:
        return abtem_sim.preview(atoms, req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"code": "bad_parameters", "message": str(e)})
