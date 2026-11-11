"""M8 validation on stored runs: every 1T-TaS2 run simulated with the app (multislice SAED, CBED,
STEM and 4D-STEM, Bloch SAED, CBED and LACBED, INCOSTEM; old and new folder layouts) still opens in
the job list and the results viewer, can be processed again and exported, and the 4D-STEM run
agrees with the STEM run of the same settings.

The runs are not in the repository (projects/ is ignored). The test looks for them in
EMSIM_TAS2_RUNS, else in <repo>/projects/1T-TaS2_P-3m1, and is skipped when they are not there.
They are copied first: nothing is written into the original folders.
"""

import io
import json
import os
import shutil
from pathlib import Path

import h5py
import numpy as np
import pytest
from fastapi.testclient import TestClient

os.environ["EMSIM_TESTING"] = "1"

from emsim.main import app
from emsim.services import jobs

SOURCE = Path(os.environ.get("EMSIM_TAS2_RUNS") or
              Path(__file__).resolve().parents[2] / "projects" / "1T-TaS2_P-3m1")
pytestmark = pytest.mark.skipif(not SOURCE.is_dir(), reason=f"no stored TaS2 runs in {SOURCE}")

client = TestClient(app)


@pytest.fixture(scope="module")
def stored(tmp_path_factory):
    root = tmp_path_factory.mktemp("projects")
    shutil.copytree(SOURCE, root / SOURCE.name,
                    ignore=shutil.ignore_patterns("Exports", "temp"))
    # job.json records the folder it was written in: point every copy at itself, or the server
    # would read and write the original folders
    for f in root.glob("*/*/*/job.json"):
        doc = json.loads(f.read_text(encoding="utf8"))
        doc["directory"] = str(f.parent)
        f.write_text(json.dumps(doc, indent=2), encoding="utf8")
    old = os.environ.get("EMSIM_PROJECTS_DIR")
    os.environ["EMSIM_PROJECTS_DIR"] = str(root)
    try:
        done = [j for j in jobs.manager.list_jobs() if j["project"] == SOURCE.name]
        for j in done:  # never touch the originals
            assert Path(j["directory"]).resolve().is_relative_to(root.resolve()), j["directory"]
        yield root, done
    finally:
        if old is None:
            os.environ.pop("EMSIM_PROJECTS_DIR", None)
        else:
            os.environ["EMSIM_PROJECTS_DIR"] = old


def frame(job_id, what="frame", **q):
    r = client.get(f"/api/jobs/{job_id}/{what}", params=q)
    assert r.status_code == 200, (job_id, what, q, r.text)
    meta = json.loads(r.headers["x-frame"])
    a = np.frombuffer(r.content, dtype="<f4").reshape(meta["shape"])
    return meta, a


def test_every_stored_run_is_listed_with_its_results(stored):
    root, listed = stored
    folders = {p.parent for p in root.glob("*/*/*/job.json")}
    assert len(listed) == len(folders) >= 10
    kinds = set()
    for j in listed:
        if j["state"] != "done":
            continue
        assert j["results"], j["id"]
        for r in j["results"]:
            assert (Path(j["directory"]) / "results" / r["file"]).exists(), (j["id"], r["file"])
            kinds.add((j["method"], r["kind"]))
        doc = Path(j["directory"]) / "results" / "results.json"
        if doc.is_file():  # written since M6
            assert list(json.loads(doc.read_text()))[:2] == ["sim_type", "setup_params"]
    # the runs cover every kind of result the app makes
    assert {("multislice", "pattern"), ("multislice", "image"), ("bloch", "spots"),
            ("bloch", "pattern"), ("bloch", "discs"), ("incostem", "image")} <= kinds


def test_every_result_opens_in_the_viewer_at_every_depth_and_run(stored):
    _, listed = stored
    seen = 0
    for j in (j for j in listed if j["state"] == "done"):
        for r in j["results"]:
            n_run = len(r.get("runs") or [None])
            n_depth = len(r.get("depths") or [None])
            sources = ["native"] + (["processed"] if r.get("processed") else [])
            for source in sources:
                if r["kind"] == "spots":
                    for d in range(n_depth):
                        s = client.get(f"/api/jobs/{j['id']}/spots",
                                       params={"result": r["name"], "depth": d, "source": source})
                        assert s.status_code == 200, s.text
                        assert len(s.json()["hkl"]) == len(s.json()["intensity"]) > 1
                elif r["kind"] == "discs":
                    beams = client.get(f"/api/jobs/{j['id']}/beams", params={"result": r["name"]})
                    assert beams.status_code == 200 and [0, 0, 0] in beams.json()["hkl"]
                    for d in range(n_depth):
                        _, a = frame(j["id"], result=r["name"], depth=d, source=source)
                        assert np.isfinite(a).all() and a.max() > 0
                elif r["name"] == "4dstem":
                    meta, a = frame(j["id"], "pattern", result="4dstem", source=source)
                    assert meta["scan_shape"] == r["shape"][2:4] and np.isfinite(a).all()
                    _, v = frame(j["id"], "virtual", result="4dstem", shape="disk", outer=20)
                    assert v.shape == tuple(r["shape"][2:4])[::-1] and v.min() > 0
                else:
                    for run in range(n_run):
                        for d in range(n_depth):
                            part = {"part": "phase"} if r["kind"] == "wave" else {}
                            _, a = frame(j["id"], result=r["name"], run=run, depth=d,
                                         source=source, **part)
                            assert np.isfinite(a).all()
                seen += 1
    assert seen >= 15


def test_virtual_bf_of_the_4dstem_run_matches_the_stem_bf_run_with_the_same_settings(stored):
    _, listed = stored

    def body(j):
        return json.loads((Path(j["directory"]) / "project.json").read_text())["body"]

    four = [j for j in listed if j["sim_type"] == "4dstem" and j["state"] == "done"]
    stem = [j for j in listed if j["sim_type"] == "stem" and j["state"] == "done"]
    pairs = []
    for f in four:
        bf = {k: v for k, v in body(f).items() if k not in ("sim_type", "detectors")}
        for s in stem:
            bs = {k: v for k, v in body(s).items() if k not in ("sim_type", "detectors")}
            if bf == bs:
                pairs.append((f, s))
    if not pairs:
        pytest.skip("no 4D-STEM and STEM runs with the same settings")
    f, s = pairs[0]
    det = next(d for d in body(s)["detectors"] if d["inner"] == 0)
    reach = min(n * p for n, p in zip(f["results"][0]["shape"][-2:], f["results"][0]["pixel_mrad"])) / 2
    assert det["outer"] < reach  # the bright-field disc fits in the recorded pattern
    _, ref = frame(s["id"], result=f"stem_{det['name']}")
    _, v = frame(f["id"], "virtual", result="4dstem", shape="disk", outer=det["outer"])
    assert v.shape == ref.shape
    assert np.corrcoef(v.ravel(), ref.ravel())[0, 1] > 0.99
    assert np.abs(v / v.mean() - ref / ref.mean()).max() < 0.05


def test_every_kind_of_result_is_processed_again_and_exported(stored):
    _, listed = stored
    s = {"pixel_mode": "native", "target": 0.1, "smoothing": 0.0, "noise": True, "samples": 1,
         "seed": 1, "dose": {"electrons": 1e5, "dose_per_area": 100}}
    done_kinds = set()
    for j in (j for j in listed if j["state"] == "done"):
        r = client.post(f"/api/jobs/{j['id']}/detector", json=s)
        assert r.status_code == 200, (j["id"], r.text)
        for res in r.json()["results"]:
            if res["kind"] == "wave":
                continue
            assert res["processed"], (j["id"], res["name"])
            done_kinds.add(res["kind"] if res["name"] != "4dstem" else "4dstem")
            if res["kind"] in ("image", "pattern", "discs") and res["name"] != "4dstem":
                _, a = frame(j["id"], result=res["name"], source="processed")
                assert np.allclose(a, np.round(a)) and a.min() >= 0  # counts
            h = client.post(f"/api/jobs/{j['id']}/export",
                            params={"result": res["name"], "format": "h5", "source": "processed"})
            assert h.status_code == 200, h.text
            with h5py.File(h.json()["path"], "r") as f:
                assert ("data" in f) or ("discs" in f) or ("intensity" in f)
        client.delete(f"/api/jobs/{j['id']}/detector")
    assert {"image", "pattern", "spots", "discs", "4dstem"} <= done_kinds


def test_a_frame_exported_as_tiff_keeps_its_numbers_and_pixel(stored):
    import tifffile

    _, listed = stored
    j = next(j for j in listed if j["method"] == "incostem" and j["state"] == "done")
    _, a = frame(j["id"], result="incostem")
    t = client.post(f"/api/jobs/{j['id']}/export", params={"result": "incostem", "format": "tiff"})
    assert t.status_code == 200, t.text
    with tifffile.TiffFile(t.json()["path"]) as tf:
        np.testing.assert_array_equal(tf.asarray(), a)
        xr = tf.pages[0].tags["XResolution"].value
        assert xr[1] / xr[0] == pytest.approx(j["results"][0]["pixel"][0], rel=1e-4)
    assert Path(t.json()["path"]).parent.name == "Exports"
    assert str(SOURCE) not in t.json()["path"]  # the original folders are not written to
