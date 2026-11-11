from fastapi.testclient import TestClient

from emsim.main import app
from emsim.services import hardware
from emsim.services.estimate import EstimateRequest, estimate

client = TestClient(app)


def test_health_reports_versions():
    r = client.get("/api/health")
    assert r.status_code == 200
    v = r.json()["versions"]
    assert v["abtem"] and v["ase"] and v["numpy"] and v["h5py"]


def test_static_files_get_browser_safe_mime_types(tmp_path, monkeypatch):
    """Windows can map .js to text/plain, which makes browsers refuse the app (blank page)."""
    import mimetypes

    from fastapi import FastAPI
    from fastapi.staticfiles import StaticFiles

    mimetypes.add_type("text/plain", ".js")  # what a misconfigured registry does
    import importlib

    import emsim.main

    importlib.reload(emsim.main)  # re-declares the types at import
    (tmp_path / "a.js").write_text("export {}")
    (tmp_path / "a.css").write_text("a{}")
    (tmp_path / "a.wasm").write_bytes(b"\0asm")
    site = FastAPI()
    site.mount("/", StaticFiles(directory=tmp_path), name="s")
    c = TestClient(site)
    assert c.get("/a.js").headers["content-type"].startswith("text/javascript")
    assert c.get("/a.css").headers["content-type"].startswith("text/css")
    assert c.get("/a.wasm").headers["content-type"] == "application/wasm"


def test_cpu_info():
    c = hardware.cpu_info()
    assert c["physical_cores"] >= 1 and c["ram_total"] > 0


def test_system_endpoint_shape():
    r = client.get("/api/system")
    assert r.status_code == 200
    j = r.json()
    assert j["recommended"]["device"] in ("gpu", "cpu")
    assert "devices" in j["gpu"]
    assert j["platform"]["system"] in ("Windows", "macOS", "Linux")
    assert isinstance(j["platform"]["apple_silicon"], bool)


def test_apple_silicon_runs_on_the_cpu_and_says_why(monkeypatch):
    monkeypatch.setattr(
        hardware,
        "gpu_info",
        lambda: {"cupy_installed": False, "available": False, "reason": "no cupy", "devices": []},
    )
    monkeypatch.setattr(
        hardware,
        "platform_info",
        lambda: {"system": "macOS", "release": "24", "machine": "arm64", "python": "3.12",
                 "apple_silicon": True},
    )
    j = hardware.system_report()
    assert j["recommended"]["device"] == "cpu"
    assert "Apple silicon" in j["recommended"]["reason"]


def test_cpu_fallback_without_cupy(monkeypatch):
    monkeypatch.setattr(
        hardware,
        "gpu_info",
        lambda: {"cupy_installed": False, "available": False, "reason": "no cupy", "devices": []},
    )
    j = hardware.system_report()
    assert j["recommended"]["device"] == "cpu"
    assert "no cupy" in j["recommended"]["reason"]


def test_estimate_scales_with_positions():
    base = dict(gpts=(1024, 1024), n_slices=50, detector_shape=(128, 128))
    a = estimate(EstimateRequest(**base, scan_positions=100))
    b = estimate(EstimateRequest(**base, scan_positions=10000))
    assert b.output_bytes == 100 * a.output_bytes
    assert b.seconds > a.seconds
    assert a.output_bytes == 100 * 128 * 128 * 4


def test_estimate_endpoint():
    r = client.post("/api/estimate", json={"gpts": [512, 512], "n_slices": 10})
    assert r.status_code == 200 and r.json()["peak_bytes"] > 0
