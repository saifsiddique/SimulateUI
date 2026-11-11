"""The Bloch solve: a saved solve reused for other thicknesses, processes, per-element sigma."""

import json
from pathlib import Path

import numpy as np
import pytest
from ase.build import bulk
from fastapi.testclient import TestClient

from emsim.main import app
from emsim.models.structure import StructurePayload
from emsim.services import bloch_sim as bs
from emsim.services import structure as st

SI = bulk("Si", "diamond", a=5.431, cubic=True)
ENERGY = 300e3
PAYLOADS = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "fixtures" / "payloads"
client = TestClient(app)


def disc(alpha_mrad=3.0, pixel=0.05):
    _, tilts, _ = bs.disc_tilts(alpha_mrad, pixel, bs.energy2wavelength(ENERGY))
    return tilts


def setup_for(tilts, k_max=1.5, energy=ENERGY):
    return bs.prepare(SI, (1, 1, 0), energy, k_max=k_max, sg_max=0.05, tilts=tilts)


def test_a_saved_solve_serves_other_thicknesses_without_solving_again(tmp_path):
    tilts = disc()
    setup = setup_for(tilts)
    cache = bs.ModeCache(tmp_path)
    first, i1 = bs.solve(setup, [100.0, 200.0], tilts=tilts, cache=cache)
    assert i1["saved"] and not i1["reused"]
    assert cache.info["saved"] and cache.info["bytes"] == bs.mode_bytes(setup.num_beams, len(tilts))
    again, i2 = bs.solve(setup, [150.0, 300.0, 450.0], tilts=tilts, cache=cache)
    assert i2["reused"]
    fresh = bs.amplitudes(setup, [150.0, 300.0, 450.0], tilts=tilts)
    assert np.allclose(again, fresh, atol=1e-10, rtol=0)
    assert np.allclose(first, bs.amplitudes(setup, [100.0, 200.0], tilts=tilts), atol=1e-10, rtol=0)
    # reading back skips the eigen-solves: far faster than solving
    assert i2["seconds"] < 0.5 * i1["seconds"]


def test_the_saved_file_is_deleted_when_other_parameters_change_and_on_clear(tmp_path):
    tilts = disc()
    cache = bs.ModeCache(tmp_path)
    bs.solve(setup_for(tilts), [100.0], tilts=tilts, cache=cache)
    first = [d.name for d in tmp_path.iterdir()]
    assert len(first) == 1 and first[0].startswith("emsim-bloch-")
    assert any(f.name == "modes_B.dat" for f in (tmp_path / first[0]).iterdir())
    # another voltage: another solve, the old file goes
    _, info = bs.solve(setup_for(tilts, energy=200e3), [100.0], tilts=tilts, cache=cache)
    assert info["saved"] and not info["reused"]
    second = [d.name for d in tmp_path.iterdir()]
    assert len(second) == 1 and second != first
    # other k max, other tilts: also a new solve
    _, info = bs.solve(setup_for(tilts, k_max=1.2, energy=200e3), [100.0], tilts=tilts, cache=cache)
    assert not info["reused"]
    t2 = disc(2.0)
    _, info = bs.solve(setup_for(t2, k_max=1.2, energy=200e3), [100.0], tilts=t2, cache=cache)
    assert not info["reused"]
    cache.clear()
    assert list(tmp_path.iterdir()) == [] and not cache.info["saved"]


def test_a_solve_too_big_to_keep_is_still_solved_and_not_saved(tmp_path):
    tilts = disc()
    setup = setup_for(tilts)
    cache = bs.ModeCache(tmp_path, limit_bytes=1000)
    psi, info = bs.solve(setup, [100.0], tilts=tilts, cache=cache)
    assert not info["saved"] and list(tmp_path.iterdir()) == []
    assert np.allclose(psi, bs.amplitudes(setup, [100.0], tilts=tilts), atol=1e-12, rtol=0)


def test_processes_give_the_same_amplitudes_and_can_save_the_solve(tmp_path):
    tilts = disc()
    setup = setup_for(tilts)
    serial = bs.amplitudes(setup, [100.0, 250.0], tilts=tilts)
    cache = bs.ModeCache(tmp_path)
    progress = []
    par, info = bs.solve(setup, [100.0, 250.0], tilts=tilts, workers=3, cache=cache,
                         progress=lambda a, b: progress.append((a, b)), min_parallel_seconds=0)
    assert info["workers"] == 3 and info["saved"]
    assert np.allclose(par, serial, atol=1e-12, rtol=0)
    assert progress[-1] == (len(tilts), len(tilts))
    # the file the processes wrote serves another depth
    again, i2 = bs.solve(setup, [400.0], tilts=tilts, cache=cache)
    assert i2["reused"]
    assert np.allclose(again, bs.amplitudes(setup, [400.0], tilts=tilts), atol=1e-10, rtol=0)


def test_a_short_solve_stays_in_one_process():
    tilts = disc()
    setup = setup_for(tilts)
    _, info = bs.solve(setup, [100.0], tilts=tilts, workers=4)
    assert info["workers"] == 1


def test_cbed_and_saed_take_workers_and_a_cache(tmp_path):
    cache = bs.ModeCache(tmp_path)
    setup = bs.prepare(SI, (1, 1, 0), ENERGY, k_max=1.5, sg_max=0.05)
    a = bs.saed(setup, [100.0, 200.0], cache=cache)
    b = bs.saed(setup, [300.0], cache=cache)  # reused
    assert a.intensity.shape == (2, setup.num_beams) and b.intensity.shape == (1, setup.num_beams)
    r = bs.cbed(SI, (1, 1, 0), ENERGY, alpha_mrad=3.0, thicknesses=[200.0], pixel_size=0.05,
                k_max=1.5, sg_max=0.05, workers=2)
    ref = bs.cbed(SI, (1, 1, 0), ENERGY, alpha_mrad=3.0, thicknesses=[200.0], pixel_size=0.05,
                  k_max=1.5, sg_max=0.05)
    assert np.allclose(r.images, ref.images, atol=1e-12, rtol=0)


def register(name="Si"):
    p = StructurePayload(**json.loads((PAYLOADS / f"{name}.json").read_text()))
    return st.register(p).structureId


def test_the_preview_shares_the_directions_between_processes_and_sizes_the_saved_solve():
    sid = register()
    body = {"structureId": sid, "zoneAxis": [1, 1, 0], "energy_kv": 300, "k_max": 2.0,
            "sg_max": 0.02, "sim_type": "cbed", "alpha_mrad": 5, "pixel_size": 0.02}
    one = client.post("/api/bloch/preview", json=body).json()
    four = client.post("/api/bloch/preview", json={**body, "workers": 4}).json()
    assert four["workers"] == 4 and one["workers"] == 1
    assert four["seconds"] == pytest.approx(one["seconds"] / 4)
    n, m = one["n_beams"], one["n_tilts"]
    assert one["cache_bytes"] == m * (16 * n * n + 8 * n)
    assert one["cache_fits"] is True
    # never more processes than directions
    saed = client.post("/api/bloch/preview", json={**body, "sim_type": "saed", "workers": 8}).json()
    assert saed["workers"] == 1


def test_thermal_sigma_by_element_damps_the_high_orders():
    sid = register()
    base = {"structureId": sid, "zoneAxis": [1, 1, 0], "energy_kv": 300, "g_max": 4.0}
    cold = client.post("/api/bloch/factors", json=base).json()
    warm = client.post("/api/bloch/factors", json={**base, "thermal_sigma": {"Si": 0.1}}).json()
    uniform = client.post("/api/bloch/factors", json={**base, "thermal_sigma": 0.1}).json()
    f = lambda body: {tuple(r["hkl"]): r["f"] for r in body["refl"]}  # noqa: E731
    hkl = max((h for h, v in f(cold).items() if v > 1e-3 * cold["f_max"]), key=lambda h: sum(map(abs, h)))
    assert f(warm)[hkl] < 0.9 * f(cold)[hkl]
    assert f(warm)[hkl] == pytest.approx(f(uniform)[hkl], rel=1e-9)
    # an element missing from the dict counts as 0 rather than failing
    other = client.post("/api/bloch/factors", json={**base, "thermal_sigma": {"O": 0.1}})
    assert other.status_code == 200 and f(other.json())[hkl] == pytest.approx(f(cold)[hkl], rel=1e-9)


def test_multislice_warns_about_frozen_phonons_without_a_sigma():
    from emsim.services import abtem_sim

    atoms = bulk("Si", "diamond", a=5.43, cubic=True)
    base = {"energy_kv": 300, "sampling": 0.2, "semiangle_mrad": 10, "sim_type": "cbed", "phonons": 10}
    flat = abtem_sim.preview(atoms, base)
    assert any("thermal sigma of 0" in w for w in flat["warnings"])
    ok = abtem_sim.preview(atoms, {**base, "phonon_sigmas": {"Si": 0.08}})
    assert not any("thermal sigma" in w for w in ok["warnings"])
    assert ok["phonon_sigmas"] == {"Si": 0.08}
    off = abtem_sim.preview(atoms, {**base, "phonons": 1})
    assert not any("thermal sigma" in w for w in off["warnings"])


def test_the_app_cache_lives_in_one_folder_that_can_be_deleted_by_hand(monkeypatch, tmp_path):
    folder = tmp_path / "emsim-cache"
    monkeypatch.setattr(bs, "CACHE_DIR", folder)
    cache = bs.ModeCache()  # the default folder, here redirected
    monkeypatch.setattr(bs, "CACHE", cache)
    tilts = disc()
    bs.solve(setup_for(tilts), [100.0], tilts=tilts, cache=bs.CACHE)
    info = client.get("/api/bloch/cache").json()
    assert info["saved"] and info["bytes"] > 0 and info["directory"] == str(folder)
    assert any(folder.iterdir())
    # the button: delete it
    after = client.delete("/api/bloch/cache").json()
    assert after["saved"] is False and after["bytes"] == 0
    assert list(folder.iterdir()) == []
    # nothing saved: deleting again is harmless
    assert client.delete("/api/bloch/cache").json()["saved"] is False


def test_the_folder_is_emptied_at_start_and_exit(monkeypatch, tmp_path):
    folder = tmp_path / "emsim-cache"
    (folder / "emsim-bloch-left-from-a-crash").mkdir(parents=True)
    (folder / "emsim-bloch-left-from-a-crash" / "modes_B.dat").write_bytes(b"x" * 100)
    monkeypatch.setattr(bs, "CACHE_DIR", folder)
    bs.purge_cache_dir()
    assert not folder.exists()
    # the app does it when it starts and when it stops
    (folder / "old").mkdir(parents=True)
    monkeypatch.setattr(bs, "CACHE", bs.ModeCache(folder))
    with TestClient(app):
        assert not folder.exists()
        tilts = disc()
        bs.solve(setup_for(tilts), [100.0], tilts=tilts, cache=bs.CACHE)
        assert folder.exists() and bs.CACHE.info["saved"]
    assert not folder.exists() and not bs.CACHE.info["saved"]
