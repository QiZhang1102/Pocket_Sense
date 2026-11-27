"""Deterministic scene advice for an explicitly declared capture context.

Input must already be normalized linear RGB, not encoded JPEG/sRGB values or a
RAW Bayer mosaic. These image statistics do not recognize objects, materials,
medical conditions, sensor noise, or the physical cause of a bright patch.
"""

from __future__ import annotations

import numpy as np


SCENES = (
    "paper", "test_strip", "skin", "fabric", "wall", "screen", "glossy",
    "transparent", "general", "unknown",
)
_ALIASES = {
    "test strip": "test_strip", "strip": "test_strip", "teststrip": "test_strip",
    "display": "screen", "monitor": "screen", "textile": "fabric",
    "unspecified": "unknown",
}


def _local_mean(image: np.ndarray) -> np.ndarray:
    """Three-pixel square mean with edge replication, independent of OpenCV."""
    padded = np.pad(image, 1, mode="edge")
    height, width = image.shape
    total = np.zeros_like(image)
    for row in range(3):
        for column in range(3):
            total += padded[row:row + height, column:column + width]
    return total / 9.0


def assess_scene(image: np.ndarray, scene: str = "unknown") -> dict:
    """Return JSON-compatible statistics and conditional acquisition advice.

    ``scene`` is supplied by a person; it is never inferred from the image.
    ``flash_allowed=True`` only permits a conditional research trial for a
    declared reflective context. It does not certify a material, a safe capture,
    a stable flash spectrum, or accurate recovered reflectance. Unknown scenes
    do not automatically obtain flash approval. Screen, glossy and transparent
    declarations should not enter the ambient/flash subtraction workflow.

    Thresholds below are fixed prototype heuristics on [0, 1] linear samples,
    not calibrated device-dependent blur, glare, or exposure quality limits.
    The function does not alter or retain the supplied image.
    """
    if not isinstance(image, np.ndarray):
        raise ValueError("image must be a floating-point HxWx3 NumPy array of normalized linear RGB")
    if image.ndim != 3 or image.shape[2] != 3 or min(image.shape[:2]) < 1:
        raise ValueError("image must have nonempty HxWx3 dimensions")
    if not np.issubdtype(image.dtype, np.floating):
        raise ValueError("image must use floating-point normalized linear RGB samples")
    if not np.isfinite(image).all() or np.any(image < 0) or np.any(image > 1):
        raise ValueError("linear RGB samples must be finite and within [0, 1]")
    if not isinstance(scene, str):
        raise ValueError("scene must be a declared scene name")
    declared = scene.strip().lower().replace("-", "_")
    declared = _ALIASES.get(declared, declared)
    if declared not in SCENES:
        raise ValueError("unsupported scene; choose one of: " + ", ".join(SCENES))

    rgb = image.astype(np.float64, copy=False)
    luminance = rgb @ np.array([0.2126, 0.7152, 0.0722])
    high_clipping = np.any(rgb >= 0.995, axis=2)
    chroma_span = rgb.max(axis=2) - rgb.min(axis=2)
    # A local bright, nearly neutral feature can also be a printed white mark.
    # This is a candidate mask statistic, never a material/gloss classification.
    candidates = ((luminance >= 0.75) &
                  (luminance - _local_mean(luminance) >= 0.10) &
                  (chroma_span <= 0.20))
    dx = np.diff(luminance, axis=1)
    dy = np.diff(luminance, axis=0)
    count = dx.size + dy.size
    gradient_rms = float(np.sqrt((np.sum(dx * dx) + np.sum(dy * dy)) / count)) if count else 0.0
    laplacian_variance = None
    if min(luminance.shape) >= 3:
        center = luminance[1:-1, 1:-1]
        laplacian = (luminance[:-2, 1:-1] + luminance[2:, 1:-1] +
                     luminance[1:-1, :-2] + luminance[1:-1, 2:] - 4 * center)
        laplacian_variance = float(np.var(laplacian))

    warnings = [
        "Weighted RGB intensity is a diagnostic proxy, not calibrated photopic luminance for native camera channels.",
        "Scene is user-declared; no automatic object or material recognition is implemented.",
        "Image thresholds are prototype heuristics, not camera-calibrated acceptance limits.",
    ]
    suggestions = []
    conditions = []
    flags = []
    if np.any(high_clipping):
        flags.append("high_clipping")
        warnings.append("One or more channels approach the normalized upper limit; lost detail cannot be recovered by color correction.")
        suggestions.append("Reduce capture exposure and inspect individual color channels before fitting a correction.")
    if np.any(candidates):
        flags.append("local_highlight_candidates")
        warnings.append("Local bright candidates may be reflections or legitimate scene detail; they do not identify a glossy material.")
        suggestions.append("Inspect candidate bright regions and exclude contaminated reference/measurement regions or recapture at another angle.")
    if laplacian_variance is None:
        flags.append("insufficient_spatial_support")
        warnings.append("Image is too small for the interior Laplacian statistic.")
    elif laplacian_variance < 1e-5:
        flags.append("low_spatial_detail")
        warnings.append("Low high-frequency detail may indicate a smooth surface or defocus; it is not a blur diagnosis.")
        suggestions.append("Check focus against a textured edge/reference; compare at the same scale rather than assuming a uniform surface is blurred.")

    flash_allowed = declared not in {"screen", "glossy", "transparent", "unknown"}
    policy = "conditional" if flash_allowed else "avoid"
    if declared == "screen":
        warnings.append("The declared screen is emissive: added flash is reflected glare and does not isolate the display's emitted color.")
        suggestions.append("Use a separate display-measurement protocol with controlled brightness, ambient reflections and color management; do not use flash subtraction.")
    elif declared == "glossy":
        warnings.append("The declared glossy surface may produce view-dependent specular flash reflections; this workflow is not approved for it.")
        suggestions.append("Change geometry or use a separately validated diffuse/polarized acquisition protocol before attempting material-color estimation.")
    elif declared == "transparent":
        warnings.append("The declared transparent scene mixes transmission, background and reflections; a simple opaque-surface flash difference is not valid.")
        suggestions.append("Use a separately validated transmission setup with a controlled background and illumination.")
    elif declared == "unknown":
        policy = "exploratory_only"
        warnings.append("Unknown scene: flash is not automatically approved. A difference image is exploratory and cannot establish material reflectance.")
        suggestions.append("Declare the scene and inspect geometry, emissive objects and reflections before a controlled paired capture.")
    else:
        warnings.append("Flash use is conditional for the declared context; a name such as paper or wall does not prove diffuse reflectance.")
        conditions = [
            "Use a stable, non-emissive, approximately diffuse target and a compatible reference.",
            "Keep geometry, focus, exposure and white balance consistent; verify recorded capture metadata.",
            "Reject clipping, motion and contaminated reference/measurement regions.",
            "Validate the specific camera, flash, distance and illumination before interpreting corrected colors.",
        ]
        suggestions.append("Capture a controlled ambient/flash pair and inspect pair-quality checks before interpreting a correction.")
    if declared == "skin":
        warnings.append("Skin mode does not diagnose disease, estimate lesion risk or establish clinical change.")
        suggestions.append("Keep any images under the participant's control; avoid medical conclusions from this prototype.")
    if declared == "fabric":
        suggestions.append("Keep weave orientation and folds consistent; texture and specular fibers may change with viewing angle.")
    if declared == "test_strip":
        suggestions.append("Use a compatible reference chart and fixed assay timing; flash does not validate a pH or assay calibration.")

    return {
        "declared_scene": declared,
        "scene_source": "user_declared",
        "semantic_model_used": False,
        "input_space": "normalized_linear_rgb",
        "flash_allowed": flash_allowed,
        "flash_policy": policy,
        "conditions": conditions,
        "metrics": {
            "pixel_count": int(luminance.size),
            "high_clipping_fraction": float(high_clipping.mean()),
            "near_black_fraction": float((luminance <= 0.005).mean()),
            "bright_fraction": float((luminance >= 0.90).mean()),
            "local_highlight_candidate_fraction": float(candidates.mean()),
            "luminance_standard_deviation": float(luminance.std()),
            "gradient_rms": gradient_rms,
            "blur_proxy_laplacian_variance": laplacian_variance,
        },
        "flags": flags,
        "warnings": warnings,
        "suggestions": suggestions,
    }
