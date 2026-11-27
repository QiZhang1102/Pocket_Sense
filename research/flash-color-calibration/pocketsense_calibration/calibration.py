"""Auditable least-squares camera characterization, not an accuracy claim.

The root-polynomial basis follows Finlayson et al. (2015),
https://doi.org/10.1109/TIP.2015.2405336 . All input RGB must already be linear.
"""
from __future__ import annotations

import copy
from datetime import datetime
import json
from pathlib import Path
import warnings

import numpy as np

from .colorimetry import _triplets, _whitepoint, delta_e00, xyz_to_lab

SCHEMA_VERSION = 1
MAX_CONDITION = 1e8
_FEATURES = {
    "matrix3x3": ["R", "G", "B"],
    "root_polynomial": ["R", "G", "B", "sqrt(RG)", "sqrt(RB)", "sqrt(GB)"],
}
_REQUIRED_METADATA = ("device", "camera", "input_domain", "capture_settings", "target", "date", "scale_reference")


def _metadata(metadata) -> dict:
    if not isinstance(metadata, dict):
        raise ValueError("metadata must be a dictionary")
    missing = [name for name in _REQUIRED_METADATA if name not in metadata]
    if missing:
        raise ValueError("missing calibration metadata: " + ", ".join(missing))
    for name in ("device", "camera", "target", "date", "scale_reference"):
        if not isinstance(metadata[name], str) or not metadata[name].strip():
            raise ValueError(f"metadata.{name} must be a nonempty string")
    if metadata["input_domain"] not in ("linear_camera_rgb", "linear_srgb"):
        raise ValueError("metadata.input_domain must be linear_camera_rgb or linear_srgb")
    if not isinstance(metadata["capture_settings"], dict) or not metadata["capture_settings"]:
        raise ValueError("metadata.capture_settings must be a nonempty dictionary")
    try:
        datetime.fromisoformat(metadata["date"].replace("Z", "+00:00"))
        json.dumps(metadata, allow_nan=False)
    except (ValueError, TypeError) as exc:
        raise ValueError("metadata requires an ISO date and finite JSON-serializable values") from exc
    return copy.deepcopy(metadata)


def _rgb(array, name="RGB") -> np.ndarray:
    result = _triplets(array, name)
    if np.any(result < 0):
        raise ValueError(f"{name} must be nonnegative linear RGB; subtract/flag noise upstream")
    return result


def _basis(rgb: np.ndarray, method: str) -> np.ndarray:
    if method == "matrix3x3":
        return rgb
    # Product of square roots avoids overflow in R*G for large finite channels.
    roots = np.sqrt(rgb)
    cross = np.stack((roots[..., 0] * roots[..., 1], roots[..., 0] * roots[..., 2],
                      roots[..., 1] * roots[..., 2]), axis=-1)
    return np.concatenate((rgb, cross), axis=-1)


def neutral_correct(rgb, measured_neutral, reference_neutral=None) -> np.ndarray:
    """Per-channel gain baseline only; one neutral cannot characterize a camera.

    Without a reference, make the measured neutral achromatic while retaining
    its arithmetic mean intensity. No assertion of absolute XYZ scale follows.
    """
    values = _rgb(rgb)
    measured = _rgb(measured_neutral, "measured_neutral")
    if measured.shape != (3,) or np.any(measured <= 0):
        raise ValueError("measured_neutral must be one strictly positive RGB triplet")
    reference = np.repeat(measured.mean(), 3) if reference_neutral is None else _rgb(reference_neutral, "reference_neutral")
    if reference.shape != (3,) or np.any(reference <= 0):
        raise ValueError("reference_neutral must be one strictly positive RGB triplet")
    corrected = values * (reference / measured)
    if not np.isfinite(corrected).all():
        raise ValueError("neutral correction overflowed")
    return corrected


def _evaluation(predicted: np.ndarray, reference: np.ndarray, whitepoint: str) -> dict:
    _triplets(predicted, "predicted XYZ")
    errors = np.asarray(delta_e00(xyz_to_lab(predicted, whitepoint), xyz_to_lab(reference, whitepoint)))
    with np.errstate(over="ignore", invalid="ignore"):
        residual = predicted - reference
    if not np.isfinite(residual).all():
        raise ValueError("XYZ residuals overflowed; check calibration scale")
    maximum = float(np.max(np.abs(residual)))
    rmse = maximum * float(np.sqrt(np.mean((residual / maximum) ** 2))) if maximum else 0.0
    return {
        "n_samples": len(reference),
        "rmse_xyz": rmse,
        "delta_e00": {"mean": float(errors.mean()), "median": float(np.median(errors)),
                       "p95": float(np.percentile(errors, 95))},
    }


def fit_profile(rgb, xyz, *, metadata: dict, method="matrix", whitepoint="D65",
                validation_rgb=None, validation_xyz=None) -> dict:
    """Fit RGB->XYZ using an SVD least-squares solve with rank/condition guards.

    Training residuals are labelled as fit residuals. Optional validation rows
    are separate, but this API cannot verify acquisition/session independence.
    Reference XYZ is relative, Y_white=1, under the specified reference white.
    """
    method = "matrix3x3" if method == "matrix" else method
    if method not in _FEATURES:
        raise ValueError("method must be matrix (matrix3x3) or root_polynomial")
    metadata = _metadata(metadata)
    whitepoint, _ = _whitepoint(whitepoint)
    values = _rgb(rgb)
    reference = _triplets(xyz, "reference XYZ")
    if values.ndim != 2 or reference.shape != values.shape:
        raise ValueError("training RGB and reference XYZ must have matching Nx3 shape")
    if np.any(reference < 0):
        raise ValueError("reference XYZ must be nonnegative on the declared relative scale")
    design = _basis(values, method)
    terms = len(_FEATURES[method])
    if len(values) < terms:
        raise ValueError(f"{method} requires at least {terms} independent color samples")
    coefficients, _, rank, singular = np.linalg.lstsq(design, reference, rcond=None)
    condition = float(singular[0] / singular[-1]) if singular[-1] > 0 else float("inf")
    if rank < terms or not np.isfinite(condition) or condition > MAX_CONDITION:
        raise ValueError(f"rank-deficient or ill-conditioned calibration design (rank={rank}, condition={condition:.3g})")
    if np.linalg.matrix_rank(reference) < 3 or np.linalg.cond(reference) > MAX_CONDITION:
        raise ValueError("reference XYZ must span three color dimensions; a neutral target is not full calibration")
    if not np.isfinite(coefficients).all():
        raise ValueError("nonfinite fitted coefficients")
    predicted = design @ coefficients
    profile = {
        "schema_version": SCHEMA_VERSION,
        "method": method,
        "features": _FEATURES[method].copy(),
        "matrix": coefficients.tolist(),
        "orientation": "feature_row_times_matrix",
        "whitepoint": whitepoint,
        "xyz_scale": "relative_Y_white_1",
        "metadata": metadata,
        "training_range": {"min": values.min(axis=0).tolist(), "max": values.max(axis=0).tolist()},
        "condition_number": condition,
        "rank": int(rank),
        "training": {**_evaluation(predicted, reference, whitepoint),
                     "interpretation": "training fit residuals, not independent accuracy"},
        "validation": {"provided": False, "independence_verified": False,
                       "interpretation": "no held-out validation supplied"},
    }
    if (validation_rgb is None) != (validation_xyz is None):
        raise ValueError("validation_rgb and validation_xyz must be supplied together")
    if validation_rgb is not None:
        held_rgb = _rgb(validation_rgb, "validation RGB")
        held_xyz = _triplets(validation_xyz, "validation XYZ")
        if held_rgb.ndim != 2 or held_xyz.shape != held_rgb.shape or np.any(held_xyz < 0):
            raise ValueError("validation RGB/XYZ must have matching nonnegative Nx3 shape")
        train_rows = {tuple(row) for row in np.concatenate((values, reference), axis=1)}
        if any(tuple(row) in train_rows for row in np.concatenate((held_rgb, held_xyz), axis=1)):
            raise ValueError("validation contains an exact training RGB/XYZ row; use held-out captures")
        profile["validation"] = {
            "provided": True, "independence_verified": False,
            **_evaluation(_basis(held_rgb, method) @ coefficients, held_xyz, whitepoint),
            "interpretation": "provided held-out rows; acquisition independence requires external provenance",
        }
    return profile


def _validate_profile(profile: dict) -> np.ndarray:
    if not isinstance(profile, dict) or profile.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("unsupported calibration profile schema_version")
    method = profile.get("method")
    if method not in _FEATURES or profile.get("features") != _FEATURES[method]:
        raise ValueError("unsupported calibration method/features")
    if profile.get("orientation") != "feature_row_times_matrix" or profile.get("xyz_scale") != "relative_Y_white_1":
        raise ValueError("unsupported matrix orientation or XYZ scale")
    _metadata(profile.get("metadata"))
    _whitepoint(profile.get("whitepoint"))
    matrix = np.asarray(profile.get("matrix"), dtype=np.float64)
    if matrix.shape != (len(_FEATURES[method]), 3) or not np.isfinite(matrix).all():
        raise ValueError("profile matrix has invalid dimensions or nonfinite entries")
    try:
        low = _rgb(profile["training_range"]["min"], "training range minimum")
        high = _rgb(profile["training_range"]["max"], "training range maximum")
        condition = float(profile["condition_number"])
        rank = profile["rank"]
        json.dumps(profile, allow_nan=False)
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("profile requires finite training range and diagnostics") from exc
    if low.shape != (3,) or high.shape != (3,) or np.any(low > high):
        raise ValueError("invalid profile training range")
    if not 1 <= condition <= MAX_CONDITION or rank != len(_FEATURES[method]):
        raise ValueError("profile diagnostics indicate unstable calibration")
    if not isinstance(profile.get("training"), dict) or not isinstance(profile.get("validation"), dict):
        raise ValueError("profile requires training and validation diagnostics")
    validation = profile["validation"]
    if not isinstance(validation.get("provided"), bool) or validation.get("independence_verified") is not False:
        raise ValueError("profile validation must disclose unverified acquisition independence")
    evaluations = [(profile["training"], len(_FEATURES[method]))]
    if validation["provided"]:
        evaluations.append((validation, 1))
    for evaluation, minimum in evaluations:
        try:
            count = evaluation["n_samples"]
            stats = [evaluation["rmse_xyz"], *[evaluation["delta_e00"][key] for key in ("mean", "median", "p95")]]
            if not isinstance(count, int) or isinstance(count, bool) or count < minimum:
                raise ValueError("invalid diagnostic sample count")
            if any(not isinstance(value, (int, float)) or not np.isfinite(value) or value < 0 for value in stats):
                raise ValueError("invalid calibration error diagnostics")
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("profile requires finite, nonnegative calibration diagnostics") from exc
    return matrix


def apply_profile(rgb, profile) -> np.ndarray:
    """Apply a declared linear-domain profile; retain signed XYZ, never clip.

    Extrapolation emits a warning. Metadata compatibility is the caller's
    responsibility because an RGB array carries no capture/device identity.
    """
    values = _rgb(rgb)
    matrix = _validate_profile(profile)
    bounds = profile["training_range"]
    if np.any(values < np.asarray(bounds["min"]) - 1e-12) or np.any(values > np.asarray(bounds["max"]) + 1e-12):
        warnings.warn("RGB outside profile training range; extrapolation is unvalidated", RuntimeWarning, stacklevel=2)
    result = _basis(values, profile["method"]) @ matrix
    if not np.isfinite(result).all():
        raise ValueError("profile application produced nonfinite XYZ")
    return result


def save_profile(profile, path) -> None:
    _validate_profile(profile)
    Path(path).write_text(json.dumps(profile, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def load_profile(path) -> dict:
    profile = json.loads(Path(path).read_text(encoding="utf-8"))
    _validate_profile(profile)
    return profile
