"""Pydantic models for the specimen endpoint (context.md M3)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SpecimenRequest(BaseModel):
    structureId: str
    zoneAxis: tuple[int, int, int]
    # Cartesian (crystal frame, Å) direction projected onto the plane normal to the beam to give
    # the specimen y axis, e.g. the 3D view's screen-up; None = projection of b.
    yDirection: tuple[float, float, float] | None = None
    center: Literal["cell", "atom", "origin"] = "cell"
    lateral: tuple[float, float] = (40.0, 40.0)  # Å, minimum extents in x and y
    thickness: float = Field(default=100.0, gt=0)  # Å, rounded to whole repeats along the beam
    # Exact number of periodic cells along specimen x, y and the beam. Overrides lateral/thickness.
    repeats: tuple[int, int, int] | None = None
    vacuum: tuple[float, float] = (0.0, 0.0)  # Å above (entrance) and below (exit)
    strainTolerance: float = Field(default=0.002, gt=0, le=0.2)
    maxRepeatAtoms: int = Field(default=2000, ge=1, le=100_000)
    maxLength: float = Field(default=100.0, gt=1, le=400)
    maxAtoms: int = Field(default=200_000, ge=1, le=5_000_000)
    occupancy: Literal["dominant", "random", "keep"] = "dominant"
    seed: int = 0
    method: Literal["search", "abtem"] = "search"
    abtemRepetitions: int = Field(default=5, ge=1, le=20)
    # An explicit periodic cell (rows: integer lattice vectors t1, t2, zone axis), e.g. a candidate
    supercell: tuple[tuple[int, int, int], tuple[int, int, int], tuple[int, int, int]] | None = None
    compareAbtem: bool = False


class StrainModel(BaseModel):
    max_abs: float
    principal: list[float]
    within_tolerance: bool


class Candidate(BaseModel):
    supercell: list[list[int]]
    natoms: int
    strain: float
    repeat_cell: list[float]


class SpecimenResponse(BaseModel):
    specimenId: str
    structureId: str
    zone_axis: list[int]
    rotation: list[list[float]]  # rows: specimen x, y, z in the crystal Cartesian frame
    method: str
    supercell: list[list[int]] | None
    repeat_cell: list[float]
    natoms_repeat: int
    strain: StrainModel
    repeats: list[int]
    crystal_extent: list[float]
    box: list[float]
    vacuum: list[float]
    natoms: int
    symbols: list[str]
    species: list[int]
    positions: list[float]  # flat x, y, z (Å, specimen frame)
    uiso: list[float | None] | None
    box_corners_crystal: list[list[float]]  # 8 corners (x fastest... see services.specimen)
    centre_crystal: list[float]
    centre_point_crystal: list[float]
    beam_crystal: list[float]
    candidates: list[Candidate]
    abtem: list[dict] | None = None
    warnings: list[str]
