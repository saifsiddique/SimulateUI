"""abTEM preview numbers against the formulas in context.md 5.5, and the warning rules."""

import json
from pathlib import Path

import pytest
from ase.build import bulk
from fastapi.testclient import TestClient

from emsim.main import app
from emsim.models.structure import StructurePayload
from emsim.services import abtem_sim, specimen as sp
from emsim.services import structure as st

PAYLOADS = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "fixtures" / "payloads"
client = TestClient(app)


def test_wavelength_matches_the_stated_values():
    assert abtem_sim.wavelength_a(200) == pytest.approx(0.025079, abs=1e-6)
    assert abtem_sim.wavelength_a(300) == pytest.approx(0.019687, abs=1e-6)


def test_si_110_readouts_match_a_hand_calculation():
    energy, sampling, alpha, side = 200.0, 0.05, 21.0, 30.0
    lam = 0.025079340317328468
    assert abtem_sim.alpha_max_mrad(sampling, energy) == pytest.approx((2 / 3) * lam / (2 * sampling) * 1e3)
    assert abtem_sim.nyquist_step_a(alpha, energy) == pytest.approx(lam / (4 * alpha * 1e-3))
    assert abtem_sim.diffraction_pixel_mrad(side, energy) == pytest.approx(lam / side * 1e3)
    # and the Nyquist step is what abTEM itself reports
    import abtem

    probe = abtem.Probe(energy=energy * 1e3, semiangle_cutoff=alpha, extent=8, sampling=0.1)
    assert float(probe.aperture.nyquist_sampling) == pytest.approx(
        abtem_sim.nyquist_step_a(alpha, energy), rel=1e-6
    )


def test_warnings_fire_for_bad_inputs(monkeypatch):
    monkeypatch.setattr(abtem_sim, "project_potential", lambda *a, **k: __import__("numpy").zeros((4, 4)))
    monkeypatch.setattr(abtem_sim, "probe_image", lambda *a, **k: __import__("numpy").zeros((4, 4)))
    atoms = bulk("Si", "diamond", a=5.43, cubic=True)  # side 5.43 Å: a coarse diffraction pixel
    out = abtem_sim.preview(atoms, {
        "energy_kv": 200, "sampling": 0.2, "semiangle_mrad": 20, "sim_type": "stem",
        "scan_step": 1.0, "fov_margin": 0.1,
        "detectors": [{"name": "HAADF", "inner": 50, "outer": 200}],
    })
    text = " ".join(out["warnings"])
    assert "beyond" in text and "Nyquist" in text and "tails" in text
    assert "under-sampled" in text


def test_series_multiply_the_runs_and_the_saved_output(monkeypatch):
    np = __import__("numpy")
    monkeypatch.setattr(abtem_sim, "project_potential", lambda *a, **k: np.zeros((4, 4)))
    monkeypatch.setattr(abtem_sim, "probe_image", lambda *a, **k: np.zeros((4, 4)))
    atoms = bulk("Si", "diamond", a=5.43, cubic=True) * (2, 2, 4)  # 21.7 Å thick
    base = {"energy_kv": 200, "sampling": 0.2, "semiangle_mrad": 10, "sim_type": "cbed"}
    one = abtem_sim.preview(atoms, base)
    assert one["series"] == {"runs": 1, "saved_depths": 1, "defoci": 0, "tilts": 0}
    # the reciprocal pixel is λ / L: the box sets it, the potential sampling does not
    lam_mrad = abtem_sim.wavelength_a(200) * 1e3
    assert one["diffraction_pixel_xy"] == pytest.approx([lam_mrad / 10.86, lam_mrad / 10.86])
    fine = abtem_sim.preview(atoms, {**base, "sampling": 0.05})
    assert fine["diffraction_pixel_xy"] == pytest.approx(one["diffraction_pixel_xy"])
    assert fine["alpha_max_mrad"] == pytest.approx(4 * one["alpha_max_mrad"])
    # binning: a quarter of the pixels across, one sixteenth of the saved pattern
    binned = abtem_sim.preview(atoms, {**base, "pattern_size": 128, "binning": 4})
    assert (one["binned_size"], binned["binned_size"], binned["binning"]) == (128, 32, 4)
    assert binned["memory"]["output_bytes"] * 16 == one["memory"]["output_bytes"]
    many = abtem_sim.preview(atoms, {
        **base, "defocus_series": [0, 50, 100], "tilt_series": [[0, 0], [5, 0]],
        "thicknesses": [5, 10, 40],
    })
    assert many["series"] == {"runs": 6, "saved_depths": 3, "defoci": 3, "tilts": 2}
    assert many["memory"]["seconds"] == pytest.approx(6 * one["memory"]["seconds"])
    assert many["memory"]["output_bytes"] == 18 * one["memory"]["output_bytes"]
    assert any("beyond the specimen" in w for w in many["warnings"])
    # no tilt series for STEM, no defocus series for SAED
    stem = abtem_sim.preview(atoms, {**base, "sim_type": "stem", "tilt_series": [[0, 0], [5, 0]]})
    saed = abtem_sim.preview(atoms, {**base, "sim_type": "saed", "defocus_series": [0, 50]})
    assert stem["series"]["runs"] == 1 and saed["series"]["runs"] == 1


def test_preview_endpoint_on_a_small_specimen():
    p = StructurePayload(**json.loads((PAYLOADS / "Si.json").read_text()))
    atoms = st.build_atoms(p)
    built = sp.build(atoms, (1, 1, 0), repeats_requested=(1, 1, 1))
    sp.store.put("s1", built["atoms_object"])
    r = client.post("/api/abtem/preview", json={
        "specimenId": "s1", "sim_type": "stem", "energy_kv": 200, "sampling": 0.2,
        "semiangle_mrad": 20, "scan_step": 0.3,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["gpts"][0] > 0 and body["alpha_max_mrad"] > 0
    assert body["images"]["potential"].startswith("iVBOR")  # a PNG
    assert body["nyquist_step"] == pytest.approx(abtem_sim.nyquist_step_a(20, 200))
    missing = client.post("/api/abtem/preview", json={"specimenId": "nope"})
    assert missing.status_code == 404


def test_si_110_discs_sit_at_111_and_220():
    import numpy as np

    p = StructurePayload(**json.loads((PAYLOADS / "Si.json").read_text()))
    atoms = st.build_atoms(p)
    built = sp.build(atoms, (1, 1, 0), repeats_requested=(2, 2, 1))
    sp.store.put("s110", built["atoms_object"])
    out = abtem_sim.preview(built["atoms_object"], {
        "sim_type": "cbed", "energy_kv": 200, "sampling": 0.05, "semiangle_mrad": 5,
    })
    discs = np.array(out["discs"])
    assert tuple(discs[0]) == (0.0, 0.0, 1.0)
    g = np.hypot(discs[1:, 0], discs[1:, 1])
    strong = g[discs[1:, 2] > 0.05]
    a = 5.431
    for target in (np.sqrt(3) / a, np.sqrt(8) / a):  # |g| of 111 and 220
        assert np.min(np.abs(strong - target)) < 1e-3
    # 002 is kinematically forbidden in diamond (h + k + l = 4n + 2): it is absent here and only
    # appears dynamically.
    assert np.min(np.abs(g - 2 / a)) > 1e-3
    assert out["extents"]["potential"] == pytest.approx(list(built["atoms_object"].cell.lengths()[:2]))


def test_images_are_in_the_down_the_beam_orientation():
    import numpy as np

    a = np.zeros((4, 3))  # [x, y]
    a[3, 0] = 1  # largest x, smallest y: bottom left on the screen (+x points left, +y up)
    img = abtem_sim.display_orientation(a)
    assert img.shape == (3, 4)
    assert img[-1, 0] == 1


def test_probe_profile_gives_fwhm_and_tail():
    lam = abtem_sim.wavelength_a(200)
    sampling, n = abtem_sim.probe_window(200, 20, 0)
    image = abtem_sim.probe_image(200, 20, 0, 0)
    prof = abtem_sim.radial_profile(image, sampling)
    # An aberration-free probe: Airy FWHM = 0.514 λ/α.
    assert prof["fwhm"] == pytest.approx(0.514 * lam / 0.020, rel=0.1)
    assert prof["tail"] > prof["fwhm"]
    assert prof["intensity"][0] == pytest.approx(1.0, abs=0.05)
    # A defocused probe is wider, and the window grows with it.
    assert abtem_sim.probe_window(200, 20, 500)[1] > n


def test_aberrations_merge_with_the_defocus_sign_and_reject_unknown_names():
    out = abtem_sim.probe_aberrations(100.0, 1.2, 0.0, {"C12": 20.0, "phi12": 0.5, "C30": 5e6})
    assert out["C10"] == -100.0 and out["C12"] == 20.0 and out["C30"] == 5e6  # extra wins
    with pytest.raises(ValueError):
        abtem_sim.probe_aberrations(0.0, extra={"banana": 1.0})
    plain = abtem_sim.probe_image(200, 20, 0, 0)
    astig = abtem_sim.probe_image(200, 20, 0, 0, extra={"C12": 100.0})
    assert not abs(plain - astig).max() < 1e-9  # the coefficient changes the probe


def test_probe_download_as_npz_and_csv():
    import io as _io

    import numpy as np

    body = {"specimenId": "x", "energy_kv": 200, "semiangle_mrad": 20, "defocus": 50,
            "aberrations": {"C12": 10.0, "phi12": 0.0}}
    r = client.post("/api/abtem/probe?fmt=npz", json=body)
    assert r.status_code == 200 and "probe.npz" in r.headers["content-disposition"]
    z = np.load(_io.BytesIO(r.content))
    assert z["intensity"].ndim == 2 and float(z["sampling"]) > 0
    assert list(z["aberration_names"]) == ["C12", "phi12"]
    c = client.post("/api/abtem/probe?fmt=csv", json=body)
    assert c.status_code == 200 and c.text.startswith("# probe intensity")
    assert client.post("/api/abtem/probe?fmt=txt", json=body).status_code == 422
    bad = dict(body, aberrations={"zzz": 1.0})
    assert client.post("/api/abtem/probe?fmt=csv", json=bad).status_code == 422
