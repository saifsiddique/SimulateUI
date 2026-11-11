"""The results viewer's backend (context.md M7): frames of a series, 4D-STEM patterns and virtual
images, Bloch spots and the exports."""

import io
import json
import os
from pathlib import Path

import h5py
import numpy as np
import pytest
from ase.build import bulk
from fastapi.testclient import TestClient

os.environ["EMSIM_TESTING"] = "1"

from emsim.main import app
from emsim.services import jobs
from emsim.services import specimen as sp
from emsim.services import viewer

client = TestClient(app)
MS = {"energy_kv": 200, "sampling": 0.1, "slice_thickness": 2.0, "semiangle_mrad": 20}


@pytest.fixture(autouse=True)
def projects(tmp_path, monkeypatch):
    monkeypatch.setenv("EMSIM_PROJECTS_DIR", str(tmp_path))


def specimen(name="v", cells=(2, 2, 3)):
    sp.store.put(name, bulk("Si", cubic=True) * cells)
    return name


def run_job(body, method="multislice"):
    r = client.post("/api/jobs", json={"method": method, "body": body, "project": "v"})
    assert r.status_code == 200, r.text
    job = jobs.manager.wait(r.json()["id"], 240)
    assert job["state"] == "done", job
    return job


def get(job, what, **q):
    r = client.get(f"/api/jobs/{job['id']}/{what}", params=q)
    assert r.status_code == 200, r.text
    return r


def fr(job, what, **q):
    """A frame, pattern or virtual image: its description plus the numbers under "array"."""
    r = get(job, what, **q)
    assert r.headers["content-type"] == "application/octet-stream"
    meta = json.loads(r.headers["x-frame"])
    meta["array"] = np.frombuffer(r.content, dtype="<f4").reshape(meta["shape"])
    return meta


def numbers(f):
    return f["array"]


def test_frames_follow_the_thickness_and_defocus_series():
    body = {**MS, "specimenId": specimen(), "sim_type": "hrtem", "defocus_series": [0, -80],
            "thicknesses": [8.0], "objective_aperture_mrad": 15}
    job = run_job(body)
    saved = np.load(os.path.join(job["directory"], "results", "hrtem.npy"))
    assert saved.shape[:2] == (2, 2)  # (run, depth)
    for run in (0, 1):
        for depth in (0, 1):
            f = fr(job, "frame", result="hrtem", run=run, depth=depth)
            from emsim.services.abtem_sim import display_orientation

            np.testing.assert_allclose(numbers(f), display_orientation(saved[run, depth]), rtol=1e-6)
            assert f["unit"] == "Å" and f["pixel"][0] == pytest.approx(0.1, rel=0.05)
    # the two defoci differ, and an index out of range is clamped rather than failing
    a = numbers(fr(job, "frame", result="hrtem", run=0, depth=1))
    b = numbers(fr(job, "frame", result="hrtem", run=1, depth=1))
    assert not np.allclose(a, b)
    assert fr(job, "frame", result="hrtem", run=9, depth=9)["shape"] == list(a.shape)
    # the exit wave has a phase and an amplitude
    ph = fr(job, "frame", result="exit_wave", part="phase")
    am = fr(job, "frame", result="exit_wave", part="amplitude")
    assert -np.pi - 1e-3 <= ph["min"] and ph["max"] <= np.pi + 1e-3 and am["min"] >= 0
    # the labels of the series come with the job record for the slider
    assert job["results"][0]["runs"] == ["defocus 0 Å", "defocus -80 Å"]
    assert client.get(f"/api/jobs/{job['id']}/frame", params={"result": "nope"}).status_code == 404
    assert client.get("/api/jobs/zzz/frame", params={"result": "x"}).status_code == 404


def test_virtual_images_of_4dstem_match_the_stem_detectors_and_a_pattern_is_picked_by_pixel():
    sid = specimen("big", (4, 4, 3))
    common = {**MS, "specimenId": sid, "scan_fov": [0, 0, 5.43, 5.43], "scan_step": 1.81,
              "pattern_size": 64}
    four = run_job({**common, "sim_type": "4dstem"})
    r4 = four["results"][0]
    assert r4["semiangle_mrad"] == 20 and r4["shape"][:4] == [1, 1, 3, 3]
    stem = run_job({**common, "sim_type": "stem", "detectors": [
        {"name": "BF", "inner": 0, "outer": 12}, {"name": "ADF", "inner": 20, "outer": 28}]})
    for name, shape, inner, outer in (("stem_BF", "disk", 0, 12), ("stem_ADF", "annulus", 20, 28)):
        ref = numbers(fr(stem, "frame", result=name))
        vi = fr(four, "virtual", shape=shape, inner=inner, outer=outer)
        v = numbers(vi)
        assert v.shape == ref.shape and vi["pixel"] == pytest.approx([1.81, 1.81])
        # a pixel mask against an analytic detector: the same picture to a few percent
        assert np.corrcoef(v.ravel(), ref.ravel())[0, 1] > 0.99
        assert np.abs(v / v.mean() - ref / ref.mean()).max() < 0.05
    # the pattern at a pixel of the picture is that scan position's pattern; no pixel gives the mean
    z = viewer.open_array(
        __import__("pathlib").Path(four["directory"]) / "results", r4, "native")[0]
    p = fr(four, "pattern", row=0, col=0)  # row 0 = largest y, col 0 = largest x
    nx, ny = z.shape[2:4]
    np.testing.assert_allclose(numbers(p), viewer.display_orientation(np.asarray(z[0, 0, nx - 1, ny - 1])),
                               rtol=1e-6)
    assert p["position"] == [0, 0]
    mean = fr(four, "pattern")
    assert mean["position"] is None and mean["scan_shape"] == [3, 3]
    # bad requests are 422
    assert client.get(f"/api/jobs/{four['id']}/virtual", params={"shape": "star"}).status_code == 422
    assert client.get(f"/api/jobs/{stem['id']}/pattern", params={"result": "stem_BF"}).status_code == 422


def test_processed_results_are_shown_with_their_own_pixel_and_the_noisy_samples():
    job = run_job({**MS, "specimenId": specimen(), "sim_type": "saed", "pattern_size": 32})
    s = {"pixel_mode": "target", "target": 2.5, "smoothing": 0, "noise": True, "samples": 2,
         "dose": {"electrons": 1e5}, "seed": 1}
    assert client.post(f"/api/jobs/{job['id']}/detector", json=s).status_code == 200
    nat = fr(job, "frame", result="saed")
    proc = fr(job, "frame", result="saed", source="processed", sample=1)
    assert proc["pixel"][0] == pytest.approx(2.5, rel=0.1) and proc["pixel"] != nat["pixel"]
    n = numbers(proc)
    assert np.allclose(n, np.round(n)) and n.sum() == pytest.approx(1e5, rel=0.05)  # counts
    other = numbers(fr(job, "frame", result="saed", source="processed", sample=0))
    assert not np.array_equal(n, other)
    client.delete(f"/api/jobs/{job['id']}/detector")
    assert client.get(f"/api/jobs/{job['id']}/frame",
                      params={"result": "saed", "source": "processed"}).status_code == 422


def export(job, **q):
    """Ask for an export; it is saved in the run's Exports folder."""
    r = client.post(f"/api/jobs/{job['id']}/export", params=q)
    assert r.status_code == 200, r.text
    out = r.json()
    path = Path(out["path"])
    assert path.is_file() and path.parent == Path(job["directory"]) / "Exports"
    return path


def test_exports_are_saved_in_the_exports_folder_with_the_numbers_and_the_calibration():
    import tifffile

    job = run_job({**MS, "specimenId": specimen(), "sim_type": "cbed", "pattern_size": 32,
                   "defocus_series": [0, 40]})
    want = numbers(fr(job, "frame", result="cbed", run=1, depth=0))
    t = export(job, result="cbed", format="tiff", run=1, depth=0)
    assert t.name == "cbed_native_run2_depth1.tif"
    with tifffile.TiffFile(t) as tf:
        np.testing.assert_array_equal(tf.asarray(), want)
        assert tf.pages[0].asarray().dtype == np.float32
        x_res = tf.pages[0].tags["XResolution"].value
        assert x_res[0] / x_res[1] == pytest.approx(1 / job["results"][0]["pixel_mrad"][0], rel=1e-3)
    np.testing.assert_array_equal(np.load(export(job, result="cbed", format="npy", run=1, depth=0)), want)
    with h5py.File(export(job, result="cbed", format="h5"), "r") as f:
        assert f["data"].shape == tuple(job["results"][0]["shape"])
        assert list(f["data"].attrs["pixel"]) == pytest.approx(job["results"][0]["pixel_mrad"])
        assert f["data"].attrs["unit"] == "mrad" and f.attrs["name"] == "cbed"
        assert f["data"].attrs["axes"].startswith('["run", "depth"')
    r = client.post(f"/api/jobs/{job['id']}/export", params={"result": "cbed", "format": "gif"})
    assert r.status_code == 422
    # the picture the browser drew is saved there too, and only a PNG is accepted
    png = bytes([0x89]) + b"PNG" + b"0" * 20
    r = client.post(f"/api/jobs/{job['id']}/export-png", params={"name": "../evil name"}, content=png)
    assert r.status_code == 200 and Path(r.json()["path"]).read_bytes() == png
    assert Path(r.json()["path"]).parent == Path(job["directory"]) / "Exports"
    assert client.post(f"/api/jobs/{job['id']}/export-png", content=b"nope").status_code == 422


def test_4dstem_exports_as_hdf5_with_both_calibrations():
    job = run_job({**MS, "specimenId": specimen(), "sim_type": "4dstem", "scan_fov": [0, 0, 5.43, 5.43],
                   "scan_step": 1.81, "pattern_size": 32})
    with h5py.File(export(job, result="4dstem", format="h5"), "r") as f:
        d = f["data"]
        assert d.shape == tuple(job["results"][0]["shape"]) and len(d.shape) == 6
        assert list(d.attrs["scan_pixel_A"]) == pytest.approx([1.81, 1.81])
        assert d.attrs["unit"] == "mrad"
        assert d.attrs["axes"] == '["run", "depth", "x", "y", "kx", "ky"]'


def test_bloch_spots_and_discs_at_a_thickness():
    from emsim.services import structure as st
    from emsim.models.structure import StructurePayload
    import json
    from pathlib import Path

    f = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "fixtures" / "payloads" / "Si.json"
    sid = st.register(StructurePayload(**json.loads(f.read_text()))).structureId
    job = run_job({"structureId": sid, "zoneAxis": [1, 1, 0], "sim_type": "saed", "energy_kv": 200,
                   "thicknesses": [100, 200], "k_max": 1.5, "sg_max": 0.05}, method="bloch")
    a = get(job, "spots", result="saed", depth=0).json()
    b = get(job, "spots", result="saed", depth=1).json()
    assert len(a["hkl"]) == len(a["qxy"]) == len(a["intensity"]) and a["depth"] == 100
    assert a["intensity"] != b["intensity"] and a["unit"] == "Å⁻¹"


def test_bloch_lacbed_discs_are_chosen_by_indices_processed_and_exported_whole():
    from emsim.models.structure import StructurePayload
    from emsim.services import bloch_sim, discs
    from emsim.services import structure as st

    f = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "fixtures" / "payloads" / "Si.json"
    sid = st.register(StructurePayload(**json.loads(f.read_text()))).structureId
    bloch_sim.CACHE.clear()
    job = run_job({"structureId": sid, "zoneAxis": [1, 1, 0], "sim_type": "lacbed", "energy_kv": 200,
                   "alpha_mrad": 3, "pixel_size": 0.05, "thicknesses": [100, 200], "k_max": 1.5,
                   "sg_max": 0.05, "workers": 1}, method="bloch")
    r = job["results"][0]
    folder = Path(job["directory"])
    # one array per beam under its indices: a 2D disc for every thickness
    with np.load(folder / "results" / "lacbed.npz") as nz:
        z = {k: nz[k] for k in nz}
    assert "0_0_0" in z and z["0_0_0"].shape[0] == 2 and z["0_0_0"].ndim == 3
    assert "discs" not in z and r["pixel_mrad"][0] > 0 and "0_0_0" in r["note"]
    rg = r["ranges"]
    assert rg["h"][0] <= 0 <= rg["h"][1]
    # the beams and their ranges, and a disc by indices (000 is the default)
    b = get(job, "beams", result="lacbed").json()
    assert [0, 0, 0] in b["hkl"] and b["ranges"] == rg
    f000 = fr(job, "frame", result="lacbed", depth=1)
    np.testing.assert_allclose(numbers(f000), viewer.display_orientation(z["0_0_0"][1]), rtol=1e-6)
    assert f000["hkl"] == [0, 0, 0] and f000["unit"] == "mrad"
    other = next(h for h in b["hkl"] if h != [0, 0, 0])
    g = fr(job, "frame", result="lacbed", h=other[0], k=other[1], l=other[2])
    assert g["hkl"] == other
    bad = client.get(f"/api/jobs/{job['id']}/frame", params={"result": "lacbed", "h": 99})
    assert bad.status_code == 422 and "h from" in bad.json()["detail"]["message"]
    # the solve of a Bloch run is kept in the run's own temp folder
    assert [p.name for p in (folder / "temp").iterdir()][0].startswith("emsim-bloch-")
    # postprocessing makes a processed dataset: expected counts and noisy counts of every disc
    s = {"pixel_mode": "native", "target": 0.1, "smoothing": 0.5, "dose": {"electrons": 1e6},
         "noise": True, "samples": 1, "seed": 3}
    out = client.post(f"/api/jobs/{job['id']}/detector", json=s)
    assert out.status_code == 200, out.text
    proc = out.json()["results"][0]["processed"]
    assert proc["file"] == "lacbed_processed.npz" and proc["noisy"] == "lacbed_noisy.npz"
    with np.load(folder / "results" / "lacbed_processed.npz") as zp:
        assert set(zp.files) == set(z) - {"mask"}  # the mask does not survive resampling
    pf = fr(job, "frame", result="lacbed", source="processed", depth=1)
    n = numbers(pf)
    assert np.allclose(n, np.round(n)) and pf["unit"] == "mrad"  # counts
    assert (folder / "results" / "lacbed_processed.png").is_file()
    # HDF5 has every beam: discs["h_k_l"]
    with h5py.File(export(job, result="lacbed", format="h5"), "r") as hf:
        assert set(hf["discs"]) == {discs.name(h) for h in b["hkl"]}
        assert hf["discs"]["0_0_0"].shape == z["0_0_0"].shape
    # the disc shown is also a frame export
    assert export(job, result="lacbed", format="npy", h=0, k=0, l=0).name.startswith("lacbed_native_0_0_0")
    client.delete(f"/api/jobs/{job['id']}/detector")
    bloch_sim.CACHE.clear()
    assert not (folder / "temp").exists()  # deleting the saved solve leaves no empty folder
