"""The detector post-processing (context.md M6.5): Fourier interpolation, blur, dose, shot noise."""

import json

import numpy as np
import pytest

from emsim.services import detector


def wave(n, kx, ky, phase=0.3):
    x = np.arange(n) / n
    return np.cos(2 * np.pi * kx * x[:, None] + phase) * np.cos(2 * np.pi * ky * x[None, :] - phase)


def test_fft_resize_of_a_band_limited_image_is_exact_and_keeps_the_mean():
    a = 2 + wave(32, 3, 2)
    up = detector.fft_resize(a, 64, 64, "values")
    np.testing.assert_allclose(up, 2 + wave(64, 3, 2), atol=1e-10)
    back = detector.fft_resize(up, 32, 32, "values")
    np.testing.assert_allclose(back, a, atol=1e-10)
    assert up.mean() == pytest.approx(a.mean())


def test_fft_resize_keeps_the_sum_of_a_pattern_and_the_identity_is_exact():
    a = np.abs(wave(32, 2, 1)) + 0.1
    assert detector.fft_resize(a, 64, 48, "sum").sum() == pytest.approx(a.sum())
    np.testing.assert_allclose(detector.fft_resize(a, 32, 32, "values"), a, atol=1e-12)


def test_resample_reaches_the_target_pixel_and_a_non_square_pixel_ends_square():
    a = 1 + 0.3 * wave(40, 2, 1)
    out, got = detector.resample(a, (0.1, 0.15), 0.1, "values")
    assert got == pytest.approx((0.1, 0.1), rel=0.02)
    assert abs(out.shape[0] - 40) <= 1 and abs(out.shape[1] - 60) <= 1  # the field of view, to a pixel
    assert out.mean() == pytest.approx(a.mean(), rel=1e-2)
    same, p = detector.resample(a, (0.1, 0.1), 0.1, "values")
    assert same is a and p == (0.1, 0.1)
    (mx, my), reached = detector.target_shape((40, 40), (0.1, 0.15), 0.1)
    assert out.shape == (mx, my) and reached == pytest.approx(got)


def test_smoothing_blurs_in_the_unit_of_the_pixel_and_keeps_the_sum():
    a = np.zeros((41, 41))
    a[20, 20] = 1.0
    b = detector.smooth(a, 0.2, (0.1, 0.1))  # sigma = 2 pixels
    assert b.sum() == pytest.approx(1.0)
    assert b[20, 20] == pytest.approx(1 / (2 * np.pi * 4), rel=0.02)
    assert detector.smooth(a, 0.0, (0.1, 0.1)) is a


def test_the_electrons_of_a_dose():
    stem = detector.electrons({"current_pa": 10, "time_us": 10}, "stem", (0.1, 0.1))
    assert stem == pytest.approx(624.15, rel=1e-4)  # 10 pA for 10 us
    hr = detector.electrons({"dose_per_area": 100}, "hrtem", (0.05, 0.05))
    assert hr == pytest.approx(0.25)
    assert detector.electrons({"electrons": 1000}, "stem", (0.1, 0.1)) == 1000  # per position
    assert detector.electrons({"electrons": 1e6}, "saed", (1, 1)) == 1e6  # in the pattern
    assert detector.electrons(None, "stem", (1, 1)) is None
    with pytest.raises(ValueError):
        detector.electrons({"current_pa": 10}, "saed", (1, 1))
    with pytest.raises(ValueError):
        detector.electrons({"current_pa": 10, "time_us": 1}, "hrtem", (1, 1))


def test_shot_noise_is_poisson_and_the_seed_repeats_it():
    expected = np.full((200, 200), 7.0)
    a = detector.shot_noise(expected, np.random.default_rng(3))
    assert a.dtype == np.uint32
    assert a.mean() == pytest.approx(7.0, abs=0.1) and a.var() == pytest.approx(7.0, rel=0.05)
    np.testing.assert_array_equal(a, detector.shot_noise(expected, np.random.default_rng(3)))
    assert not np.array_equal(a, detector.shot_noise(expected, np.random.default_rng(4)))


def make_run(tmp_path):
    """A finished run's results folder: a STEM image, a pattern, a 4D-STEM zarr and Bloch spots."""
    import zarr

    d = tmp_path / "results"
    d.mkdir()
    img = (0.3 + 0.2 * wave(24, 2, 1))[None, None]
    np.save(d / "stem_BF.npy", img)
    pat = np.zeros((1, 1, 32, 40))
    pat[0, 0, 16, 20] = 0.6
    pat[0, 0, 10, 12] = 0.4
    np.save(d / "saed.npy", pat)
    z = zarr.open(str(d / "4dstem.zarr"), mode="w", shape=(1, 1, 3, 4, 16, 16), dtype="float32")
    z[:] = np.random.default_rng(0).random((1, 1, 3, 4, 16, 16)) / 256
    np.savez(d / "spots.npz", hkl=np.zeros((3, 3)), qxy=np.array([[0, 0], [1, 0], [0, 1.0]]),
             thicknesses=np.array([100.0]), intensity=np.array([[0.7, 0.2, 0.1]]))
    results = [
        {"name": "stem_BF", "kind": "image", "file": "stem_BF.npy", "preview": "stem_BF.png",
         "sim_type": "stem", "pixel": [0.2, 0.2], "shape": [1, 1, 24, 24]},
        {"name": "saed", "kind": "pattern", "file": "saed.npy", "preview": "saed.png",
         "sim_type": "saed", "pixel_mrad": [2.0, 1.6], "shape": [1, 1, 32, 40]},
        {"name": "4dstem", "kind": "pattern", "file": "4dstem.zarr", "preview": "4dstem.png",
         "sim_type": "4dstem", "pixel_mrad": [2.0, 2.0], "shape": [1, 1, 3, 4, 16, 16]},
        {"name": "spots", "kind": "spots", "file": "spots.npz", "preview": "spots.png",
         "sim_type": "saed"},
        {"name": "exit_wave", "kind": "wave", "file": "exit_wave.npy", "preview": "x.png"},
    ]
    (d / "results.json").write_text(json.dumps({"setup_params": {}, "output": results}))
    return d, results


SETTINGS = {"pixel_mode": "native", "target": 0.1, "smoothing": 0.0, "dose": None,
            "noise": False, "samples": 1, "seed": 0}


def test_process_writes_the_files_next_to_the_ideal_ones(tmp_path):
    import zarr

    d, results = make_run(tmp_path)
    s = {**SETTINGS, "pixel_mode": "target", "target": 1.0, "smoothing": 0.5,
         "dose": {"current_pa": 10, "time_us": 10}, "noise": True, "samples": 2, "seed": 5}
    out = detector.process(d, results, s)
    by = {r["name"]: r for r in out}
    img = by["stem_BF"]["processed"]
    assert img["pixel"][0] == pytest.approx(1.0, rel=0.05) and img["unit"] == "Å"
    assert all(abs(n - 4.8) <= 1 for n in np.load(d / img["file"]).shape[-2:])  # 4.8 Å at 1 Å
    noisy = np.load(d / img["noisy"])
    assert noisy.dtype == np.uint32 and noisy.shape == (2, 1, 1, *np.load(d / img["file"]).shape[-2:])
    assert (d / img["preview"]).is_file()
    # patterns: mrad, the field of view kept, the sum x the electrons is the expected total
    sa = by["saed"]["processed"]
    assert sa["unit"] == "mrad" and sa["pixel"][0] == pytest.approx(1.0, rel=0.05)
    assert np.load(d / sa["file"]).sum() == pytest.approx(624.15, rel=0.05)
    # 4D-STEM in chunks: the diffraction axes change, the scan axes do not
    zz = zarr.open(str(d / by["4dstem"]["processed"]["file"]), mode="r")
    assert zz.shape[:4] == (1, 1, 3, 4) and all(abs(n - 32) <= 1 for n in zz.shape[4:])  # 32 mrad at 1 mrad
    nz = zarr.open(str(d / by["4dstem"]["processed"]["noisy"]), mode="r")
    assert nz.shape == (2, *zz.shape)
    assert by["spots"]["processed"]["file"] == "spots_processed.npz"
    assert by["exit_wave"]["processed"] is None and "exit wave" in by["exit_wave"]["processed_note"]
    doc = json.loads((d / "results.json").read_text())
    assert doc["setup_params"]["output_processing"]["seed"] == 5
    assert doc["output"][0]["processed"]["file"] == img["file"]
    assert np.load(d / "stem_BF.npy").shape == (1, 1, 24, 24)  # the ideal result is untouched


def test_the_same_seed_gives_the_same_counts_and_a_new_dose_changes_them(tmp_path):
    d, results = make_run(tmp_path)
    s = {**SETTINGS, "dose": {"current_pa": 10, "time_us": 10}, "noise": True, "seed": 9}
    a = detector.process(d, results, s)
    first = np.load(d / a[0]["processed"]["noisy"]).copy()
    detector.process(d, results, s)
    np.testing.assert_array_equal(first, np.load(d / "stem_BF_noisy.npy"))
    detector.process(d, results, {**s, "dose": {"current_pa": 1, "time_us": 10}})
    assert np.load(d / "stem_BF_noisy.npy").sum() < first.sum() / 5


def test_noise_needs_a_dose_and_a_target_must_be_positive(tmp_path):
    d, results = make_run(tmp_path)
    with pytest.raises(ValueError, match="needs a dose"):
        detector.process(d, results, {**SETTINGS, "noise": True})
    with pytest.raises(ValueError, match="positive"):
        detector.process(d, results, {**SETTINGS, "pixel_mode": "target", "target": 0})
    assert not detector.active(SETTINGS)
    assert detector.active({**SETTINGS, "smoothing": 0.1})


def test_reset_removes_every_processed_file_and_entry_and_keeps_the_ideal_ones(tmp_path):
    d, results = make_run(tmp_path)
    s = {**SETTINGS, "pixel_mode": "target", "target": 1.0,
         "dose": {"electrons": 500}, "noise": True, "seed": 1}
    out = detector.process(d, results, s)
    assert all(r["processed"]["stamp"] > 0 for r in out if r["processed"])
    assert list(d.glob("*_processed.*")) and list(d.glob("*_noisy.*"))
    back = detector.reset(d, out)
    assert not list(d.glob("*_processed.*")) and not list(d.glob("*_noisy.*"))
    assert all("processed" not in r and "processed_note" not in r for r in back)
    assert (d / "stem_BF.npy").is_file() and (d / "4dstem.zarr").is_dir()
    doc = json.loads((d / "results.json").read_text())
    assert "output_processing" not in doc["setup_params"]
    # and it can be processed again afterwards
    assert detector.process(d, back, s)[0]["processed"]
