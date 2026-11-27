"""Explicit input domains. RAW uses linear Bayer superpixels, never rendered RGB."""
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, ImageCms, ImageOps

from .colorimetry import srgb_to_linear

MAX_PIXELS = 16_000_000


@dataclass
class Frame:
    rgb: np.ndarray
    valid: np.ndarray
    saturated: np.ndarray
    domain: str
    linear_source: bool
    info: dict


def _shape_check(array):
    if array.ndim != 3 or array.shape[2] != 3 or min(array.shape[:2]) < 8:
        raise ValueError("Input must be an RGB image at least 8 by 8 pixels.")
    if array.shape[0] * array.shape[1] > MAX_PIXELS:
        raise ValueError("Input exceeds the 16 megapixel analysis limit; prepare a documented smaller input.")
    if not np.isfinite(array).all():
        raise ValueError("Input contains non-finite samples.")


def bayer_superpixels(mosaic, colors, black_levels, white_levels, color_desc):
    """Average the two green sites in each 2x2 Bayer tile without WB/demosaicing.

    Levels are per CFA channel. Values outside sensor range are retained in rgb
    but excluded by valid; they are not silently corrected into measurements.
    """
    mosaic = np.asarray(mosaic)
    colors = np.asarray(colors)
    desc = color_desc.decode("ascii") if isinstance(color_desc, bytes) else str(color_desc)
    black = np.asarray(black_levels, dtype=np.float64)
    white = np.asarray(white_levels, dtype=np.float64)
    if mosaic.ndim != 2 or colors.shape != mosaic.shape or min(mosaic.shape) < 16:
        raise ValueError("Unsupported RAW dimensions or CFA map.")
    if black.shape != white.shape or black.ndim != 1 or len(black) != len(desc):
        raise ValueError("RAW black/white levels do not match the CFA channels.")
    if not np.isfinite(black).all() or not np.isfinite(white).all() or np.any(white <= black):
        raise ValueError("Invalid RAW black/white metadata.")
    pattern = colors[:2, :2]
    if any(not np.array_equal(colors[y::2, x::2], np.full_like(colors[y::2, x::2], pattern[y, x]))
           for y in range(2) for x in range(2)):
        raise ValueError("Only repeating 2x2 Bayer sensors are supported; X-Trans/Foveon are not supported.")
    if colors.min() < 0 or colors.max() >= len(desc):
        raise ValueError("CFA index is outside color metadata.")
    letters = [desc[int(c)] for c in pattern.flat]
    if sorted(letters) != ["B", "G", "G", "R"]:
        raise ValueError("Only standard RGB Bayer mosaics are supported.")
    height, width = mosaic.shape[0] // 2 * 2, mosaic.shape[1] // 2 * 2
    if height * width // 4 > MAX_PIXELS:
        raise ValueError("RAW superpixel output exceeds the 16 megapixel analysis limit.")
    samples = []
    channels = []
    for y in range(2):
        for x in range(2):
            channel = int(pattern[y, x])
            samples.append((mosaic[y:height:2, x:width:2].astype(np.float32) - black[channel]) /
                           (white[channel] - black[channel]))
            channels.append(desc[channel])
    sites = np.stack(samples, axis=-1)
    rgb = np.stack([sites[..., np.array(channels) == name].mean(axis=-1)
                    for name in "RGB"], axis=-1).astype(np.float32)
    valid = np.all((sites >= 0) & (sites < 0.995), axis=-1)
    saturated = np.any(sites >= 0.995, axis=-1)
    return rgb, valid, saturated, {
        "decoder": "rawpy/LibRaw Bayer 2x2 superpixels", "color_desc": desc,
        "cfa_pattern": pattern.tolist(), "black_levels": black.tolist(),
        "white_levels": white.tolist(), "discarded_odd_border": [mosaic.shape[0] - height, mosaic.shape[1] - width],
        "processing": "per-site black subtraction and white normalization; R/B retained, two G averaged; no WB/gamma/auto-brightening",
        "coordinates": "half-resolution visible RAW sensor coordinates, no orientation rotation",
    }


def load_image(path, metadata=None):
    path = Path(path)
    metadata = metadata or {}
    suffix = path.suffix.lower()
    if suffix == ".npy":
        array = np.load(path, allow_pickle=False, mmap_mode="r")
        if array.dtype.kind != "f":
            raise ValueError("Linear NPY input must use floating-point normalized samples.")
        _shape_check(array)
        if np.any((array < 0) | (array > 1)):
            raise ValueError("Linear NPY must be normalized to [0,1]; clipping must be documented upstream.")
        domain = metadata.get("input_domain")
        if domain not in {"linear_camera_rgb", "linear_srgb"}:
            raise ValueError("NPY input requires an explicit input_domain in the sidecar.")
        rgb = np.asarray(array, dtype=np.float32)
        saturated = np.any(rgb >= 0.995, axis=-1)
        frame = Frame(rgb, ~saturated, saturated, domain, True,
                      {"decoder": "normalized floating-point NPY", "linearity": "user asserted, not independently verified"})
    elif suffix in {".jpg", ".jpeg", ".png"}:
        with Image.open(path) as image:
            if image.width * image.height > MAX_PIXELS:
                raise ValueError("Rendered image exceeds the 16 megapixel analysis limit.")
            image = ImageOps.exif_transpose(image)
            opaque = (np.asarray(image.convert("RGBA").getchannel("A")) == 255
                      if "A" in image.getbands() or "transparency" in image.info else None)
            profile = image.info.get("icc_profile")
            image = image.convert("RGB")
            if profile:
                try:
                    image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(BytesIO(profile)),
                                                     ImageCms.createProfile("sRGB"), outputMode="RGB")
                except (OSError, ValueError, ImageCms.PyCMSError) as error:
                    raise ValueError("Cannot safely convert the embedded color profile to sRGB.") from error
            encoded = np.asarray(image, dtype=np.float32) / 255
        _shape_check(encoded)
        saturated = np.any(encoded >= 254 / 255, axis=-1)
        valid = ~saturated
        if opaque is not None:
            valid &= opaque
        frame = Frame(srgb_to_linear(encoded).astype(np.float32), valid, saturated,
                      "linear_srgb", False, {"decoder": "Pillow ICC to sRGB then inverse sRGB transfer",
                      "linearity": "inverse transfer only; camera tone mapping/HDR/AWB remain unknown",
                      "orientation": "EXIF orientation applied", "embedded_icc": bool(profile)})
    else:
        if suffix not in {".dng", ".nef", ".cr2", ".cr3", ".arw", ".rw2", ".orf", ".raf", ".raw"}:
            raise ValueError("Supported inputs are JPEG, PNG, normalized linear NPY, or compatible Bayer RAW.")
        try:
            import rawpy
        except ImportError as error:
            raise ValueError("RAW decoding needs the optional [raw] dependency; install rawpy locally.") from error
        try:
            with rawpy.imread(str(path)) as raw:
                if raw.raw_pattern is None or raw.raw_pattern.shape != (2, 2):
                    raise ValueError("Only standard 2x2 Bayer RAW is supported.")
                black = raw.black_level_per_channel
                white = raw.camera_white_level_per_channel
                if white is None:
                    white = [raw.white_level] * len(black)
                rgb, valid, saturated, info = bayer_superpixels(
                    raw.raw_image_visible, raw.raw_colors_visible, black, white, raw.color_desc)
                info["sensor_orientation_code"] = int(raw.sizes.flip)
        except rawpy.LibRawError as error:
            raise ValueError(f"RAW decoder rejected the file: {error}") from error
        _shape_check(rgb)
        frame = Frame(rgb, valid, saturated, "linear_camera_rgb", True, info)
    frame.info.update({"file": path.name, "sha256": sha256(path.read_bytes()).hexdigest(),
                       "shape": list(frame.rgb.shape), "domain": frame.domain,
                       "linear_source": frame.linear_source})
    return frame
