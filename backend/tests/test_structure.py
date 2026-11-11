"""Structure registration and orthogonalisation (context.md M2).

`frontend/tests/fixtures/payloads/*.json` are the browser's exact output for the 7 fixture CIFs
(written by frontend/tests/unit/payload.test.ts with UPDATE_PAYLOADS=1).
"""

import io
import json
import warnings
from pathlib import Path

import numpy as np
import pytest
from ase.io import read
from fastapi.testclient import TestClient

from emsim.main import app
from emsim.models.structure import StructurePayload
from emsim.services import structure as svc

FIXTURES = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "fixtures"
NAMES = sorted(p.stem for p in (FIXTURES / "payloads").glob("*.json"))
client = TestClient(app)


def load(name) -> StructurePayload:
    return StructurePayload(**json.loads((FIXTURES / "payloads" / f"{name}.json").read_text()))


def test_fixture_set():
    assert NAMES == ["NaCl", "Si", "ZrO2_baddeleyite", "albite", "graphite", "olivine_partial",
                     "rutile"]


@pytest.mark.parametrize("name", NAMES)
def test_browser_and_ase_agree(name):
    """Cell (to 1e-6 A) and atom count from the browser route vs ase.io.read of the CIF."""
    p = load(name)
    atoms = svc.build_atoms(p)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        ref = read(io.StringIO(p.rawCif), format="cif")
    np.testing.assert_allclose(atoms.cell.cellpar(), ref.cell.cellpar(), atol=1e-6)
    # Positions agree. Mixed sites (olivine Mg/Fe, albite Si/Al) are several atoms at one place
    # in the browser's list; ASE keeps the dominant species only.
    assert svc.distinct_positions(atoms) == len(ref)
    mixed = name in ("olivine_partial", "albite")
    assert (len(atoms) > len(ref)) == mixed
    r = svc.register(p)
    assert (r.summary.partial_sites > 0) == mixed
    assert not any("reads" in w for w in r.warnings)


@pytest.mark.parametrize("name", NAMES)
def test_density_matches_pymatgen(name):
    from pymatgen.core import Structure

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        ref = Structure.from_file(FIXTURES / "cifs" / f"{name}.cif").density
    assert svc.density_g_cm3(svc.build_atoms(load(name))) == pytest.approx(ref, rel=2e-3)


def test_unknown_element_is_a_clear_error():
    p = load("Si")
    p.atoms[0].element = "Xx"
    r = client.post("/api/structure", json=p.model_dump())
    assert r.status_code == 422 and r.json()["detail"]["code"] == "bad_structure"


def test_cross_check_reports_a_mismatch():
    p = load("Si")
    atoms = svc.build_atoms(p)
    atoms.cell[0] *= 1.01
    notes = svc.cross_check(atoms, p.rawCif)
    assert any("different cell" in n for n in notes)
    assert any("atoms" in n for n in svc.cross_check(atoms[:4], p.rawCif))


def test_unreadable_cif_still_registers():
    p = load("Si")
    p.rawCif = "this is not a cif"
    r = client.post("/api/structure", json=p.model_dump())
    assert r.status_code == 200
    assert any("browser's parse only" in w or "pymatgen" in w for w in r.json()["warnings"])


def orth(name, **kw):
    p = load(name)
    atoms = svc.build_atoms(p)
    return p, atoms, svc.orthogonalize(p, atoms, svc.payload_id(p), **kw)


@pytest.mark.parametrize("name", NAMES)
def test_orthogonal_cell_is_orthogonal_and_conserves_density(name):
    p, atoms, o = orth(name)
    cell = np.diag(o.cell)
    assert o.natoms == len(o.atoms)
    # Rebuild the cell from the response: orthogonal by construction; check against abTEM's test.
    from abtem.atoms import is_cell_orthogonal

    assert is_cell_orthogonal(cell, tol=1e-9)
    # Atoms per volume equals the bulk value up to the strain that was applied.
    n_ratio = o.natoms / len(atoms)
    v_ratio = o.volume_ratio
    assert n_ratio / v_ratio == pytest.approx(1.0, abs=1.5 * o.strain.max_abs + 1e-9)
    assert all(0 <= x < 1 for a in o.atoms for x in a.frac)


@pytest.mark.parametrize("name", ["Si", "NaCl", "rutile", "olivine_partial"])
def test_already_orthogonal_cells_are_untouched(name):
    p, atoms, o = orth(name)
    assert o.already_orthogonal and o.natoms == len(atoms) and o.strain.max_abs < 1e-9
    assert o.volume_ratio == pytest.approx(1.0)


def test_graphite_needs_two_cells_and_no_strain():
    _, _, o = orth("graphite")
    assert o.natoms == 8 and o.strain.max_abs < 1e-9
    assert o.cell == pytest.approx((2.46, 4.2606, 6.71), abs=0.01)  # a, sqrt(3) a, c
    assert o.max_repetitions == 2


def test_monoclinic_zro2_auto_reaches_the_tolerance():
    _, atoms, o = orth("ZrO2_baddeleyite", strain_tolerance=0.01)
    assert o.strain.max_abs <= 0.01 and o.natoms > len(atoms)
    # the default abTEM setting (5) is worse, which is why the choice is exposed
    _, _, o5 = orth("ZrO2_baddeleyite", max_repetitions=5)
    assert o5.strain.max_abs > 0.02 and o5.warnings
    _, _, o2 = orth("ZrO2_baddeleyite", max_repetitions=2)
    assert o2.strain.max_abs > 0.05 and any("strongly" in w for w in o2.warnings)


def test_triclinic_albite_warns_when_tolerance_cannot_be_met():
    _, _, o = orth("albite")
    assert o.strain.max_abs > 0.01 and any("No orthogonal cell within" in w for w in o.warnings)
    assert [c["max_repetitions"] for c in o.candidates][0] == 1


def test_atom_limit_is_enforced():
    p = load("albite")
    with pytest.raises(ValueError):
        svc.orthogonalize(p, svc.build_atoms(p), "x", max_repetitions=5, max_atoms=50)
    with pytest.raises(ValueError):  # automatic search: every candidate is too big
        svc.orthogonalize(p, svc.build_atoms(p), "x", max_atoms=50)


def test_occupancy_and_uiso_follow_the_source_atom():
    p, atoms, o = orth("ZrO2_baddeleyite")
    for a in o.atoms:
        src = p.atoms[a.source]
        assert a.element == src.element and a.occupancy == src.occupancy and a.uiso == src.uiso
    _, _, om = orth("olivine_partial")
    assert any(a.occupancy < 1 for a in om.atoms)


def test_orthogonalized_cell_has_the_right_periodic_content():
    """Every unit-cell atom appears volume_ratio times (once per cell copy)."""
    p, atoms, o = orth("graphite")
    counts = np.bincount([a.source for a in o.atoms], minlength=len(atoms))
    assert set(counts) == {int(round(o.volume_ratio))}


def _min_distance(atoms):
    from ase.geometry import get_distances

    _, d = get_distances(atoms.positions, cell=atoms.cell, pbc=True)
    d[np.diag_indices(len(atoms))] = np.inf
    return float(d.min())


@pytest.mark.parametrize("name", ["graphite", "ZrO2_baddeleyite", "rutile"])
def test_nearest_neighbour_distance_survives_orthogonalisation(name):
    from ase import Atoms

    p, atoms, o = orth(name)
    ortho = Atoms(symbols=[a.element for a in o.atoms], cell=np.diag(o.cell), pbc=True,
                  scaled_positions=[a.frac for a in o.atoms])
    assert _min_distance(ortho) == pytest.approx(_min_distance(atoms),
                                                 rel=2 * o.strain.max_abs + 1e-6)


def test_endpoints_round_trip():
    p = load("graphite")
    r = client.post("/api/structure", json=p.model_dump())
    assert r.status_code == 200
    j = r.json()
    assert j["summary"]["natoms"] == 4 and j["summary"]["orthogonal"] is False
    assert j["summary"]["formula"] == "C4"
    r2 = client.post("/api/structure/orthogonalize", json={"structureId": j["structureId"]})
    assert r2.status_code == 200
    o = r2.json()
    assert o["natoms"] == 8 and o["strain"]["max_abs"] < 1e-9
    # same payload -> same id (cache by hash)
    assert client.post("/api/structure", json=p.model_dump()).json()["structureId"] == j["structureId"]


def test_unknown_structure_is_404():
    r = client.post("/api/structure/orthogonalize", json={"structureId": "nope"})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "unknown_structure"
