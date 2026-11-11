"""Bloch preview: the beams drawn for a zone axis, without running the eigen-solve."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from emsim.main import app
from emsim.models.structure import StructurePayload
from emsim.services import structure as st

PAYLOADS = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "fixtures" / "payloads"
client = TestClient(app)


def register(name: str) -> str:
    p = StructurePayload(**json.loads((PAYLOADS / f"{name}.json").read_text()))
    return st.register(p).structureId


def test_si_110_beams_lie_inside_k_max_and_002_is_kinematically_dark():
    sid = register("Si")
    r = client.post("/api/bloch/preview", json={
        "structureId": sid, "zoneAxis": [1, 1, 0], "energy_kv": 200, "k_max": 2.0, "sg_max": 0.02,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["n_beams"] == len(body["beams"]) > 10
    assert all(b["g"] <= 2.0 + 1e-6 for b in body["beams"])
    direct = next(b for b in body["beams"] if b["hkl"] == [0, 0, 0])
    assert direct["sg"] == pytest.approx(0.0, abs=1e-9)
    forbidden = [b for b in body["beams"] if b["hkl"] in ([0, 0, 2], [0, 0, -2])]
    assert forbidden and all(b["kinematic"] < 1e-6 for b in forbidden)
    assert body["seconds"] > 0


def test_a_tighter_cutoff_keeps_fewer_beams():
    sid = register("Si")
    wide = client.post("/api/bloch/preview", json={
        "structureId": sid, "zoneAxis": [1, 1, 0], "sg_max": 0.05, "k_max": 2,
    }).json()["n_beams"]
    tight = client.post("/api/bloch/preview", json={
        "structureId": sid, "zoneAxis": [1, 1, 0], "sg_max": 0.005, "k_max": 2,
    }).json()["n_beams"]
    assert tight < wide


def test_cbed_counts_the_tilts_in_the_disc():
    sid = register("Si")
    body = client.post("/api/bloch/preview", json={
        "structureId": sid, "zoneAxis": [0, 0, 1], "sim_type": "cbed", "alpha_mrad": 4,
    }).json()
    assert body["n_tilts"] > 50
    assert body["seconds"] == pytest.approx(2e-9 * body["n_beams"] ** 3 * body["n_tilts"], rel=1e-6)


def test_unknown_structure_is_404():
    r = client.post("/api/bloch/preview", json={"structureId": "nope", "zoneAxis": [0, 0, 1]})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "unknown_structure"


def test_factors_of_si_110_list_111_and_220_and_a_dark_002():
    sid = register("Si")
    r = client.post("/api/bloch/factors", json={
        "structureId": sid, "zoneAxis": [1, 1, 0], "energy_kv": 300, "g_max": 4.0,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    g111 = min(x["g"] for x in body["refl"] if x["f"] > 1e-3 * body["f_max"] and x["g"] > 0.1)
    assert g111 == pytest.approx(3**0.5 / 5.4307, rel=0.01)  # |g_111| = sqrt(3) / a
    dark = [x for x in body["refl"] if x["hkl"] in ([0, 0, 2], [0, 0, -2])]
    assert dark and all(x["f"] < 1e-6 * body["f_max"] for x in dark)
    assert body["refl"][0]["hkl"] == [0, 0, 0] and body["refl"][0]["zolz"]
    assert [x["g"] for x in body["refl"]] == sorted(x["g"] for x in body["refl"])
    assert all(x["g"] <= 4.0 + 1e-9 for x in body["refl"])
    # a higher zone is listed only when it is near the Ewald sphere
    assert all(x["zolz"] or abs(x["sg"]) < 0.1 for x in body["refl"])
    assert body["f_max"] > 0 and not body["truncated"]


def test_a_convergent_disc_brings_more_beams_in_and_counts_its_tilts_exactly():
    sid = register("Si")
    base = {"structureId": sid, "zoneAxis": [1, 1, 0], "energy_kv": 300, "k_max": 3.0,
            "sg_max": 0.01, "pixel_size": 0.02}
    saed = client.post("/api/bloch/preview", json={**base, "sim_type": "saed"}).json()
    cbed = client.post("/api/bloch/preview", json={**base, "sim_type": "cbed", "alpha_mrad": 10}).json()
    assert cbed["n_beams"] > saed["n_beams"]
    from emsim.services import bloch_sim as bs
    lam = bs.energy2wavelength(300e3)
    px, _, r = bs.disc_tilts(10, 0.02, lam)
    assert cbed["n_tilts"] == len(px) == bs.disc_count(r) and cbed["disc_radius_px"] == r


def test_lacbed_at_60_mrad_counts_the_tilts_and_warns_about_the_time():
    sid = register("Si")
    body = client.post("/api/bloch/preview", json={
        "structureId": sid, "zoneAxis": [1, 1, 0], "energy_kv": 300, "k_max": 2.0,
        "sg_max": 0.02, "sim_type": "lacbed", "alpha_mrad": 60, "pixel_size": 0.02,
    }).json()
    lam = 0.019687
    r = round(60e-3 / lam / 0.02)
    assert body["n_tilts"] == pytest.approx(3.14159 * r * r, rel=0.03)
    assert body["seconds"] > 600 and any("coarser pattern pixel" in w for w in body["warnings"])
    coarse = client.post("/api/bloch/preview", json={
        "structureId": sid, "zoneAxis": [1, 1, 0], "energy_kv": 300, "k_max": 2.0,
        "sg_max": 0.02, "sim_type": "lacbed", "alpha_mrad": 60, "pixel_size": 0.2,
    }).json()
    assert coarse["n_tilts"] < body["n_tilts"] and not coarse["warnings"]
