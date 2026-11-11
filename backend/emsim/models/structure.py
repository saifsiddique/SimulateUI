"""Pydantic models for the structure endpoints (context.md M2, mirrors frontend/src/api/client.ts)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CellModel(BaseModel):
    a: float = Field(gt=0)
    b: float = Field(gt=0)
    c: float = Field(gt=0)
    alpha: float = Field(gt=0, lt=180)
    beta: float = Field(gt=0, lt=180)
    gamma: float = Field(gt=0, lt=180)


class AtomModel(BaseModel):
    element: str
    frac: tuple[float, float, float]
    occupancy: float = 1.0
    uiso: float | None = None


class SpaceGroupModel(BaseModel):
    number: int | None = None
    symbol: str | None = None


class StructurePayload(BaseModel):
    """The P1 unit cell built by the browser (`buildCrystal`), plus the raw CIF for a cross-check."""

    rawCif: str = ""
    fileName: str = ""
    cell: CellModel
    atoms: list[AtomModel] = Field(min_length=1)
    spaceGroup: SpaceGroupModel = SpaceGroupModel()


class StructureSummary(BaseModel):
    natoms: int
    formula: str
    cell: CellModel
    volume: float
    density: float  # g/cm^3, occupancy-weighted
    orthogonal: bool
    partial_sites: int  # atoms with occupancy < 1


class StructureResponse(BaseModel):
    structureId: str
    summary: StructureSummary
    warnings: list[str]


class OrthogonalizeRequest(BaseModel):
    structureId: str
    maxRepetitions: int | None = Field(
        default=None, ge=1, le=20, description="abTEM max_repetitions; None = choose automatically"
    )
    strainTolerance: float = Field(
        default=0.01, gt=0, le=1, description="Used by the automatic choice (fraction)"
    )
    maxAtoms: int = Field(default=20000, ge=1)


class OrthogonalAtom(BaseModel):
    element: str
    frac: tuple[float, float, float]
    occupancy: float
    uiso: float | None = None
    source: int = Field(description="Index of the unit-cell atom this one is a copy of")


class StrainInfo(BaseModel):
    principal: tuple[float, float, float]  # eigenvalues of the stretch tensor minus 1
    max_abs: float
    rotation_deg: float
    volume_change: float  # fractional


class OrthogonalizeResponse(BaseModel):
    structureId: str
    already_orthogonal: bool
    max_repetitions: int
    volume_ratio: float  # orthogonal box volume / unit-cell volume (= atoms ratio)
    cell: tuple[float, float, float]  # orthogonal box lengths (A)
    natoms: int
    strain: StrainInfo
    atoms: list[OrthogonalAtom]
    candidates: list[dict]  # (max_repetitions, natoms, strain) tried by the automatic search
    warnings: list[str]
