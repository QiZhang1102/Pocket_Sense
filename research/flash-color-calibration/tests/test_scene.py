"""Rule behavior and numerical boundaries, with synthetic linear-RGB fixtures."""

import json

import numpy as np
import pytest

from pocketsense_calibration.scene import assess_scene


def test_screen_is_not_approved_even_when_it_looks_like_paper():
    image = np.full((16, 16, 3), 0.6)
    screen = assess_scene(image, "screen")
    paper = assess_scene(image, "paper")
    assert screen["flash_allowed"] is False
    assert screen["flash_policy"] == "avoid"
    assert any("emissive" in warning for warning in screen["warnings"])
    assert paper["flash_allowed"] is True
    assert paper["flash_policy"] == "conditional"
    assert paper["conditions"]
    assert screen["metrics"] == paper["metrics"]
    assert paper["scene_source"] == "user_declared"
    assert paper["semantic_model_used"] is False


@pytest.mark.parametrize("scene", ["paper", "test_strip", "skin", "fabric", "wall", "general"])
def test_reflective_declarations_only_allow_conditional_trials(scene):
    result = assess_scene(np.full((8, 8, 3), 0.4), scene)
    assert result["flash_allowed"] is True
    assert result["flash_policy"] == "conditional"
    assert any("conditional" in text for text in result["warnings"])
    assert result["conditions"]


@pytest.mark.parametrize("scene", ["glossy", "transparent", "unknown"])
def test_uncertain_or_unsuitable_contexts_do_not_gain_approval(scene):
    result = assess_scene(np.full((8, 8, 3), 0.4), scene)
    assert result["flash_allowed"] is False
    assert result["flash_policy"] == ("exploratory_only" if scene == "unknown" else "avoid")


def test_default_is_unknown_and_skin_has_no_clinical_claim():
    image = np.full((8, 8, 3), 0.4)
    assert assess_scene(image)["declared_scene"] == "unknown"
    skin = assess_scene(image, "skin")
    assert any("does not diagnose" in text for text in skin["warnings"])


def test_clipped_channel_and_local_bright_candidate_are_separate_metrics():
    image = np.full((9, 9, 3), 0.2)
    image[4, 4] = 1.0
    image[0, 0] = [1.0, 0.2, 0.2]
    original = image.copy()
    result = assess_scene(image, "general")
    metrics = result["metrics"]
    assert metrics["high_clipping_fraction"] == pytest.approx(2 / 81)
    assert metrics["local_highlight_candidate_fraction"] == pytest.approx(1 / 81)
    assert "local_highlight_candidates" in result["flags"]
    assert any("do not identify" in text for text in result["warnings"])
    np.testing.assert_array_equal(image, original)


def test_texture_metrics_distinguish_fixture_detail_without_classifying_blur():
    smooth = np.full((12, 12, 3), 0.4)
    grid = ((np.indices((12, 12)).sum(axis=0) % 2) * 0.6 + 0.1)
    detailed = np.repeat(grid[..., None], 3, axis=2)
    a = assess_scene(smooth)
    b = assess_scene(detailed)
    assert a["metrics"]["gradient_rms"] == 0
    assert b["metrics"]["gradient_rms"] > a["metrics"]["gradient_rms"]
    # Laplacian variance alone is not a universal focus score (a checkerboard
    # and a smooth surface both need contextual interpretation).
    assert "low_spatial_detail" in a["flags"]
    assert any("not a blur diagnosis" in text for text in a["warnings"])


def test_small_image_is_json_serializable_with_missing_blur_proxy():
    result = assess_scene(np.zeros((1, 1, 3), dtype=np.float32))
    assert result["metrics"]["blur_proxy_laplacian_variance"] is None
    assert result["metrics"]["near_black_fraction"] == 1.0
    assert "insufficient_spatial_support" in result["flags"]
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize("scene", ["test-strip", "test strip", "strip"])
def test_declared_aliases(scene):
    assert assess_scene(np.zeros((3, 3, 3)), scene)["declared_scene"] == "test_strip"


@pytest.mark.parametrize("image", [
    [[0.0, 0.0, 0.0]], np.zeros((0, 3, 3)), np.zeros((3, 3)),
    np.zeros((3, 3, 4)), np.zeros((3, 3, 3), dtype=np.uint8),
    np.full((3, 3, 3), np.nan), np.full((3, 3, 3), np.inf),
    np.full((3, 3, 3), -0.01), np.full((3, 3, 3), 1.01),
])
def test_invalid_image_contract_is_rejected(image):
    with pytest.raises(ValueError):
        assess_scene(image)


@pytest.mark.parametrize("scene", ["automatic", "skin-cancer", None])
def test_unknown_mode_names_are_not_silently_reinterpreted(scene):
    with pytest.raises(ValueError):
        assess_scene(np.zeros((3, 3, 3)), scene)
