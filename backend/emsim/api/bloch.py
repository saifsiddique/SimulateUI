from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..models.bloch import BlochFactorsRequest, BlochPreviewRequest
from ..services import bloch_sim
from ..services import structure as structures

router = APIRouter(tags=["bloch"])


@router.post("/bloch/preview")
def post_preview(req: BlochPreviewRequest) -> dict:
    item = structures.store.get(req.structureId)
    if item is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "unknown_structure", "message": "Load the structure again (the server forgot it)."},
        )
    _, atoms = item
    try:
        out = bloch_sim.preview_pattern(
            atoms, req.zoneAxis, req.energy_kv * 1e3, k_max=req.k_max, sg_max=req.sg_max,
            sim_type=req.sim_type, alpha_mrad=req.alpha_mrad, pixel_size=req.pixel_size,
            thermal_sigma=req.thermal_sigma, workers=req.workers,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"code": "bad_parameters", "message": str(e)})
    out["thicknesses"] = req.thicknesses
    return out


@router.post("/bloch/factors")
def post_factors(req: BlochFactorsRequest) -> dict:
    """The kinematic structure factors of the zone axis, to choose k max from."""
    item = structures.store.get(req.structureId)
    if item is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "unknown_structure", "message": "Load the structure again (the server forgot it)."},
        )
    _, atoms = item
    try:
        return bloch_sim.structure_factors(
            atoms, req.zoneAxis, req.energy_kv * 1e3, g_max=req.g_max, sg_cap=req.sg_cap,
            thermal_sigma=req.thermal_sigma,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"code": "bad_parameters", "message": str(e)})


@router.get("/bloch/cache")
def get_cache() -> dict:
    """Whether a solve is saved in the temporary folder, and how big it is."""
    return bloch_sim.CACHE.info


@router.delete("/bloch/cache")
def delete_cache() -> dict:
    """Delete the saved solve (the next run solves again)."""
    bloch_sim.CACHE.clear()
    return bloch_sim.CACHE.info
