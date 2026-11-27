"""Conservative paired-image experiment. All thresholds are pilot heuristics."""
from time import perf_counter
import warnings as python_warnings
import platform
from importlib.metadata import version

import cv2
import numpy as np

from .alignment import align_pair
from .calibration import apply_profile
from .colorimetry import chromaticity, xyz_to_lab
from .images import load_image
from .scene import assess_scene


def _same(left, right):
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return bool(np.isclose(left, right, rtol=1e-6, atol=0))
    return left == right


def validate_capture(metadata, controlled=False):
    if not isinstance(metadata, dict) or metadata.get("schema_version", 1) != 1:
        raise ValueError("Expected a version-1 pair metadata object.")
    warnings = []
    ambient, flash = metadata.get("ambient", {}), metadata.get("flash", {})
    if not isinstance(ambient, dict) or not isinstance(flash, dict):
        raise ValueError("ambient and flash settings must be objects.")
    for key in ("exposure_s", "iso", "aperture", "white_balance", "focus_distance_m"):
        left, right = ambient.get(key), flash.get(key)
        if key in {"exposure_s", "iso", "aperture", "focus_distance_m"}:
            for value in (left, right):
                if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))
                                          or not np.isfinite(value) or value <= 0):
                    raise ValueError(f"Invalid capture setting {key}.")
        if left is not None and right is not None and not _same(left, right):
            raise ValueError(f"Mismatched {key}; exposure rescaling is not an accepted substitute for a controlled pair.")
        if key != "focus_distance_m" and (left is None or right is None):
            if controlled:
                raise ValueError(f"Controlled mode requires both {key} values.")
            warnings.append(f"Unknown {key}; additivity cannot be established from these files.")
    if controlled:
        for key in ("device", "camera"):
            if not isinstance(metadata.get(key), str) or not metadata[key].strip():
                raise ValueError(f"Controlled mode requires {key}.")
        if ambient.get("flash") is not False or flash.get("flash") is not True:
            raise ValueError("Declare ambient.flash=false and flash.flash=true for controlled capture.")
        if flash.get("white_balance") not in {"locked", "manual", "raw_not_applied"}:
            raise ValueError("Controlled input requires locked/manual WB or unprocessed RAW WB.")
        for key in ("ambient_stable", "geometry_locked"):
            if metadata.get(key) is not True:
                raise ValueError(f"Controlled capture requires explicit {key}=true.")
    else:
        warnings.append("Exploratory subtraction does not establish physical linearity, exposure control or color accuracy.")
    return warnings


def _roi_mask(shape, roi):
    height, width = shape
    if roi is None:
        roi = (0, 0, width, height)
    if len(roi) != 4 or any(isinstance(v, bool) or not isinstance(v, int) for v in roi):
        raise ValueError("ROI must contain integer x,y,width,height in analysis-image coordinates.")
    x, y, w, h = roi
    if min(x, y) < 0 or min(w, h) < 1 or x + w > width or y + h > height:
        raise ValueError("ROI is outside the flash image; RAW coordinates are half-resolution sensor coordinates.")
    mask = np.zeros(shape, dtype=bool)
    mask[y:y + h, x:x + w] = True
    return mask, list(roi)


def _motion_candidates(ambient, flash):
    """Conflicting strong edge directions; candidates can also be flash shadows."""
    gradients = []
    for image in (ambient, flash):
        gray = np.mean(image, axis=-1).astype(np.float32)
        gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        gradients.append((gx, gy, np.sqrt(gx * gx + gy * gy)))
    ax, ay, am = gradients[0]
    fx, fy, fm = gradients[1]
    cosine = (ax * fx + ay * fy) / (am * fm + 1e-12)
    strong = (am > max(0.015, float(np.quantile(am, 0.7)))) & (fm > max(0.015, float(np.quantile(fm, 0.7))))
    candidates = strong & (cosine < 0.3)
    return cv2.dilate(candidates.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)


def _noise_sigma(metadata):
    left, right = metadata.get("noise_sigma_ambient"), metadata.get("noise_sigma_flash")
    if left is None and right is None:
        return None
    if left is None or right is None:
        raise ValueError("Supply both normalized per-channel noise sigma arrays, or neither.")
    left, right = np.asarray(left, dtype=float), np.asarray(right, dtype=float)
    if left.shape != (3,) or right.shape != (3,) or not np.isfinite([left, right]).all() or np.any(left <= 0) or np.any(right <= 0):
        raise ValueError("Noise sigma must be three finite positive values in normalized linear units.")
    return np.sqrt(left ** 2 + right ** 2)


def check_profile(profile, metadata, domain, referenced=False):
    details = profile.get("metadata", {})
    if details.get("source_kind") == "synthetic" and metadata.get("source_kind") != "synthetic":
        raise ValueError("A synthetic calibration profile must not be used for a non-synthetic capture.")
    for key, value in (("device", metadata.get("device")), ("camera", metadata.get("camera")), ("input_domain", domain)):
        if value is None or details.get(key) != value:
            raise ValueError(f"Calibration profile {key} does not match this pair.")
    for key, value in details.get("capture_settings", {}).items():
        if value is None or key not in metadata.get("flash", {}) or not _same(metadata["flash"][key], value):
            raise ValueError(f"Calibration profile capture setting {key} does not match the flash frame.")
    if referenced:
        scale = metadata.get("scale_reference")
        if not isinstance(scale, str) or len(scale.strip()) < 8 or scale.strip().lower() in {"unknown", "unspecified", "none", "unverified"}:
            raise ValueError("Referenced color requires a specific, documented intensity normalization reference.")
        if scale != details.get("scale_reference") or metadata.get("geometry_locked") is not True:
            raise ValueError("Referenced color requires the same declared scale reference and locked geometry as calibration.")


def analyze_pair(ambient_path, flash_path, *, metadata=None, alignment="orb", roi=None,
                 mode="exploratory", profile=None, color_mode="chromaticity"):
    started = perf_counter()
    if mode not in {"exploratory", "controlled"} or color_mode not in {"chromaticity", "referenced"}:
        raise ValueError("Unknown processing or color output mode.")
    metadata = metadata or {}
    warnings = validate_capture(metadata, controlled=mode == "controlled")
    ambient = load_image(ambient_path, metadata)
    flash = load_image(flash_path, metadata)
    if ambient.domain != flash.domain or ambient.rgb.shape != flash.rgb.shape or ambient.linear_source != flash.linear_source:
        raise ValueError("Pair dimensions, input domains and processing paths must match.")
    if mode == "controlled" and not (ambient.linear_source and flash.linear_source):
        raise ValueError("JPEG/PNG cannot enter controlled quantitative processing; use RAW or documented linear NPY.")
    if mode == "controlled" and str(ambient_path).lower().endswith(".npy") and metadata.get("linear_confirmed") is not True:
        raise ValueError("Controlled NPY input requires linear_confirmed=true in its provenance metadata.")
    for key in ("cfa_pattern", "black_levels", "white_levels", "sensor_orientation_code"):
        if ambient.info.get(key) != flash.info.get(key):
            raise ValueError(f"RAW pair {key} metadata differs; this normalization path has not been validated.")
    scene = assess_scene(np.clip(flash.rgb, 0, 1), metadata.get("scene", "unknown"))
    if scene["declared_scene"] in {"screen", "glossy", "transparent"} or (mode == "controlled" and not scene["flash_allowed"]):
        raise ValueError("The declared scene does not support this flash subtraction mode; inspect the scene command's advice.")
    warnings.extend(scene["warnings"])
    if alignment == "none" and mode == "controlled" and metadata.get("alignment_confirmed") is not True:
        raise ValueError("Skipping automatic alignment requires alignment_confirmed=true for controlled capture.")
    registration = align_pair(ambient.rgb, flash.rgb, alignment)
    aligned = registration["aligned"]
    height, width = flash.rgb.shape[:2]
    def warp_mask(mask):
        return cv2.warpPerspective(mask.astype(np.float32), registration["matrix"], (width, height),
                                   flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT) > 0.999
    overlap = registration["valid_mask"]
    sensor_valid = warp_mask(ambient.valid) & flash.valid & overlap
    saturated = ~warp_mask(~ambient.saturated) | flash.saturated
    difference = flash.rgb - aligned  # Retain the signed floating-point result.
    sigma = _noise_sigma(metadata)
    negative_limit = sigma * 3 if sigma is not None else np.full(3, 0.003)
    negative = np.any(difference < -negative_limit, axis=-1)
    negative_any = np.any(difference < 0, axis=-1)
    brightness = np.mean(difference, axis=-1)
    sigma_mean = float(np.sqrt(np.sum(sigma ** 2)) / 3) if sigma is not None else None
    low_signal = (brightness < max(0.003, 3 * sigma_mean if sigma_mean else 0)) | (np.mean(flash.rgb, axis=-1) < 0.005)
    motion = _motion_candidates(aligned, flash.rgb)
    valid = sensor_valid & ~negative & ~low_signal & ~motion
    selected, roi = _roi_mask((height, width), roi)
    count = int(np.sum(selected))
    selected_valid = selected & valid
    valid_count = int(np.sum(selected_valid))
    accepted = valid_count >= 16 and valid_count / count >= 0.5
    def fraction(mask):
        return float(np.mean(mask[selected]))
    highpass = brightness - cv2.GaussianBlur(brightness, (3, 3), 0)
    signal_values = brightness[selected_valid]
    spatial_cv = float(np.std(signal_values) / np.mean(signal_values)) if valid_count else None
    quality = {
        "alignment": registration["report"], "geometric_overlap_fraction": fraction(overlap),
        "saturation_fraction": fraction(saturated & overlap), "negative_difference_fraction": fraction(negative_any & overlap),
        "clipped_or_boundary_candidate_fraction": fraction((saturated | np.any(aligned <= 0, axis=-1) | np.any(flash.rgb <= 0, axis=-1)) & overlap),
        "negative_excluded_fraction": fraction(negative & overlap), "low_signal_fraction": fraction(low_signal & overlap),
        "motion_or_shadow_candidate_fraction": fraction(motion & overlap), "valid_fraction": valid_count / count,
        "valid_pixels": valid_count, "roi_pixels": count,
        "flash_fraction_median": float(np.median(brightness[selected_valid] / np.maximum(np.mean(flash.rgb, axis=-1)[selected_valid], 1e-9))) if valid_count else None,
        "subtraction_snr_estimate": float(np.median(signal_values) / sigma_mean) if sigma_mean and valid_count else None,
        "snr_assumptions": "provided independent per-channel sigma; ignores interpolation and sensor spatial correlations" if sigma is not None else "unavailable: no noise model or repeated captures supplied",
        "high_frequency_variation_proxy": float(1.4826 * np.median(np.abs(highpass[selected_valid] - np.median(highpass[selected_valid])))) if valid_count else None,
        "spatial_signal_cv": spatial_cv,
        "spatial_interpretation": "variation on user-declared uniform reference" if metadata.get("uniform_reference") is True else "material, texture, geometry and illumination are confounded; not illumination uniformity",
        "threshold_policy": {"minimum_valid_pixels": 16, "minimum_valid_fraction": 0.5, "minimum_signal": 0.003,
                             "negative_tolerance": negative_limit.tolist(), "status": "unvalidated conservative pilot heuristics"},
    }
    if sigma is None:
        warnings.append("No physical SNR is inferred from a single textured image; high-frequency variation is only a diagnostic proxy.")
    if not accepted:
        warnings.append("Rejected ROI: too few usable pixels; invalid pixels do not enter color statistics.")
    color = {"domain": ambient.domain, "linear_difference_rgb_mean": None, "linear_difference_rgb_median": None,
             "xy": None, "xyz_relative": None, "lab": None, "whitepoint": None}
    if color_mode == "referenced" and (profile is None or mode != "controlled"):
        raise ValueError("Referenced color requires a calibration profile and controlled linear capture.")
    if profile is not None:
        check_profile(profile, metadata, ambient.domain, color_mode == "referenced")
    if accepted:
        rgb = np.mean(difference[selected_valid], axis=0)
        color["linear_difference_rgb_mean"] = rgb.tolist()
        color["linear_difference_rgb_median"] = np.median(difference[selected_valid], axis=0).tolist()
        if np.any(rgb < 0):
            warnings.append("A mean channel is negative; calibrated color has been withheld without clipping the measurement.")
        elif profile is not None:
            with python_warnings.catch_warnings(record=True) as profile_warnings:
                python_warnings.simplefilter("always", RuntimeWarning)
                xyz = np.asarray(apply_profile(rgb[None, :], profile))[0]
            warnings.extend(str(item.message) for item in profile_warnings)
            quality["calibration_extrapolation"] = bool(profile_warnings)
            if np.any(xyz < 0) or not np.isfinite(xyz).all() or xyz.sum() <= 0:
                warnings.append("Calibrated XYZ is nonphysical; no chromaticity or Lab is reported.")
            else:
                color["xy"] = np.asarray(chromaticity(xyz)).tolist()
                color["whitepoint"] = profile["whitepoint"]
                if color_mode == "referenced":
                    color["xyz_relative"] = xyz.tolist()
                    color["lab"] = np.asarray(xyz_to_lab(xyz, profile["whitepoint"])).tolist()
                    warnings.append("Referenced Lab relies on the operator's matching intensity-scale assertion, not independent experimental verification.")
        else:
            warnings.append("No calibrated device RGB-to-XYZ mapping supplied: reporting camera signal only, not standard color.")
    warnings.append("Flash-induced camera signal is not object reflectance or universally accurate color.")
    report = {"schema_version": 1, "experimental": True, "independently_validated_accuracy": False,
              "source_kind": metadata.get("source_kind", "unverified_capture"), "accepted": accepted,
              "mode": mode, "color_mode": color_mode, "roi": roi,
              "inputs": {"ambient": ambient.info, "flash": flash.info},
              "capture_assertions": metadata, "scene": scene, "quality": quality, "color": color,
              "calibration_profile": profile,
              "runtime": {"python": platform.python_version(), "numpy": np.__version__, "opencv": cv2.__version__,
                          "scikit_image": version("scikit-image"), "rawpy": "optional; see input decoder",
                          "prototype_version": "0.1.0"},
              "warnings": list(dict.fromkeys(warnings)), "processing_ms": (perf_counter() - started) * 1000}
    arrays = {"ambient": ambient.rgb, "ambient_aligned": aligned, "flash": flash.rgb,
              "signed_difference": difference, "valid_mask": valid, "roi_mask": selected,
              "overlap_mask": overlap, "saturation_mask": saturated, "negative_excluded_mask": negative,
              "low_signal_mask": low_signal, "motion_or_shadow_mask": motion, "transform": registration["matrix"]}
    return report, arrays
