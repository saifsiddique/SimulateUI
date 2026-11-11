"""INCOSTEM (context.md §7.MU step U6): the incoherent ADF-STEM image against the original program.

The fixtures (tests/fixtures/incostem_computem.npz) were made by running Kirkland's incostem on the
cases of incostem_cases.py (scripts/compare_incostem.py). The original is a GPL program: it was
only run, never copied or linked.
"""

import base64
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

import incostem_cases as cases
from emsim.main import app
from emsim.services import incostem as ic
from emsim.services import specimen as sp

FIXTURE = Path(__file__).parent / "fixtures" / "incostem_computem.npz"
REF = np.load(FIXTURE)
client = TestClient(app)


def image(out: dict) -> np.ndarray:
    return np.frombuffer(base64.b64decode(out["image"]), dtype="<f4").reshape(out["shape"]).astype(float)


def agree(ours: np.ndarray, ref: np.ndarray) -> tuple[float, float]:
    """Correlation and the largest difference as a fraction of the reference's peak."""
    return float(np.corrcoef(ours.ravel(), ref.ravel())[0, 1]), float(np.abs(ours - ref).max() / ref.max())


def extras(c: dict) -> dict:
    return {k: c[k] for k in ("source", "dfspread", "aber") if k in c}


def params(probe, adf, grid, **kw) -> dict:
    kv, cs, c5, df, alpha = probe
    out = dict(energy_kv=kv, cs_mm=cs, c5_mm=c5, defocus=df, semiangle_mrad=alpha, adf_min_mrad=adf[0],
               adf_max_mrad=adf[1], grid=list(grid), source_fwhm=kw.get("source", 0.0),
               defocus_spread_fwhm=kw.get("dfspread", 0.0))
    if kw.get("aber"):
        out["aberrations"] = cases.abtem_aberrations(kw["aber"])
    return out


# ---- partial cross sections ------------------------------------------------------------------


@pytest.mark.parametrize("z,kv,adf", cases.SIGMAS)
def test_cross_sections_agree_with_the_original_within_1_percent(z, kv, adf):
    from ase.data import chemical_symbols

    ref = float(REF[f"sigma/{z}/{kv}"])
    ours = ic.cross_section(chemical_symbols[z], float(kv), adf[0] * 1e-3, adf[1] * 1e-3)
    assert ours == pytest.approx(ref, rel=0.01)


def test_cross_sections_grow_with_z_and_a_wider_detector_catches_more():
    s = [ic.cross_section(e, 200.0, 0.05, 0.2) for e in ("C", "Si", "Ti", "Sr", "Au")]
    assert s == sorted(s)
    assert ic.cross_section("Si", 200.0, 0.03, 0.2) > ic.cross_section("Si", 200.0, 0.05, 0.2)
    lobato = ic.cross_section("Si", 200.0, 0.05, 0.2, "lobato")
    assert lobato == pytest.approx(s[1], rel=0.1)  # the two parametrizations agree to a few %
    with pytest.raises(ValueError):
        ic.cross_section("Si", 200.0, 0.2, 0.05)
    with pytest.raises(ValueError):
        ic.cross_section("Xx", 200.0, 0.05, 0.2)
    with pytest.raises(ValueError):
        ic.cross_section("Si", 200.0, 0.05, 0.2, "nope")


# ---- images -----------------------------------------------------------------------------------


@pytest.mark.parametrize("name", list(cases.CASES))
def test_lattice_images_agree_with_the_original(name):
    c = cases.CASES[name]
    out = ic.adf_image(cases.lattice_atoms(c), params(c["probe"], c["adf"], c["grid"], **extras(c)))
    corr, worst = agree(image(out), REF[f"{name}/image"].astype(float))
    assert corr > 0.999, (name, corr)
    assert worst < 0.01, (name, worst)
    for e in out["sigmas"]:
        assert e["sigma"] == pytest.approx(float(REF[f"{name}/sigma{e['z']}"]), rel=0.01)


@pytest.mark.parametrize("name", [n for n, c in cases.SINGLE.items() if not c.get("odd")])
def test_single_atom_psf_agrees_with_the_original(name):
    c = cases.SINGLE[name]
    out = ic.adf_image(cases.single_atom(dx_frac=c.get("dx_frac", 0.0)),
                       params(c["probe"], c["adf"], cases.ONE_GRID, **extras(c)))
    corr, worst = agree(image(out), REF[f"{name}/image"].astype(float))
    assert corr > 0.999 and worst < 0.01, (name, corr, worst)


@pytest.mark.parametrize("name", [n for n, c in cases.SINGLE.items() if c.get("odd")])
def test_odd_order_aberrations_are_the_original_turned_about_the_atom(name):
    """The original's probe for the odd terms (C21, C23, C45) is the point inversion of abTEM's:
    the sign convention of the Fourier transform. SimulateUI follows abTEM, so that INCOSTEM and the
    multislice agree (`test_psf_equals_abtems_probe`); here the original is turned to compare."""
    c = cases.SINGLE[name]
    out = ic.adf_image(cases.single_atom(), params(c["probe"], c["adf"], cases.ONE_GRID, **extras(c)))
    ref = REF[f"{name}/image"].astype(float)
    corr, worst = agree(image(out), cases.point_invert(ref))
    assert corr > 0.999 and worst < 0.01, (name, corr, worst)
    assert agree(image(out), ref)[0] < 0.9999  # and it is not the original as it stands


def test_psf_equals_abtems_probe():
    import abtem
    from abtem.core.config import config

    from emsim.services import abtem_sim

    config["local_diagnostics.task_level_progress"] = False
    n, ext = 128, 25.6
    for kw in (dict(defocus=-50.0, cs_mm=1.3),
               dict(extra={"C21": 1000.0, "phi21": 0.3}),
               dict(extra={"C23": 800.0, "phi23": 0.2, "C12": 150.0, "phi12": 1.0}),
               dict(extra={"C45": 5e5, "phi45": 0.1, "C32": 4000.0, "phi32": 0.5})):
        ab = abtem_sim.probe_aberrations(kw.get("defocus", 0.0), kw.get("cs_mm", 0.0), 0.0, kw.get("extra"))
        probe = abtem.Probe(energy=200e3, semiangle_cutoff=20.0, gpts=(n, n), extent=(ext, ext),
                            soft=False, aberrations=ab, device="cpu")
        theirs = np.asarray(probe.build((ext / 2, ext / 2)).compute().intensity().array)
        theirs = np.roll(theirs, (-n // 2, -n // 2), (0, 1))
        theirs = theirs / theirs.sum()
        _, psf = ic.transfer((n, n), (ext, ext), 200.0, 20.0, ab)
        psf = np.asarray(psf) / np.asarray(psf).sum()
        assert np.abs(psf - theirs).max() / theirs.max() < 1e-4, kw


# ---- the pieces ---------------------------------------------------------------------------------


def test_the_mean_of_the_image_is_the_total_cross_section_over_the_area():
    c = cases.CASES["srtio3_001"]
    atoms = cases.lattice_atoms(c)
    out = ic.adf_image(atoms, params(c["probe"], c["adf"], c["grid"], **extras(c)))
    total = sum(e["sigma"] * e["atoms"] for e in out["sigmas"])
    area = atoms.cell[0, 0] * atoms.cell[1, 1]
    assert image(out).mean() == pytest.approx(total / area, rel=1e-5)
    assert [e["symbol"] for e in out["sigmas"]] == ["O", "Ti", "Sr"]
    assert sorted(e["atoms"] for e in out["sigmas"]) == [72, 72, 216]  # 6 x 6 x 2 cells: Sr 1, Ti 1, O 3 each


def test_bilinear_placement_keeps_the_weight_and_the_centre():
    xy = np.array([[2.3, 4.9], [0.0, 0.0], [9.99, 9.99]])
    w = np.array([1.0, 2.0, 3.0])
    g = ic.specimen_function(xy, w, (10.0, 10.0), (50, 40))
    assert g.sum() == pytest.approx(6.0)
    i, j = np.meshgrid(np.arange(50) * 0.2, np.arange(40) * 0.25, indexing="ij")
    one = ic.specimen_function(np.array([[2.3, 4.9]]), np.array([1.0]), (10.0, 10.0), (50, 40))
    assert (one * i).sum() == pytest.approx(2.3) and (one * j).sum() == pytest.approx(4.9)
    # the last pixel wraps round to the first
    edge = ic.specimen_function(np.array([[9.9, 0.0]]), np.array([1.0]), (10.0, 10.0), (50, 40))
    assert edge[49, 0] > 0 and edge[0, 0] > 0 and edge.sum() == pytest.approx(1.0)


def test_source_size_and_defocus_spread_only_blur():
    c = cases.SINGLE["one_plain"]
    base = image(ic.adf_image(cases.single_atom(), params(c["probe"], c["adf"], cases.ONE_GRID)))
    blur = image(ic.adf_image(cases.single_atom(), params(c["probe"], c["adf"], cases.ONE_GRID, source=1.0)))
    assert blur.max() < base.max() and blur.sum() == pytest.approx(base.sum(), rel=1e-5)


def test_noise_is_reproducible_and_its_mean_is_the_scaled_clean_image():
    c = cases.CASES["si110_a10"]
    atoms = cases.lattice_atoms(c)
    p = params(c["probe"], c["adf"], c["grid"])
    clean = image(ic.adf_image(atoms, p))
    noise = dict(current_pa=50.0, dwell_us=100.0, seed=7)
    a = ic.adf_image(atoms, {**p, "noise": noise})
    b = ic.adf_image(atoms, {**p, "noise": noise})
    other = ic.adf_image(atoms, {**p, "noise": {**noise, "seed": 8}})
    assert a["image"] == b["image"] and a["image"] != other["image"]
    scale = 50.0 * 100.0 * ic.ELECTRONS_PER_PA_US
    assert a["counts_scale"] == pytest.approx(scale) and a["noisy"]
    counts = image(a)
    assert np.allclose(counts, np.round(counts))  # whole electrons
    # mean over many pixels: within 4 standard errors of the clean mean (Poisson variance = mean)
    mean_c, mean_n = clean.mean() * scale, counts.mean()
    assert abs(mean_n - mean_c) < 4.0 * np.sqrt(mean_c / counts.size)


def test_the_image_follows_the_field_of_view():
    c = cases.CASES["si110_a10"]
    atoms = cases.lattice_atoms(c)
    p = params(c["probe"], c["adf"], c["grid"])
    full = ic.adf_image(atoms, p)
    box = full["box"]
    dx, dy = full["pixel"]
    first = ic.adf_image(atoms, {**p, "fov": [0.0, 0.0, 10 * dx, 8 * dy]})
    moved = ic.adf_image(atoms, {**p, "fov": [20 * dx, 12 * dy, 10 * dx, 8 * dy]})
    f = image(full)
    assert first["shape"] == [10, 8] and moved["shape"] == [10, 8]
    assert np.allclose(image(first), f[0:10, 0:8], atol=0, rtol=1e-6)
    assert np.allclose(image(moved), f[20:30, 12:20], atol=0, rtol=1e-6)
    assert moved["fov"] == pytest.approx([20 * dx, 12 * dy, 10 * dx, 8 * dy])
    # a field beyond the box is cut at its edge
    big = ic.adf_image(atoms, {**p, "fov": [box[0] - 5 * dx, 0.0, 100.0, 4 * dy]})
    assert big["shape"][0] == 5
    # no field = the whole box
    assert full["shape"] == [128, 96] and full["fov"] == pytest.approx([0.0, 0.0, box[0], box[1]])


def test_a_pixel_size_makes_a_whole_number_of_pixels_of_the_box():
    atoms = cases.lattice_atoms(cases.CASES["si110_a10"])
    out = ic.adf_image(atoms, dict(energy_kv=200, semiangle_mrad=10, pixel_size=0.25))
    assert out["grid"] == [round(30.7167 / 0.25), round(32.58 / 0.25)]
    assert out["pixel"][0] == pytest.approx(30.7167 / out["grid"][0])
    with pytest.raises(ValueError):
        ic.adf_image(atoms, dict(energy_kv=200, semiangle_mrad=10, pixel_size=0.001))
    with pytest.raises(ValueError):
        ic.adf_image(atoms, dict(energy_kv=200, semiangle_mrad=10, adf_min_mrad=100, adf_max_mrad=50))


def test_warnings_for_a_thick_specimen_and_a_coarse_pixel():
    thin = cases.lattice_atoms(cases.CASES["si110_a10"])
    out = ic.adf_image(thin, dict(energy_kv=200, semiangle_mrad=10, pixel_size=0.3))
    assert out["warnings"] == []
    thick = cases.lattice_atoms({**cases.CASES["si110_a10"], "ncell": (2, 2, 20)})
    w = " ".join(ic.adf_image(thick, dict(energy_kv=200, semiangle_mrad=10, pixel_size=0.3))["warnings"])
    assert "channelling" in w and "thick" in w
    coarse = ic.adf_image(thin, dict(energy_kv=200, semiangle_mrad=30, pixel_size=0.5))
    assert any("under-sampled" in x for x in coarse["warnings"])


def test_partial_occupancy_weights_the_atoms():
    atoms = cases.single_atom()
    atoms.arrays["occupancy"] = np.array([0.5])
    c = cases.SINGLE["one_plain"]
    full = image(ic.adf_image(cases.single_atom(), params(c["probe"], c["adf"], cases.ONE_GRID)))
    half = image(ic.adf_image(atoms, params(c["probe"], c["adf"], cases.ONE_GRID)))
    assert half.sum() == pytest.approx(0.5 * full.sum(), rel=1e-6)


def test_a_512_square_image_takes_under_a_second():
    atoms = cases.lattice_atoms(cases.CASES["si110_a10"])
    p = dict(energy_kv=200, semiangle_mrad=20, adf_min_mrad=50, adf_max_mrad=200, grid=[512, 512], cs_mm=1.0,
             defocus_spread_fwhm=40.0, source_fwhm=0.5)
    ic.adf_image(atoms, p)  # the cross section is cached after the first call
    t = time.perf_counter()
    out = ic.adf_image(atoms, p)
    assert time.perf_counter() - t < 1.0 and out["shape"] == [512, 512]


def test_the_gpu_gives_the_cpu_image():
    pytest.importorskip("cupy")
    c = cases.CASES["si110_a10"]
    atoms = cases.lattice_atoms(c)
    p = params(c["probe"], c["adf"], c["grid"], **extras(c))
    cpu, gpu = image(ic.adf_image(atoms, p)), image(ic.adf_image(atoms, {**p, "device": "gpu"}))
    assert np.abs(cpu - gpu).max() / cpu.max() < 1e-4


# ---- the endpoint -----------------------------------------------------------------------------


def test_the_endpoint_returns_the_image_the_cross_sections_and_the_psf():
    sp.store.put("inc1", cases.lattice_atoms(cases.CASES["srtio3_001"]))
    r = client.post("/api/incostem", json={
        "specimenId": "inc1", "energy_kv": 200, "semiangle_mrad": 21, "adf_min_mrad": 80,
        "adf_max_mrad": 300, "pixel_size": 0.25, "source_fwhm": 0.3, "defocus": 30, "cs_mm": 1.0,
    })
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["png"].startswith("iVBOR") and b["psf"]["png"].startswith("iVBOR")
    assert b["shape"] == b["grid"] and b["fov"][2] == pytest.approx(b["box"][0])
    assert {e["symbol"] for e in b["sigmas"]} == {"Sr", "Ti", "O"}
    assert b["psf"]["profile"]["fwhm"] and b["seconds"] > 0 and not b["noisy"]
    assert image(b).shape == tuple(b["shape"]) and b["vmax"] >= b["vmin"] > 0
    noisy = client.post("/api/incostem", json={"specimenId": "inc1", "pixel_size": 0.25,
                                               "noise": {"current_pa": 20, "dwell_us": 50, "seed": 3}}).json()
    assert noisy["noisy"] and noisy["counts_scale"] == pytest.approx(20 * 50 * 6.24146)
    assert client.post("/api/incostem", json={"specimenId": "nope"}).status_code == 404
    bad = client.post("/api/incostem", json={"specimenId": "inc1", "adf_min_mrad": 300, "adf_max_mrad": 100})
    assert bad.status_code == 422 and "inner angle" in bad.json()["detail"]["message"]
    assert client.post("/api/incostem", json={"specimenId": "inc1", "semiangle_mrad": 0}).status_code == 422
