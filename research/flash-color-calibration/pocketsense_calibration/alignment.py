"""Conservative global registration for static, approximately planar image pairs.

Matrices always map ambient source coordinates into flash target coordinates.
Algorithm diagnostics are heuristic checks, not independent physical validation.
"""

import cv2
import numpy as np


class AlignmentError(ValueError):
    """An invalid input or registration failure, with JSON-compatible context."""

    def __init__(self, message, report=None):
        super().__init__(message)
        self.report = dict(report or {})
        self.report.update(status="rejected", reason=str(message))


_LIMITS = {
    "minimum_matches": 24,
    "minimum_inliers": 10,
    "minimum_inlier_fraction": 0.45,
    "minimum_coverage": 0.025,
    "minimum_overlap": 0.65,
    "minimum_scale": 0.8,
    "maximum_scale": 1.25,
    "maximum_rotation_degrees": 20.0,
    "maximum_translation_fraction": 0.35,
    "maximum_heldout_median_error_px": 2.5,
    "maximum_heldout_p90_error_px": 6.0,
    "minimum_ecc_score": 0.65,
}


def _inputs(ambient, flash):
    for name, image in (("ambient", ambient), ("flash", flash)):
        if (not isinstance(image, np.ndarray) or image.ndim != 3 or
                image.shape[2] != 3 or min(image.shape[:2]) < 1):
            raise AlignmentError(f"{name} must be a nonempty HxWx3 array")
        if not np.issubdtype(image.dtype, np.floating) or not np.isfinite(image).all():
            raise AlignmentError(f"{name} must contain finite floating-point samples")
    if ambient.shape != flash.shape:
        raise AlignmentError("ambient and flash dimensions must match")


def _grey(image):
    # These are registration weights, not a calibrated luminance measurement.
    with np.errstate(over="ignore", invalid="ignore"):
        grey = np.asarray(image, dtype=np.float64) @ np.array([0.2126, 0.7152, 0.0722])
    if not np.isfinite(grey).all():
        raise AlignmentError("Registration representation overflowed; check input sample scale")
    low, high = np.percentile(grey, [1, 99])
    if not np.isfinite(high - low) or high - low <= 1e-6:
        raise AlignmentError("Insufficient texture/contrast for automatic alignment")
    normal = np.clip((grey - low) / (high - low), 0, 1).astype(np.float32)
    dx = cv2.Sobel(normal, cv2.CV_32F, 1, 0, ksize=3, scale=0.125)
    dy = cv2.Sobel(normal, cv2.CV_32F, 0, 1, ksize=3, scale=0.125)
    covariance = np.array([[np.mean(dx * dx), np.mean(dx * dy)],
                           [np.mean(dx * dy), np.mean(dy * dy)]])
    if float(np.linalg.eigvalsh(covariance)[0]) < 1e-5:
        raise AlignmentError("Insufficient two-dimensional texture for automatic alignment")
    return normal


def _coverage(points, shape):
    if len(points) < 3:
        return 0.0
    return float(cv2.contourArea(cv2.convexHull(np.asarray(points, np.float32))) /
                 (shape[0] * shape[1]))


def _geometry(matrix, shape, report):
    if matrix.shape != (3, 3) or not np.isfinite(matrix).all():
        raise AlignmentError("Registration produced an invalid matrix", report)
    linear = matrix[:2, :2]
    scales = np.linalg.svd(linear, compute_uv=False)
    rotation = float(np.degrees(np.arctan2(linear[1, 0], linear[0, 0])))
    height, width = shape[:2]
    report["geometry"] = {
        "scales": scales.tolist(), "rotation_degrees": rotation,
        "translation_px": matrix[:2, 2].tolist(),
    }
    if (np.linalg.det(linear) <= 0 or
            scales.min() < _LIMITS["minimum_scale"] or
            scales.max() > _LIMITS["maximum_scale"] or
            scales.max() / scales.min() > 1.08 or
            abs(rotation) > _LIMITS["maximum_rotation_degrees"] or
            abs(matrix[0, 2]) > width * _LIMITS["maximum_translation_fraction"] or
            abs(matrix[1, 2]) > height * _LIMITS["maximum_translation_fraction"]):
        raise AlignmentError("Registration transform exceeds conservative geometry limits", report)


def _warp(ambient, matrix, report):
    height, width = ambient.shape[:2]
    aligned = cv2.warpAffine(ambient, matrix[:2], (width, height),
                             flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
                             borderValue=0)
    support = cv2.warpAffine(np.ones((height, width), np.float32), matrix[:2],
                            (width, height), flags=cv2.INTER_LINEAR,
                            borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    # Require complete bilinear support, then exclude one additional edge pixel.
    valid = cv2.erode((support > 0.999).astype(np.uint8), np.ones((3, 3), np.uint8),
                      borderType=cv2.BORDER_CONSTANT, borderValue=0).astype(bool)
    overlap = float(valid.mean())
    report["overlap_fraction"] = overlap
    if overlap < _LIMITS["minimum_overlap"]:
        raise AlignmentError("Insufficient valid overlap after registration", report)
    return aligned, valid


def _orb(ambient_grey, flash_grey, report):
    equalizer = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    a = equalizer.apply(np.rint(ambient_grey * 255).astype(np.uint8))
    b = equalizer.apply(np.rint(flash_grey * 255).astype(np.uint8))
    detector = cv2.ORB_create(nfeatures=3000, fastThreshold=7, edgeThreshold=15)
    key_a, descriptor_a = detector.detectAndCompute(a, None)
    key_b, descriptor_b = detector.detectAndCompute(b, None)
    report["keypoints"] = {"ambient": len(key_a), "flash": len(key_b)}
    if descriptor_a is None or descriptor_b is None:
        raise AlignmentError("ORB found insufficient features", report)
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)

    def ratio_matches(first, second):
        return [pair[0] for pair in matcher.knnMatch(first, second, k=2)
                if len(pair) == 2 and pair[0].distance < 0.8 * pair[1].distance]

    reverse = {(match.trainIdx, match.queryIdx)
               for match in ratio_matches(descriptor_b, descriptor_a)}
    matches = sorted((match for match in ratio_matches(descriptor_a, descriptor_b)
                      if (match.queryIdx, match.trainIdx) in reverse),
                     key=lambda match: (match.distance, match.queryIdx))
    report["mutual_ratio_matches"] = len(matches)
    if len(matches) < _LIMITS["minimum_matches"]:
        raise AlignmentError("ORB found too few reliable correspondences", report)
    source = np.array([key_a[match.queryIdx].pt for match in matches], np.float32)
    target = np.array([key_b[match.trainIdx].pt for match in matches], np.float32)
    # Interleave the descriptor-quality ordering rather than fitting and scoring
    # on exactly the same points. These are not independent experimental images.
    held = np.arange(len(matches)) % 4 == 0
    estimate, inliers = cv2.estimateAffinePartial2D(
        source[~held], target[~held], method=cv2.RANSAC,
        ransacReprojThreshold=3.0, maxIters=4000, confidence=0.995, refineIters=15)
    if estimate is None or inliers is None:
        raise AlignmentError("ORB RANSAC could not estimate a transform", report)
    inliers = inliers.ravel().astype(bool)
    count = int(inliers.sum())
    fraction = float(inliers.mean())
    coverage = min(_coverage(source[~held][inliers], a.shape),
                   _coverage(target[~held][inliers], b.shape))
    report.update(inlier_count=count, inlier_fraction=fraction,
                  inlier_coverage_fraction=coverage)
    if (count < _LIMITS["minimum_inliers"] or
            fraction < _LIMITS["minimum_inlier_fraction"] or
            coverage < _LIMITS["minimum_coverage"]):
        raise AlignmentError("ORB correspondences lack sufficient inliers or spatial coverage", report)
    predicted = cv2.transform(source[held, None, :], estimate)[:, 0]
    errors = np.linalg.norm(predicted - target[held], axis=1)
    median, p90 = np.percentile(errors, [50, 90])
    report["heldout_reprojection"] = {
        "count": int(held.sum()), "median_px": float(median), "p90_px": float(p90),
        "independent_physical_validation": False,
    }
    if (median > _LIMITS["maximum_heldout_median_error_px"] or
            p90 > _LIMITS["maximum_heldout_p90_error_px"]):
        raise AlignmentError("ORB held-out correspondences fail reprojection checks", report)
    matrix = np.eye(3, dtype=np.float64)
    matrix[:2] = estimate
    return matrix


def _ecc(ambient_grey, flash_grey, report):
    # OpenCV ECC returns template->input sampling coordinates. Inverting it
    # gives the ambient->flash matrix used by the rest of this module.
    ambient_smooth = cv2.GaussianBlur(ambient_grey, (5, 5), 0)
    flash_smooth = cv2.GaussianBlur(flash_grey, (5, 5), 0)
    shift, response = cv2.phaseCorrelate(ambient_smooth, flash_smooth)
    initial = np.eye(2, 3, dtype=np.float32)
    if response > 0.1 and all(np.isfinite(shift)):
        initial[:, 2] = -np.asarray(shift, np.float32)
    report["phase_initialization"] = {"ambient_to_flash_shift_px": list(shift),
                                      "response": float(response)}
    try:
        score, inverse = cv2.findTransformECC(
            flash_smooth, ambient_smooth, initial, cv2.MOTION_EUCLIDEAN,
            (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 500, 1e-6),
            None, 5)
    except cv2.error as error:
        raise AlignmentError("ECC did not converge on a reliable global alignment", report) from error
    report["ecc_score"] = float(score)
    report["ecc_model"] = "euclidean"
    if not np.isfinite(score) or score < _LIMITS["minimum_ecc_score"]:
        raise AlignmentError("ECC similarity score is below the prototype threshold", report)
    matrix = np.eye(3, dtype=np.float64)
    matrix[:2] = cv2.invertAffineTransform(inverse)
    return matrix


def align_pair(ambient, flash, method="orb"):
    """Register ambient onto flash; reject uncertain automatic registration.

    ``none`` requires the caller to obtain an explicit alignment confirmation
    before controlled measurement. It verifies neither correspondence nor lack
    of motion. Numerical thresholds here are fixed prototype heuristics.
    """
    _inputs(ambient, flash)
    if method not in ("none", "orb", "ecc"):
        raise AlignmentError("method must be none, orb or ecc")
    report = {
        "method": method, "status": "accepted", "thresholds": dict(_LIMITS),
        "matrix_convention": "ambient_source_to_flash_target",
        "independent_physical_validation": False,
        "interpretation": "Algorithm diagnostics are prototype heuristics, not proof of correspondence.",
    }
    if method == "none":
        report.update(verification="unverified_manual", overlap_fraction=1.0,
                      requires_alignment_confirmation=True)
        return {"aligned": ambient.copy(),
                "valid_mask": np.ones(ambient.shape[:2], bool),
                "matrix": np.eye(3), "report": report}
    if min(ambient.shape[:2]) < 32:
        raise AlignmentError("Automatic alignment requires images at least 32 pixels per side", report)
    try:
        a, b = _grey(ambient), _grey(flash)
        matrix = _orb(a, b, report) if method == "orb" else _ecc(a, b, report)
        _geometry(matrix, ambient.shape, report)
        aligned, valid = _warp(ambient, matrix, report)
    except AlignmentError as error:
        if "method" not in error.report:
            error.report.update(report)
            error.report["status"] = "rejected"
        raise
    except cv2.error as error:
        raise AlignmentError("OpenCV could not align this image pair", report) from error
    report["verification"] = "algorithm_checks_only"
    return {"aligned": aligned, "valid_mask": valid, "matrix": matrix, "report": report}
