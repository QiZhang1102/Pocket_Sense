"""Global-registration behavior on known synthetic geometry, not phone accuracy."""

import json

import cv2
import numpy as np
import pytest

from pocketsense_calibration.alignment import AlignmentError, align_pair


def _textured(seed=14, side=256):
    rng = np.random.default_rng(seed)
    base = np.zeros((side, side), np.float32) + 0.12
    for _ in range(150):
        x, y = rng.integers(12, side - 12, 2)
        radius = int(rng.integers(2, 7))
        cv2.circle(base, (int(x), int(y)), radius, float(rng.uniform(0.25, 0.8)), -1)
    cv2.putText(base, "COLOR 42", (26, 120), cv2.FONT_HERSHEY_SIMPLEX,
                0.65, 0.9, 2, cv2.LINE_AA)
    base += rng.uniform(0, 0.035, base.shape).astype(np.float32)
    return np.stack((base, base * 0.8 + 0.04, base * 0.65 + 0.09), axis=-1)


def _transformed(image, matrix):
    return cv2.warpAffine(image, np.asarray(matrix[:2], np.float32),
                          (image.shape[1], image.shape[0]),
                          flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)


@pytest.mark.parametrize("method", ["orb", "ecc"])
def test_translation_has_source_to_target_sign_and_conservative_mask(method):
    ambient = _textured()
    expected = np.array([[1., 0., 7.], [0., 1., -5.], [0., 0., 1.]])
    flash = _transformed(ambient, expected) * 1.12 + 0.025
    original = ambient.copy()
    result = align_pair(ambient, flash, method)
    np.testing.assert_allclose(result["matrix"], expected, atol=0.35)
    np.testing.assert_array_equal(ambient, original)
    mask = result["valid_mask"]
    assert mask.dtype == bool and mask.shape == ambient.shape[:2]
    assert not mask[:, :8].any()
    assert not mask[-6:, :].any()
    assert not mask[0, :].any() and not mask[:, -1].any()
    assert mask[30:-30, 30:-30].all()
    assert np.mean(np.abs(result["aligned"][mask] * 1.12 + 0.025 - flash[mask])) < 0.012
    assert result["report"]["matrix_convention"] == "ambient_source_to_flash_target"
    assert result["report"]["independent_physical_validation"] is False
    json.dumps(result["report"], allow_nan=False)


@pytest.mark.parametrize("method", ["orb", "ecc"])
def test_rotation_recovers_known_global_geometry(method):
    ambient = _textured(seed=19)
    expected = np.eye(3)
    expected[:2] = cv2.getRotationMatrix2D((128, 128), 3.0, 1.0)
    flash = _transformed(ambient, expected) * 1.07 + 0.02
    result = align_pair(ambient, flash, method)
    points = np.array([[30., 30., 1.], [220., 30., 1.], [30., 220., 1.], [220., 220., 1.]])
    residual = points @ result["matrix"].T - points @ expected.T
    assert np.max(np.linalg.norm(residual[:, :2], axis=1)) < 0.7
    assert result["valid_mask"].mean() > 0.8


@pytest.mark.parametrize("method", ["orb", "ecc"])
def test_flat_or_one_dimensional_images_are_not_silently_accepted(method):
    for base in (np.full((80, 80, 3), 0.4),
                 np.repeat(np.tile(np.linspace(0.1, 0.8, 80), (80, 1))[..., None], 3, axis=2)):
        with pytest.raises(AlignmentError, match="texture") as exc:
            align_pair(base, base + 0.05, method)
        assert exc.value.report["status"] == "rejected"
        assert exc.value.report["method"] == method


def test_manual_identity_is_explicitly_unverified_and_independent_copy():
    ambient = np.full((4, 5, 3), 0.2)
    result = align_pair(ambient, ambient + 0.3, "none")
    np.testing.assert_array_equal(result["aligned"], ambient)
    np.testing.assert_array_equal(result["matrix"], np.eye(3))
    assert result["valid_mask"].all()
    assert result["report"]["verification"] == "unverified_manual"
    assert result["report"]["requires_alignment_confirmation"] is True
    result["aligned"][0, 0] = 0
    assert ambient[0, 0, 0] == 0.2


@pytest.mark.parametrize("bad", [np.ones((32, 32)), np.ones((32, 32, 4)),
                                  np.ones((32, 32, 3), dtype=np.uint8),
                                  np.full((32, 32, 3), np.nan)])
def test_invalid_inputs_are_rejected(bad):
    with pytest.raises(AlignmentError):
        align_pair(bad, np.ones((32, 32, 3)), "none")


def test_dimensions_unknown_method_and_small_automatic_input_are_rejected():
    with pytest.raises(AlignmentError, match="dimensions"):
        align_pair(np.ones((32, 32, 3)), np.ones((33, 32, 3)))
    with pytest.raises(AlignmentError, match="method"):
        align_pair(np.ones((32, 32, 3)), np.ones((32, 32, 3)), "optical_flow")
    with pytest.raises(AlignmentError, match="32 pixels"):
        align_pair(np.ones((16, 16, 3)), np.ones((16, 16, 3)), "ecc")


@pytest.mark.parametrize("method", ["orb", "ecc"])
def test_unrelated_texture_pair_is_rejected_instead_of_returning_a_plausible_warp(method):
    with pytest.raises(AlignmentError):
        align_pair(_textured(seed=2), _textured(seed=99), method)


def test_large_rotation_is_rejected_even_if_orb_finds_correspondences():
    ambient = _textured()
    transform = cv2.getRotationMatrix2D((128, 128), 35, 1.0)
    with pytest.raises(AlignmentError, match="geometry limits"):
        align_pair(ambient, _transformed(ambient, transform), "orb")


def test_orb_report_scores_matches_held_out_from_ransac_fit():
    ambient = _textured()
    result = align_pair(ambient, _transformed(ambient, np.array([[1., 0., 4.], [0., 1., 3.]])), "orb")
    held = result["report"]["heldout_reprojection"]
    assert held["count"] >= 6
    assert held["median_px"] < 1
    assert held["independent_physical_validation"] is False
