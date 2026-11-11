"""INCOSTEM: incoherent ADF-STEM images, computed live (context.md §7.MU step U6)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..models.incostem import IncostemRequest
from ..services import incostem
from ..services import specimen as specimens

router = APIRouter(tags=["incostem"])


@router.post("/incostem")
def post_incostem(req: IncostemRequest) -> dict:
    atoms = specimens.store.get(req.specimenId)
    if atoms is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "unknown_specimen", "message": "Build the specimen again (the server forgot it)."},
        )
    try:
        return incostem.adf_image(atoms, req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"code": "bad_parameters", "message": str(e)})
    except ImportError as e:  # cupy missing for device="gpu"
        raise HTTPException(status_code=422, detail={"code": "no_gpu", "message": f"The GPU is not available: {e}"})
