"""Synthetic mathematical checks, not experimental camera validation."""
import copy
import json

import numpy as np
import pytest

from pocketsense_calibration.calibration import (
    apply_profile, fit_profile, load_profile, neutral_correct, save_profile,
)
from pocketsense_calibration.colorimetry import (
    WHITEPOINTS, chromaticity, delta_e00, linear_srgb_to_xyz, linear_to_srgb,
    srgb_to_linear, xyz_to_lab,
)


@pytest.fixture
def metadata():
    return {"device": "synthetic-device", "camera": "synthetic-camera",
            "input_domain": "linear_camera_rgb", "capture_settings": {"iso": 100, "exposure_s": 0.01},
            "target": "synthetic independent color vectors", "date": "2026-11-26",
            "scale_reference": "synthetic relative XYZ; reference white Y=1"}


@pytest.fixture
def colors():
    rng = np.random.default_rng(814)
    rgb = rng.uniform(0.05, 0.9, (40, 3))
    rgb[0], rgb[1] = [0.01, 0.02, 0.03], [0.95, 0.94, 0.96]
    return rgb


def test_transfer_round_trip_and_known_primary_white():
    encoded = np.array([[0, 0.04045, 1], [-0.3, 0.5, 1.2]])
    np.testing.assert_allclose(linear_to_srgb(srgb_to_linear(encoded)), encoded, atol=3e-8)
    assert srgb_to_linear([0.5, 0.5, 0.5])[0] == pytest.approx(0.21404114048223255)
    np.testing.assert_allclose(linear_srgb_to_xyz([1, 1, 1]), WHITEPOINTS["D65"], atol=1e-14)
    np.testing.assert_allclose(linear_srgb_to_xyz([1, 0, 0]), [0.4123907993, 0.2126390059, 0.0193308187], atol=1e-10)
    assert linear_to_srgb([2, 0, 0])[0] > 1  # no hidden gamut clipping


def test_lab_reference_white_and_chromaticity_scaling():
    for white in ("D50", "D65"):
        np.testing.assert_allclose(xyz_to_lab(WHITEPOINTS[white], white), [100, 0, 0], atol=1e-12)
    assert abs(xyz_to_lab(WHITEPOINTS["D65"], "D50")[2]) > 10  # no implicit adaptation
    xyz = np.array([[0.2, 0.3, 0.4], [0.8, 0.7, 0.2]])
    np.testing.assert_allclose(chromaticity(xyz * 4.2), chromaticity(xyz))
    np.testing.assert_allclose(chromaticity(WHITEPOINTS["D65"]), [0.3127, 0.3290])
    with pytest.raises(ValueError, match="undefined"):
        chromaticity([0, 0, 0])


@pytest.mark.parametrize("first,second,expected", [
    ([50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425),
    ([50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615),
    ([50, 2.8361, -74.0200], [50, 0, -82.7485], 3.4412),
    ([50, 0, 0], [50, -1, 2], 2.3669),
    ([50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792),
    ([50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195),
    ([50, -0.001, 2.49], [50, 0.0011, -2.49], 4.7461),
    ([2.0776, 0.0795, -1.1350], [0.9033, -0.0636, -0.5514], 0.9082),
])
def test_ciede2000_published_sharma_wu_dalal_pairs(first, second, expected):
    # Numerical reference data published by the authors (2005):
    # https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt
    assert float(delta_e00(first, second)) == pytest.approx(expected, abs=5e-5)
    assert float(delta_e00(second, first)) == pytest.approx(expected, abs=5e-5)


def test_matrix_recovery_separates_training_from_validation(metadata, colors, tmp_path):
    train, held = colors[:30], colors[30:]
    profile = fit_profile(train, linear_srgb_to_xyz(train), metadata=metadata,
                          validation_rgb=held, validation_xyz=linear_srgb_to_xyz(held))
    np.testing.assert_allclose(apply_profile(held, profile), linear_srgb_to_xyz(held), atol=1e-14)
    assert profile["method"] == "matrix3x3"
    assert profile["training"]["n_samples"] == 30
    assert "not independent accuracy" in profile["training"]["interpretation"]
    assert profile["validation"]["n_samples"] == 10
    assert profile["validation"]["independence_verified"] is False
    metadata["capture_settings"]["iso"] = 999
    assert profile["metadata"]["capture_settings"]["iso"] == 100
    destination = tmp_path / "profile.json"
    save_profile(profile, destination)
    assert load_profile(destination) == profile


def test_root_polynomial_recovers_nonlinearity_and_is_exposure_homogeneous(metadata, colors):
    def known_mapping(rgb):
        r, g, b = rgb.T
        return np.column_stack((0.7*r + 0.1*g + 0.2*np.sqrt(r*b),
                                0.15*r + 0.6*g + 0.25*np.sqrt(r*g),
                                0.1*g + 0.65*b + 0.25*np.sqrt(g*b)))
    profile = fit_profile(colors[:30], known_mapping(colors[:30]), metadata=metadata, method="root_polynomial")
    np.testing.assert_allclose(apply_profile(colors[30:], profile), known_mapping(colors[30:]), atol=2e-14)
    base = np.array([[0.3, 0.4, 0.2], [0.5, 0.25, 0.6]])
    for factor in (0.5, 1.2):
        np.testing.assert_allclose(apply_profile(base * factor, profile), apply_profile(base, profile) * factor, atol=2e-14)
    matrix = fit_profile(colors[:30], known_mapping(colors[:30]), metadata=metadata)
    assert matrix["training"]["rmse_xyz"] > 1e-3


def test_one_neutral_is_only_a_gain_baseline(metadata):
    measured = np.array([0.2, 0.4, 0.6])
    np.testing.assert_allclose(neutral_correct(measured, measured), [0.4, 0.4, 0.4])
    np.testing.assert_allclose(neutral_correct(measured * 2, measured, [0.3, 0.3, 0.3]), [0.6, 0.6, 0.6])
    with pytest.raises(ValueError, match="strictly positive"):
        neutral_correct([1, 1, 1], [0, 0.4, 0.6])
    neutrals = np.array([[0.1, 0.1, 0.1], [0.3, 0.3, 0.3], [0.6, 0.6, 0.6]])
    with pytest.raises(ValueError, match="rank-deficient"):
        fit_profile(neutrals, linear_srgb_to_xyz(neutrals), metadata=metadata)


def test_noisy_neutral_camera_rgb_is_still_not_full_color_target(metadata, colors):
    with pytest.raises(ValueError, match="neutral target is not full calibration"):
        fit_profile(colors, np.outer(np.linspace(0.1, 0.9, len(colors)), WHITEPOINTS["D65"]), metadata=metadata)


def test_nonfinite_and_overflowing_color_values_are_rejected():
    with pytest.raises(ValueError, match="finite"):
        srgb_to_linear([1e308, 1e308, 1e308])
    with pytest.raises(ValueError, match="finite"):
        delta_e00([1e200, 1e200, 1e200], [0, 0, 0])
    np.testing.assert_allclose(chromaticity([1e308, 1e308, 1e308]), [1/3, 1/3])


@pytest.mark.parametrize("method", ["matrix", "root_polynomial"])
def test_rejects_ill_conditioned_or_rank_deficient_charts(metadata, method):
    with pytest.raises(ValueError, match="rank-deficient|independent"):
        fit_profile(np.ones((12, 3)), np.ones((12, 3)), metadata=metadata, method=method)
    if method == "matrix":
        bad = np.diag([1.0, 1e-10, 1e-10])
        with pytest.raises(ValueError, match="ill-conditioned"):
            fit_profile(bad, bad, metadata=metadata)


@pytest.mark.parametrize("field", ["device", "camera", "input_domain", "capture_settings", "target", "date", "scale_reference"])
def test_metadata_is_required(metadata, colors, field):
    metadata.pop(field)
    with pytest.raises(ValueError, match="missing calibration metadata"):
        fit_profile(colors, linear_srgb_to_xyz(colors), metadata=metadata)


@pytest.mark.parametrize("bad", [np.nan, np.inf, -0.01])
def test_invalid_rgb_is_rejected(metadata, colors, bad):
    colors[0, 0] = bad
    with pytest.raises(ValueError, match="finite|nonnegative"):
        fit_profile(colors, np.ones_like(colors), metadata=metadata)


def test_validation_cannot_reuse_training_rows_or_one_half(metadata, colors):
    xyz = linear_srgb_to_xyz(colors)
    with pytest.raises(ValueError, match="exact training"):
        fit_profile(colors, xyz, metadata=metadata, validation_rgb=colors[:3], validation_xyz=xyz[:3])
    with pytest.raises(ValueError, match="together"):
        fit_profile(colors, xyz, metadata=metadata, validation_rgb=colors[:3])


def test_apply_warns_on_extrapolation_and_does_not_clip(metadata):
    rgb = np.array([[0.8, 0.1, 0.2], [0.9, 0.15, 0.3], [0.75, 0.02, 0.8], [0.85, 0.05, 0.5]])
    transform = np.array([[1.0, 0, 0], [-0.5, 1, 0], [0, 0, 1]])
    profile = fit_profile(rgb, rgb @ transform, metadata=metadata)
    with pytest.warns(RuntimeWarning, match="extrapolation"):
        result = apply_profile([0, 1, 0.2], profile)
    assert result[0] == pytest.approx(-0.5)
    with pytest.raises(ValueError, match="nonnegative"):
        apply_profile([-0.1, 0.5, 0.2], profile)


@pytest.mark.parametrize("change", ["schema", "matrix", "metadata", "range"])
def test_load_rejects_tampered_profile(metadata, colors, tmp_path, change):
    profile = fit_profile(colors, linear_srgb_to_xyz(colors), metadata=metadata)
    tampered = copy.deepcopy(profile)
    if change == "schema":
        tampered["schema_version"] = 999
    elif change == "matrix":
        tampered["matrix"] = [[1, 2, 3]]
    elif change == "metadata":
        tampered["metadata"].pop("scale_reference")
    else:
        tampered["training_range"] = {"min": [1, 1, 1], "max": [0, 0, 0]}
    path = tmp_path / "bad.json"
    path.write_text(json.dumps(tampered), encoding="utf-8")
    with pytest.raises(ValueError):
        load_profile(path)
