"""Specimen builder (context.md M3): zone axis -> centre -> orthogonal periodic box."""

import json
import time
from pathlib import Path

import numpy as np
import pytest
from ase import Atoms
from ase.geometry import get_distances
from fastapi.testclient import TestClient

from emsim.main import app
from emsim.models.structure import StructurePayload
from emsim.services import specimen as sp
from emsim.services import structure as st

PAYLOADS = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "fixtures" / "payloads"
client = TestClient(app)


def payload(name):
    return StructurePayload(**json.loads((PAYLOADS / f"{name}.json").read_text()))


def atoms(name):
    return st.build_atoms(payload(name))


def specimen_atoms(out) -> Atoms:
    pos = np.array(out["positions"]).reshape(-1, 3)
    return Atoms(symbols=[out["symbols"][i] for i in out["species"]], positions=pos,
                 cell=np.diag(out["box"]), pbc=True)


def min_distance(a: Atoms, limit=3000) -> float:
    a = a[:limit] if len(a) > limit else a
    _, d = get_distances(a.positions, cell=a.cell, pbc=True)
    d[np.diag_indices(len(a))] = np.inf
    return float(d.min())


def min_distance_periodic(a: Atoms) -> float:
    from scipy.spatial import cKDTree

    tree = cKDTree(np.mod(a.positions, np.diag(a.cell)), boxsize=np.diag(a.cell))
    d, _ = tree.query(np.mod(a.positions, np.diag(a.cell)), k=2)
    return float(d[:, 1].min())


# ---- integer lattice helpers -----------------------------------------------------------------


@pytest.mark.parametrize("u", [[1, 0, 0], [0, -1, 0], [1, 1, 0], [1, 1, 1], [2, -1, 3], [-3, 2, 5],
                               [0, 0, 1], [7, 5, 3], [1, -12, 5]])
def test_complete_basis_is_unimodular_with_u_last(u):
    U = sp.complete_basis(sp.reduce_indices(u))
    assert round(np.linalg.det(U)) == 1
    assert list(U[:, 2]) == list(sp.reduce_indices(u))


def test_reduce_indices():
    assert list(sp.reduce_indices([2, 2, 0])) == [1, 1, 0]
    with pytest.raises(ValueError):
        sp.reduce_indices([0, 0, 0])


# ---- geometry and physics of the box ---------------------------------------------------------

CASES = [
    ("Si", (0, 0, 1)), ("Si", (1, 1, 0)), ("Si", (1, 1, 1)), ("graphite", (0, 0, 1)),
    ("graphite", (1, 0, 0)), ("rutile", (0, 0, 1)), ("rutile", (1, 0, 1)),
    ("ZrO2_baddeleyite", (1, 0, 0)), ("ZrO2_baddeleyite", (0, 0, 1)),
    ("olivine_partial", (1, 1, 0)), ("albite", (1, 0, 0)),
]


@pytest.mark.parametrize("name,u", CASES)
def test_box_is_periodic_strained_little_and_along_the_zone_axis(name, u):
    a = atoms(name)
    t0 = time.time()
    out = sp.build(a, u, lateral=(20, 20), thickness=20, occupancy="keep")
    assert time.time() - t0 < 10
    R = np.array(out["rotation"])
    z = np.asarray(u, float) @ a.cell.array
    # the beam is exactly along [uvw] (by construction: the third cell vector is [uvw])
    angle = np.degrees(np.arctan2(np.linalg.norm(np.cross(R[2], z)), R[2] @ z))
    assert angle < 1e-9
    assert out["supercell"][2] == list(sp.reduce_indices(u))
    np.testing.assert_allclose(R @ R.T, np.eye(3), atol=1e-12)
    eps = out["strain"]["max_abs"]
    if name in ("Si", "graphite") or (name == "rutile" and u == (0, 0, 1)):
        assert eps < 1e-12  # exact orthogonal cells exist
    elif name != "albite":
        assert eps <= 0.002  # within the default tolerance
    # atoms per volume = bulk, up to the volume change of the strain
    spec = specimen_atoms(out)
    bulk = len(a) / a.cell.volume
    dens = len(spec) / np.prod(out["crystal_extent"])
    assert dens == pytest.approx(bulk, rel=3 * eps + 1e-9)
    # no seam: across the periodic boundaries no two atoms are closer than in the bulk
    # (mixed sites are kept here, so compare positions merged at 0.05 A)
    bulk_min = min_distance(a) if name not in ("olivine_partial", "albite") else None
    if bulk_min:
        # (positions are rounded to 1e-4 A in the response)
        assert min_distance_periodic(spec) == pytest.approx(bulk_min, rel=2 * eps, abs=3e-4)


def test_extents_and_thickness_round_to_whole_repeats():
    out = sp.build(atoms("Si"), (1, 1, 0), lateral=(30, 25), thickness=100)
    rc = np.array(out["repeat_cell"])
    reps = np.array(out["repeats"])
    assert np.all(np.array(out["crystal_extent"]) == pytest.approx(rc * reps))
    assert out["crystal_extent"][0] >= 30 and out["crystal_extent"][1] >= 25
    assert abs(out["crystal_extent"][2] - 100) <= rc[2] / 2 + 1e-9
    assert out["natoms"] == out["natoms_repeat"] * int(np.prod(reps))


def test_vacuum_is_added_along_the_beam():
    out = sp.build(atoms("Si"), (0, 0, 1), lateral=(10, 10), thickness=20, vacuum=(5, 3))
    pos = np.array(out["positions"]).reshape(-1, 3)
    assert out["box"][2] == pytest.approx(out["crystal_extent"][2] + 8)
    assert pos[:, 2].min() >= 5 - 1e-6
    assert pos[:, 2].max() <= 5 + out["crystal_extent"][2] + 1e-6


@pytest.mark.parametrize("u", [(0, 0, 1), (1, 1, 0), (1, 1, 1)])
def test_centre_on_atom_puts_an_atom_at_the_box_centre(u):
    out = sp.build(atoms("Si"), u, lateral=(30, 30), thickness=40, center="atom")
    pos = np.array(out["positions"]).reshape(-1, 3)
    centre = np.array(out["crystal_extent"]) / 2
    assert np.linalg.norm(pos - centre, axis=1).min() < 1e-3


def test_centre_on_cell_maps_the_cell_centre_to_the_box_centre():
    a = atoms("rutile")
    out = sp.build(a, (0, 0, 1), lateral=(20, 20), thickness=20, center="cell")
    # In rutile the cell centre (1/2, 1/2, 1/2) is a Ti atom.
    pos = np.array(out["positions"]).reshape(-1, 3)
    centre = np.array(out["crystal_extent"]) / 2
    i = np.argmin(np.linalg.norm(pos - centre, axis=1))
    assert np.linalg.norm(pos[i] - centre) < 1e-3
    assert out["symbols"][out["species"][i]] == "Ti"
    # and the overlay geometry agrees: the middle of the box corners is a lattice translation of
    # the chosen centre point
    d = np.array(out["centre_crystal"]) - np.array(out["centre_point_crystal"])
    frac = d @ np.linalg.inv(a.cell.array)
    np.testing.assert_allclose(frac, np.round(frac), atol=1e-6)


def test_graphite_100_and_210_are_different_zone_axes():
    a = atoms("graphite")
    r1 = np.array(sp.build(a, (1, 0, 0), lateral=(10, 10), thickness=10)["rotation"])
    r2 = np.array(sp.build(a, (2, 1, 0), lateral=(10, 10), thickness=10)["rotation"])
    angle = np.degrees(np.arccos(abs(r1[2] @ r2[2])))
    assert angle == pytest.approx(30, abs=1e-6)  # [100] vs the (100) normal [210]


def test_same_request_same_specimen():
    a = atoms("ZrO2_baddeleyite")
    o1 = sp.build(a, (1, 0, 0), lateral=(30, 30), thickness=30)
    o2 = sp.build(a, (1, 0, 0), lateral=(30, 30), thickness=30)
    assert o1["positions"] == o2["positions"] and o1["supercell"] == o2["supercell"]


def test_explicit_supercell_is_used():
    a = atoms("ZrO2_baddeleyite")
    out = sp.build(a, (0, 0, 1), lateral=(10, 10), thickness=10)
    alt = out["candidates"][0]  # the smallest Pareto cell
    o2 = sp.build(a, (0, 0, 1), lateral=(10, 10), thickness=10, supercell=alt["supercell"])
    assert o2["supercell"] == alt["supercell"]
    assert o2["strain"]["max_abs"] == pytest.approx(alt["strain"])
    with pytest.raises(ValueError):
        sp.build(a, (0, 0, 1), supercell=[[1, 0, 0], [0, 1, 0], [1, 1, 0]])


def test_candidates_are_a_pareto_front():
    out = sp.build(atoms("rutile"), (1, 1, 1), lateral=(10, 10), thickness=10)
    c = out["candidates"]
    assert len(c) >= 2
    assert all(c[i]["natoms"] < c[i + 1]["natoms"] for i in range(len(c) - 1))
    assert all(c[i]["strain"] > c[i + 1]["strain"] for i in range(len(c) - 1))


# ---- better than abTEM's route ---------------------------------------------------------------


@pytest.mark.parametrize("name,u", [("ZrO2_baddeleyite", (0, 0, 1)), ("rutile", (1, 1, 1)),
                                    ("ZrO2_baddeleyite", (1, 0, 0)), ("olivine_partial", (1, 1, 0))])
def test_search_beats_abtem_default(name, u):
    a = atoms(name)
    out = sp.build(a, u, lateral=(1, 1), thickness=1, occupancy="keep")
    R = np.array(out["rotation"])
    rows = {r["max_repetitions"]: r for r in sp.abtem_comparison(a, R, 20000) if "strain" in r}
    ab5 = rows[5]
    cands = sp.search_cells(a.cell.array, R, sp.reduce_indices(u), len(a))
    ours_same_size = min(c["strain"] for c in cands if c["natoms"] <= ab5["natoms"])
    assert ours_same_size <= ab5["strain"] + 1e-12  # at most abTEM's size: no worse
    assert out["strain"]["max_abs"] < ab5["strain"] / 5  # chosen cell: much better


def test_abtem_method_is_available():
    out = sp.build(atoms("graphite"), (0, 0, 1), lateral=(10, 10), thickness=10, method="abtem")
    assert out["method"] == "abtem" and out["strain"]["max_abs"] < 1e-9
    assert out["supercell"] is None


# ---- occupancy ---------------------------------------------------------------------------------


def test_dominant_occupancy_gives_whole_atoms_without_overlaps():
    out = sp.build(atoms("olivine_partial"), (0, 0, 1), lateral=(15, 15), thickness=12,
                   occupancy="dominant")
    spec = specimen_atoms(out)
    assert min_distance_periodic(spec) > 1.0
    assert any("Occupancy resolved" in w for w in out["warnings"])
    kept = sp.build(atoms("olivine_partial"), (0, 0, 1), lateral=(15, 15), thickness=12,
                    occupancy="keep")
    assert kept["natoms"] > out["natoms"]


def test_random_occupancy_is_reproducible_and_seed_dependent():
    a = atoms("olivine_partial")
    kw = dict(lateral=(30, 30), thickness=30, occupancy="random")
    r1 = sp.build(a, (0, 0, 1), seed=1, **kw)
    r2 = sp.build(a, (0, 0, 1), seed=1, **kw)
    r3 = sp.build(a, (0, 0, 1), seed=2, **kw)
    assert r1["species"] == r2["species"] and r1["positions"] == r2["positions"]
    assert r1["positions"] != r3["positions"] or r1["species"] != r3["species"]
    # composition close to the CIF's Mg/Fe ratio (~0.54/0.46 on the mixed sites)
    syms = [r1["symbols"][i] for i in r1["species"]]
    fe, mg = syms.count("Fe"), syms.count("Mg")
    assert 0.35 < fe / (fe + mg) < 0.57


def test_atom_limit():
    with pytest.raises(ValueError):
        sp.build(atoms("Si"), (0, 0, 1), lateral=(200, 200), thickness=200, max_atoms=1000)


# ---- endpoint ----------------------------------------------------------------------------------


def test_endpoint():
    p = payload("Si")
    sid = client.post("/api/structure", json=p.model_dump()).json()["structureId"]
    r = client.post("/api/specimen/build", json={"structureId": sid, "zoneAxis": [1, 1, 0],
                                                 "lateral": [20, 20], "thickness": 30,
                                                 "compareAbtem": True})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["natoms"] == len(j["species"]) == len(j["positions"]) // 3
    assert j["strain"]["max_abs"] < 1e-12 and j["abtem"]
    assert len(j["box_corners_crystal"]) == 8
    assert sp.store.get(j["specimenId"]) is not None
    bad = client.post("/api/specimen/build", json={"structureId": sid, "zoneAxis": [0, 0, 0]})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "specimen_failed"
    gone = client.post("/api/specimen/build", json={"structureId": "nope", "zoneAxis": [0, 0, 1]})
    assert gone.status_code == 404
