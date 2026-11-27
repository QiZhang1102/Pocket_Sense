import copy

import numpy as np
from PIL import Image
import pytest

from pocketsense_calibration.calibration import fit_profile
from pocketsense_calibration.colorimetry import linear_srgb_to_xyz
from pocketsense_calibration.pipeline import analyze_pair, check_profile
from pocketsense_calibration.synthetic import capture_metadata


@pytest.fixture
def pair(tmp_path):
    ambient = np.full((32, 32, 3), 0.1, dtype=np.float32)
    flashed = ambient + np.array([0.2, 0.3, 0.4], dtype=np.float32)
    left, right = tmp_path / "a.npy", tmp_path / "f.npy"
    np.save(left, ambient)
    np.save(right, flashed)
    return left, right, ambient, flashed, capture_metadata()


def analyze(pair, **kwargs):
    left, right, _, _, meta = pair
    return analyze_pair(left, right, metadata=meta, alignment="none", mode="controlled", **kwargs)


def profile_for(meta):
    rng = np.random.default_rng(123)
    rgb = rng.uniform(0.01, 0.9, (30, 3))
    return fit_profile(rgb, linear_srgb_to_xyz(rgb), metadata={
        "device": meta["device"], "camera": meta["camera"], "input_domain": meta["input_domain"],
        "capture_settings": {"iso": 100}, "target": "synthetic test", "date": "2026-11-26",
        "scale_reference": meta["scale_reference"]})


def test_real_signed_subtraction_and_unscaled_output(pair):
    report, arrays = analyze(pair)
    assert report["accepted"] and report["source_kind"] == "synthetic"
    np.testing.assert_allclose(report["color"]["linear_difference_rgb_mean"], [0.2, 0.3, 0.4], atol=5e-6)
    np.testing.assert_allclose(arrays["signed_difference"], pair[3] - pair[2])
    assert report["color"]["lab"] is None and report["color"]["xy"] is None


def test_saturation_negative_and_low_signal_excluded_without_clipping(pair):
    pair[3][0:8, :, :] = 1.0
    pair[3][8:16, :, :] = 0.01
    pair[3][16:24, :, :] = pair[2][16:24, :, :]
    np.save(pair[1], pair[3])
    report, arrays = analyze(pair)
    assert not report["accepted"] and report["color"]["linear_difference_rgb_mean"] is None
    assert arrays["signed_difference"].min() < 0
    assert not arrays["valid_mask"][:24].any()


@pytest.mark.parametrize("key", ["exposure_s", "iso", "aperture", "white_balance"])
def test_mismatched_settings_rejected_even_exploratory(pair, key):
    pair[4]["flash"][key] = "auto" if key == "white_balance" else 999
    with pytest.raises(ValueError, match="Mismatched"):
        analyze_pair(pair[0], pair[1], metadata=pair[4], alignment="none")


@pytest.mark.parametrize("key", ["ambient_stable", "geometry_locked", "linear_confirmed", "alignment_confirmed"])
def test_controlled_capture_requires_explicit_provenance(pair, key):
    pair[4].pop(key)
    with pytest.raises(ValueError):
        analyze(pair)


@pytest.mark.parametrize("scene", ["screen", "glossy", "transparent", "unknown"])
def test_scene_gate(pair, scene):
    pair[4]["scene"] = scene
    with pytest.raises(ValueError, match="scene"):
        analyze(pair)


def test_no_fake_snr_without_noise_model(pair):
    pair[4].pop("noise_sigma_ambient")
    pair[4].pop("noise_sigma_flash")
    report, _ = analyze(pair)
    assert report["quality"]["subtraction_snr_estimate"] is None
    assert "not illumination uniformity" in report["quality"]["spatial_interpretation"]


def test_profile_xy_only_then_explicit_referenced_lab(pair):
    profile = profile_for(pair[4])
    report, _ = analyze(pair, profile=profile)
    assert report["color"]["xy"] is not None and report["color"]["lab"] is None
    report, _ = analyze(pair, profile=profile, color_mode="referenced")
    assert len(report["color"]["lab"]) == 3
    assert report["independently_validated_accuracy"] is False


def test_missing_unknown_scale_and_wrong_profile_not_accepted(pair):
    profile = profile_for(pair[4])
    for scale in (None, "unknown", "unspecified", "a different reference"):
        pair[4]["scale_reference"] = scale
        with pytest.raises(ValueError, match="reference"):
            analyze(pair, profile=profile, color_mode="referenced")
    broken = copy.deepcopy(profile)
    broken["metadata"]["device"] = "another camera"
    with pytest.raises(ValueError, match="device"):
        analyze(pair, profile=broken)


def test_extrapolation_warning_saved_in_quality(pair):
    profile = profile_for(pair[4])
    profile["training_range"]["min"] = [0.5] * 3
    profile["training_range"]["max"] = [0.9] * 3
    report, _ = analyze(pair, profile=profile)
    assert report["quality"]["calibration_extrapolation"]
    assert any("extrapolation" in warning for warning in report["warnings"])


def test_null_capture_setting_never_matches_missing_metadata(pair):
    profile = profile_for(pair[4])
    profile["metadata"]["capture_settings"] = {"not_recorded": None}
    with pytest.raises(ValueError, match="capture setting"):
        check_profile(profile, pair[4], pair[4]["input_domain"])


def test_rendered_input_refuses_controlled_mode(pair, tmp_path):
    left, right = tmp_path / "a.png", tmp_path / "f.png"
    for path, value in ((left, 40), (right, 120)):
        Image.fromarray(np.full((32, 32, 3), value, dtype=np.uint8)).save(path)
    with pytest.raises(ValueError, match="JPEG/PNG"):
        analyze_pair(left, right, metadata=pair[4], alignment="none", mode="controlled")


def test_bad_roi_is_rejected_not_silently_cropped(pair):
    with pytest.raises(ValueError, match="outside"):
        analyze(pair, roi=(30, 0, 8, 8))


def test_synthetic_profile_cannot_be_passed_off_as_real_capture(pair):
    profile = profile_for(pair[4])
    profile["metadata"]["source_kind"] = "synthetic"
    pair[4]["source_kind"] = "real"
    with pytest.raises(ValueError, match="synthetic calibration"):
        analyze(pair, profile=profile)
