"""The job runner (context.md M6): jobs run in a worker process, report progress, can be cancelled,
survive a crashed worker, and store their inputs and results."""

import json
import os
import re
import time
from pathlib import Path

import numpy as np
import pytest
from ase.build import bulk
from fastapi.testclient import TestClient

os.environ["EMSIM_TESTING"] = "1"  # allows the test hooks of runs.run in the worker processes

from emsim.main import app
from emsim.models.structure import StructurePayload
from emsim.services import bloch_sim, hardware, jobs, runs
from emsim.services import specimen as sp
from emsim.services import structure as st

PAYLOADS = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "fixtures" / "payloads"
client = TestClient(app)


@pytest.fixture(autouse=True)
def projects(tmp_path, monkeypatch):
    monkeypatch.setenv("EMSIM_PROJECTS_DIR", str(tmp_path))
    return tmp_path


def specimen_id(name="s1") -> str:
    atoms = bulk("Si", cubic=True) * (2, 2, 3)
    sp.store.put(name, atoms)
    return name


def run_job(method, body, timeout=240):
    r = client.post("/api/jobs", json={"method": method, "body": body, "project": "t"})
    assert r.status_code == 200, r.text
    job = jobs.manager.wait(r.json()["id"], timeout)
    return job


MS = {"energy_kv": 200, "sampling": 0.08, "slice_thickness": 2.0, "semiangle_mrad": 20}


def test_a_stem_job_stores_its_inputs_results_and_log():
    body = {**MS, "specimenId": specimen_id(), "sim_type": "stem", "scan_fov": [0, 0, 5.43, 5.43],
            "scan_step": 1.0, "thicknesses": [8.0],
            "detectors": [{"name": "BF", "inner": 0, "outer": 10},
                          {"name": "HAADF", "inner": 60, "outer": 120}]}
    job = run_job("multislice", body)
    assert job["state"] == "done", job
    folder = Path(job["directory"])
    assert folder.parent.name == "multislice_stem" and folder.parent.parent.name == "t"
    assert re.fullmatch(r"\d{8}_\d{3}", folder.name)
    assert json.loads((folder / "project.json").read_text())["body"]["scan_step"] == 1.0
    assert "abtem" in json.loads((folder / "versions.json").read_text())["packages"]
    assert (folder / "log.txt").read_text().strip()
    names = {r["name"] for r in job["results"]}
    assert names == {"stem_BF", "stem_HAADF"}
    img = np.load(folder / "results" / "stem_HAADF.npy")
    assert img.shape == (1, 2, 6, 6)  # (run, depth, x, y); depths 8 Å and the exit surface
    assert job["results"][0]["depths"][-1] == pytest.approx(16.29, abs=0.01)
    # the preview PNG is served
    f = client.get(f"/api/jobs/{job['id']}/files/stem_HAADF.png")
    assert f.status_code == 200 and f.content.startswith(b"\x89PNG")
    assert client.get(f"/api/jobs/{job['id']}/files/../job.json").status_code in (404, 422)


def test_4dstem_is_written_as_zarr_with_binning():
    import zarr

    body = {**MS, "specimenId": specimen_id(), "sim_type": "4dstem", "scan_fov": [0, 0, 5.43, 5.43],
            "scan_step": 1.5, "pattern_size": 32, "binning": 2}
    job = run_job("multislice", body)
    assert job["state"] == "done", job
    r = job["results"][0]
    z = zarr.open(str(Path(job["directory"]) / "results" / r["file"]), mode="r")
    assert z.shape == (1, 1, 4, 4, 16, 16)  # 32 px binned by 2
    assert r["pixel_mrad"][0] == pytest.approx(2 * 0.025079 / 10.86 * 1e3, rel=1e-2)
    assert float(np.asarray(z[:]).sum()) > 0


def test_cbed_series_and_hrtem_and_saed():
    sid = specimen_id()
    cbed = run_job("multislice", {**MS, "specimenId": sid, "sim_type": "cbed", "pattern_size": 48,
                                  "binning": 2, "defocus_series": [0, 50], "thicknesses": [10]})
    assert cbed["state"] == "done", cbed
    assert cbed["results"][0]["shape"] == [2, 2, 24, 24]
    assert len(cbed["results"][0]["runs"]) == 2
    saed = run_job("multislice", {**MS, "specimenId": sid, "sim_type": "saed", "pattern_size": 48,
                                  "tilt_series": [[0, 0], [2, 0]]})
    assert saed["state"] == "done" and saed["results"][0]["shape"][:2] == [2, 1]
    hr = run_job("multislice", {**MS, "specimenId": sid, "sim_type": "hrtem", "defocus": -50,
                                "objective_aperture_mrad": 15})
    assert hr["state"] == "done" and {r["name"] for r in hr["results"]} == {"hrtem", "exit_wave"}


def test_a_box_that_is_not_square_has_a_pixel_for_each_axis_and_a_square_picture():
    from PIL import Image

    atoms = bulk("Si", cubic=True) * (2, 3, 3)  # 10.86 x 16.29 A
    sp.store.put("wide", atoms)
    job = run_job("multislice", {**MS, "specimenId": "wide", "sim_type": "saed", "pattern_size": 48})
    assert job["state"] == "done", job
    r = job["results"][0]
    px, py = r["pixel_mrad"]
    assert px / py == pytest.approx(16.29 / 10.86, rel=1e-3)  # the longer side has the finer pixel
    nx, ny = r["shape"][-2:]
    assert (nx, ny) == (48, 72) and nx * px == pytest.approx(ny * py, rel=2e-2)  # same angular range
    img = Image.open(Path(job["directory"]) / "results" / "saed.png")
    assert img.size[0] == img.size[1] >= 2048  # square pixels, many of them
    assert round(img.info["dpi"][0]) == 300


def test_results_json_has_four_sections():
    body = {**MS, "specimenId": specimen_id(), "sim_type": "saed", "pattern_size": 32}
    job = run_job("multislice", body)
    doc = json.loads((Path(job["directory"]) / "results" / "results.json").read_text())
    assert list(doc) == ["sim_type", "setup_params", "metadata", "output"]
    assert doc["sim_type"] == {"method": "multislice", "type": "saed"}
    assert doc["setup_params"]["pattern_size"] == 32
    assert doc["metadata"]["specimen"]["formula"] and "abtem" in doc["metadata"]["software"]["packages"]
    assert doc["output"][0]["name"] == "saed"


def test_open_folder_asks_the_system_and_unknown_jobs_are_404(monkeypatch):
    opened = []
    monkeypatch.setattr(jobs, "open_folder", lambda p: opened.append(p))
    job = run_job("multislice", {**MS, "specimenId": specimen_id(), "sim_type": "saed",
                                 "pattern_size": 32})
    r = client.post(f"/api/jobs/{job['id']}/open")
    assert r.status_code == 200 and opened == [Path(job["directory"])]
    assert client.post("/api/jobs/nope/open").status_code == 404


def test_the_detector_settings_are_applied_to_a_finished_run_without_simulating_again():
    body = {**MS, "specimenId": specimen_id(), "sim_type": "saed", "pattern_size": 32}
    job = run_job("multislice", body)
    ideal = np.load(Path(job["directory"]) / "results" / "saed.npy")
    s = {"pixel_mode": "target", "target": 1.0, "smoothing": 0.5,
         "dose": {"current_pa": 5, "time_us": 100}, "noise": True, "samples": 1, "seed": 2}
    r = client.post(f"/api/jobs/{job['id']}/detector", json=s)
    assert r.status_code == 200, r.text
    out = r.json()["results"][0]
    assert out["processed"]["unit"] == "mrad" and out["processed"]["electrons"] == pytest.approx(3120.75, rel=1e-3)
    assert client.get(f"/api/jobs/{job['id']}/files/{out['processed']['preview']}").status_code == 200
    assert client.get(f"/api/jobs/{job['id']}").json()["results"][0]["processed"]  # kept in the record
    np.testing.assert_array_equal(ideal, np.load(Path(job["directory"]) / "results" / "saed.npy"))
    assert client.post(f"/api/jobs/{job['id']}/detector", json={"noise": True}).status_code == 422
    # the picture is fetched again whenever it is written again
    assert client.get(f"/api/jobs/{job['id']}/files/{out['processed']['preview']}").headers[
        "cache-control"] == "no-cache"
    # Reset removes the processed files, and the record forgets them
    r = client.delete(f"/api/jobs/{job['id']}/detector")
    assert r.status_code == 200 and "processed" not in r.json()["results"][0]
    assert not list((Path(job["directory"]) / "results").glob("*_processed.*"))
    assert client.get(f"/api/jobs/{job['id']}/files/saed.png").status_code == 200
    assert client.post("/api/jobs/nope/detector", json={}).status_code == 404


def test_job_numbers_continue_after_a_restart():
    a = run_job("multislice", {**MS, "specimenId": specimen_id(), "sim_type": "saed",
                               "pattern_size": 32})
    jobs.manager._counter, jobs.manager._day = 0, ""  # a new program: it reads the numbers on disk
    b = run_job("multislice", {**MS, "specimenId": specimen_id(), "sim_type": "saed",
                               "pattern_size": 32})
    assert int(b["id"][-3:]) == int(a["id"][-3:]) + 1


def test_the_job_number_starts_again_on_a_new_date(projects):
    # yesterday's folders had reached number 62; today has none yet
    old = projects / "Si" / "multislice_saed" / "20200101_062"
    old.mkdir(parents=True)
    jobs.manager._counter, jobs.manager._day = 0, ""
    a = run_job("multislice", {**MS, "specimenId": specimen_id(), "sim_type": "saed",
                               "pattern_size": 32})
    assert a["id"].endswith("_001") and a["id"] != "20200101_063"
    assert Path(a["directory"]).name == a["id"]


def test_incostem_job_saves_the_image():
    body = {"specimenId": specimen_id(), "energy_kv": 200, "semiangle_mrad": 20, "pixel_size": 0.2,
            "adf_min_mrad": 50, "adf_max_mrad": 150, "parametrization": "kirkland"}
    job = run_job("incostem", body)
    assert job["state"] == "done", job
    img = np.load(Path(job["directory"]) / "results" / "incostem.npy")
    assert img.ndim == 2 and img.max() > 0


def test_bloch_cbed_job_and_its_saved_solve_is_reused_by_the_next():
    p = StructurePayload(**json.loads((PAYLOADS / "Si.json").read_text()))
    sid = st.register(p).structureId
    body = {"structureId": sid, "zoneAxis": [1, 1, 0], "energy_kv": 200, "k_max": 1.5,
            "sg_max": 0.05, "sim_type": "cbed", "alpha_mrad": 3, "pixel_size": 0.05,
            "thicknesses": [100.0], "workers": 1}
    bloch_sim.CACHE.clear()
    a = run_job("bloch", body)
    assert a["state"] == "done", a
    assert a["results"][0]["kind"] == "pattern"
    assert bloch_sim.CACHE.info["saved"]  # the worker's solve now belongs to the app
    first = bloch_sim.CACHE.export()["directory"]
    b = run_job("bloch", {**body, "thicknesses": [100.0, 200.0]})
    assert b["state"] == "done", b
    # the modes were read back, not solved again: a new solve would be saved in a new folder
    # (not timed: starting the worker and importing abTEM take longer than this small solve)
    assert bloch_sim.CACHE.export()["directory"] == first
    bloch_sim.CACHE.clear()
    saed = run_job("bloch", {**body, "sim_type": "saed"})
    assert saed["state"] == "done" and (Path(saed["directory"]) / "results" / "saed.npz").is_file()
    bloch_sim.CACHE.clear()
    lac = run_job("bloch", {**body, "sim_type": "lacbed", "alpha_mrad": 2, "pixel_size": 0.1})
    assert lac["state"] == "done", lac
    assert "0_0_0" in lac["results"][0]["note"] and "lacbed.npz" in lac["results"][0]["note"]
    bloch_sim.CACHE.clear()


def test_cancel_stops_the_worker_within_seconds():
    body = {**MS, "specimenId": specimen_id(), "sim_type": "stem", "_test": "sleep"}
    r = client.post("/api/jobs", json={"method": "multislice", "body": body, "project": "t"})
    jid = r.json()["id"]
    t0 = time.time()
    while client.get(f"/api/jobs/{jid}").json()["state"] != "running" and time.time() - t0 < 30:
        time.sleep(0.1)
    time.sleep(1.5)  # let the worker start up
    t1 = time.time()
    client.delete(f"/api/jobs/{jid}")
    job = jobs.manager.wait(jid, 20)
    assert job["state"] == "cancelled"
    assert time.time() - t1 < 8


def test_a_crashed_worker_reports_an_error_and_the_next_job_still_runs():
    sid = specimen_id()
    crash = run_job("multislice", {**MS, "specimenId": sid, "sim_type": "stem", "_test": "crash"})
    assert crash["state"] == "failed" and "stopped unexpectedly" in crash["error"]
    ok = run_job("multislice", {**MS, "specimenId": sid, "sim_type": "saed", "pattern_size": 32})
    assert ok["state"] == "done"


def test_one_job_runs_at_a_time_and_the_rest_wait_in_order():
    sid = specimen_id()
    slow = client.post("/api/jobs", json={"method": "multislice", "project": "t",
                                          "body": {**MS, "specimenId": sid, "sim_type": "stem",
                                                   "_test": "sleep"}}).json()
    nxt = client.post("/api/jobs", json={"method": "multislice", "project": "t",
                                         "body": {**MS, "specimenId": sid, "sim_type": "saed",
                                                  "pattern_size": 32}}).json()
    assert nxt["state"] == "queued" and nxt["queue_position"] == 1
    jobs_by_id = {j["id"]: j for j in client.get("/api/jobs").json()}
    assert jobs_by_id[slow["id"]]["state"] in ("running", "queued")
    client.delete(f"/api/jobs/{slow['id']}")
    assert jobs.manager.wait(nxt["id"], 120)["state"] == "done"


def test_unknown_specimen_and_job_are_404_and_a_websocket_follows_a_job():
    r = client.post("/api/jobs", json={"method": "multislice", "body": {"specimenId": "nope"}})
    assert r.status_code == 404
    assert client.get("/api/jobs/nope").status_code == 404
    sid = specimen_id()
    job = client.post("/api/jobs", json={"method": "multislice", "project": "t",
                                         "body": {**MS, "specimenId": sid, "sim_type": "saed",
                                                  "pattern_size": 32}}).json()
    seen = []
    with client.websocket_connect(f"/api/jobs/{job['id']}") as ws:
        while True:
            m = ws.receive_json()
            seen.append(m["state"])
            if m["state"] not in ("queued", "running"):
                break
    assert seen[-1] == "done"
    # earlier jobs are listed from their folders, and can be removed
    assert any(j["id"] == job["id"] for j in client.get("/api/jobs").json())
    assert client.delete(f"/api/jobs/{job['id']}?remove=true").json()["removed"]
    assert not Path(job["directory"]).exists()


def test_depths_and_binning_helpers():
    planes, depths = runs._depths(16.0, 2.0, [4.0, 9.0, 99.0, 0.0])
    assert planes == [1, 3, 7] and depths == [4.0, 8.0, 16.0]
    a = np.arange(64, dtype=float).reshape(8, 8)
    b = runs._crop_bin(a, 4, 2)
    assert b.shape == (2, 2) and b.sum() == a[2:6, 2:6].sum()


@pytest.mark.skipif(not hardware.gpu_info()["available"], reason="no CUDA device")
def test_gpu_and_cpu_stem_agree():
    sid = specimen_id()
    body = {**MS, "specimenId": sid, "sim_type": "stem", "scan_fov": [0, 0, 5.43, 5.43],
            "scan_step": 1.5, "detectors": [{"name": "HAADF", "inner": 60, "outer": 120}]}
    cpu = run_job("multislice", body)
    gpu = run_job("multislice", {**body, "device": "gpu"})
    assert cpu["state"] == gpu["state"] == "done", (cpu, gpu)
    a = np.load(Path(cpu["directory"]) / "results" / "stem_HAADF.npy")
    b = np.load(Path(gpu["directory"]) / "results" / "stem_HAADF.npy")
    np.testing.assert_allclose(a, b, rtol=2e-3, atol=1e-6 * a.max())


def test_a_moved_run_folder_is_read_and_written_where_it_is_now(projects):
    import shutil

    job = run_job("multislice", {**MS, "specimenId": specimen_id(), "sim_type": "saed",
                                 "pattern_size": 32})
    old = Path(job["directory"])
    new = projects / "moved" / old.parent.name / old.name
    new.parent.mkdir(parents=True)
    shutil.move(str(old), str(new))
    jobs.manager._jobs.pop(job["id"], None)  # as after a restart: only the disk knows it
    jobs.manager._order.remove(job["id"])
    found = next(j for j in jobs.manager.list_jobs() if j["id"] == job["id"])
    assert Path(found["directory"]) == new
    r = client.post(f"/api/jobs/{job['id']}/export", params={"result": "saed", "format": "npy"})
    assert r.status_code == 200 and Path(r.json()["path"]).parent == new / "Exports"
    assert not old.exists()
