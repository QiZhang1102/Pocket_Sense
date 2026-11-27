"""Explicit relative colorimetry; XYZ white has Y=1 and no implicit adaptation.

sRGB transfer/matrix: https://www.w3.org/TR/css-color-4/#color-conversion-code
CIEDE2000: https://scikit-image.org/docs/stable/api/skimage.color.html
These numerical conversions do not characterize a camera or establish accuracy.
"""
from __future__ import annotations

import numpy as np
from skimage.color import deltaE_ciede2000

SRGB_TO_XYZ = np.array([
    [506752 / 1228815, 87881 / 245763, 12673 / 70218],
    [87098 / 409605, 175762 / 245763, 12673 / 175545],
    [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
], dtype=np.float64)

# CIE 1931 2-degree observer, using the consistent CSS Color 4 chromaticities.
WHITEPOINTS = {
    "D65": np.array([0.3127 / 0.3290, 1.0, (1 - 0.3127 - 0.3290) / 0.3290]),
    "D50": np.array([0.3457 / 0.3585, 1.0, (1 - 0.3457 - 0.3585) / 0.3585]),
}


def _triplets(array, name="array") -> np.ndarray:
    result = np.asarray(array, dtype=np.float64)
    if result.ndim < 1 or result.shape[-1] != 3 or result.size == 0:
        raise ValueError(f"{name} must have nonempty shape (..., 3)")
    if not np.isfinite(result).all():
        raise ValueError(f"{name} must contain only finite values")
    return result


def _whitepoint(whitepoint: str) -> tuple[str, np.ndarray]:
    name = str(whitepoint).upper()
    if name not in WHITEPOINTS:
        raise ValueError("whitepoint must be D65 or D50; chromatic adaptation is not automatic")
    return name, WHITEPOINTS[name]


def srgb_to_linear(array) -> np.ndarray:
    """Decode normalized sRGB, with sign-preserving extension and no clipping.

    Input is normalized float RGB, not 0..255. Values outside 0..1 remain
    outside gamut; an inverse sRGB transfer is not a RAW-camera linearization.
    """
    values = _triplets(array, "sRGB")
    absolute = np.abs(values)
    with np.errstate(over="ignore", invalid="ignore"):
        result = np.where(absolute <= 0.04045, values / 12.92,
                          np.sign(values) * ((absolute + 0.055) / 1.055) ** 2.4)
    return _triplets(result, "decoded linear sRGB")


def linear_to_srgb(array) -> np.ndarray:
    """Encode linear sRGB without clipping or integer quantization."""
    values = _triplets(array, "linear sRGB")
    absolute = np.abs(values)
    with np.errstate(over="ignore", invalid="ignore"):
        result = np.where(absolute <= 0.0031308, 12.92 * values,
                          np.sign(values) * (1.055 * absolute ** (1 / 2.4) - 0.055))
    return _triplets(result, "encoded sRGB")


def linear_srgb_to_xyz(array) -> np.ndarray:
    """Map linear sRGB to relative D65 XYZ (Y_white=1), without clipping."""
    with np.errstate(over="ignore", invalid="ignore"):
        result = _triplets(array, "linear sRGB") @ SRGB_TO_XYZ.T
    return _triplets(result, "converted XYZ")


def xyz_to_lab(xyz, whitepoint="D65") -> np.ndarray:
    """CIELAB relative to the named white, without chromatic adaptation.

    XYZ must already use this reference white and the Y_white=1 scale.
    Signed XYZ is retained rather than silently clipped.
    """
    values = _triplets(xyz, "XYZ")
    _, white = _whitepoint(whitepoint)
    with np.errstate(over="ignore", invalid="ignore"):
        ratio = values / white
    delta = 6 / 29
    transformed = np.where(ratio > delta ** 3, np.cbrt(ratio),
                           ratio / (3 * delta ** 2) + 4 / 29)
    x, y, z = np.moveaxis(transformed, -1, 0)
    with np.errstate(over="ignore", invalid="ignore"):
        result = np.stack((116 * y - 16, 500 * (x - y), 200 * (y - z)), axis=-1)
    return _triplets(result, "converted Lab")


def delta_e00(lab1, lab2) -> np.ndarray:
    """CIEDE2000 with kL=kC=kH=1; callers must use matching whitepoints."""
    first, second = np.broadcast_arrays(_triplets(lab1, "Lab1"), _triplets(lab2, "Lab2"))
    with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
        result = deltaE_ciede2000(first, second, channel_axis=-1)
    if not np.isfinite(result).all():
        raise ValueError("CIEDE2000 result is nonfinite; check Lab scale and input magnitude")
    return result


def chromaticity(xyz) -> np.ndarray:
    """Return CIE xy, raising for black/nonphysical nonpositive totals."""
    values = _triplets(xyz, "XYZ")
    # Scale first, so a valid bright finite triplet does not overflow the sum.
    scale = np.max(np.abs(values), axis=-1, keepdims=True)
    if np.any(scale == 0):
        raise ValueError("chromaticity is undefined when X+Y+Z is nonpositive")
    normalized = values / scale
    total = normalized.sum(axis=-1, keepdims=True)
    if np.any(total <= 0):
        raise ValueError("chromaticity is undefined when X+Y+Z is nonpositive")
    return normalized[..., :2] / total
