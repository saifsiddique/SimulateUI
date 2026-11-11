from __future__ import annotations

import numpy as np
from fastapi import APIRouter, HTTPException

from ..models.specimen import SpecimenRequest, SpecimenResponse
from ..services import specimen as svc
from ..services import structure as structures

router = APIRouter(tags=["specimen"])


@router.post("/specimen/build", response_model=SpecimenResponse)
def post_build(req: SpecimenRequest) -> SpecimenResponse:
    """Zone axis -> centre -> orthogonal periodic box, tiled to the requested extents."""
    item = structures.store.get(req.structureId)
    if item is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "unknown_structure",
                    "message": "Structure not registered (server restarted?)."},
        )
    _, atoms = item
    try:
        out = svc.build(
            atoms,
            req.zoneAxis,
            y_direction=req.yDirection,
            center=req.center,
            lateral=req.lateral,
            thickness=req.thickness,
            repeats_requested=req.repeats,
            vacuum=req.vacuum,
            strain_tolerance=req.strainTolerance,
            max_repeat_atoms=req.maxRepeatAtoms,
            max_length=req.maxLength,
            max_atoms=req.maxAtoms,
            occupancy=req.occupancy,
            seed=req.seed,
            method=req.method,
            supercell=req.supercell,
            abtem_repetitions=req.abtemRepetitions,
        )
    except (ValueError, AssertionError) as e:
        raise HTTPException(status_code=422, detail={"code": "specimen_failed", "message": str(e)})
    specimen = out.pop("atoms_object")
    sid = svc.specimen_id(req.structureId, req.model_dump(exclude={"structureId"}))
    svc.store.put(sid, specimen)
    if req.compareAbtem:
        out["abtem"] = svc.abtem_comparison(atoms, np.array(out["rotation"]), 20000)
    return SpecimenResponse(specimenId=sid, structureId=req.structureId, **out)
