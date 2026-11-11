from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..models.structure import (
    OrthogonalizeRequest,
    OrthogonalizeResponse,
    StructurePayload,
    StructureResponse,
)
from ..services import structure as svc

router = APIRouter(tags=["structure"])


@router.post("/structure", response_model=StructureResponse)
def post_structure(payload: StructurePayload) -> StructureResponse:
    """Register the browser's P1 unit cell; returns an id used by later calls."""
    try:
        return svc.register(payload)
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"code": "bad_structure", "message": str(e)})


@router.post("/structure/orthogonalize", response_model=OrthogonalizeResponse)
def post_orthogonalize(req: OrthogonalizeRequest) -> OrthogonalizeResponse:
    """Orthogonal cell via abTEM's `orthogonalize_cell`, with the strain it introduces."""
    item = svc.store.get(req.structureId)
    if item is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "unknown_structure", "message": "Structure not registered (server restarted?)."},
        )
    payload, atoms = item
    try:
        return svc.orthogonalize(
            payload, atoms, req.structureId, req.maxRepetitions, req.strainTolerance, req.maxAtoms
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"code": "orthogonalize_failed", "message": str(e)})
