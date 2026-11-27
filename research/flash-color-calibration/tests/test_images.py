import sys
from types import SimpleNamespace

import numpy as np
from PIL import Image
import pytest

from pocketsense_calibration.images import bayer_superpixels, load_image


def test_per_site_black_white_normalization_and_green_average():
    colors = np.tile([[0, 1], [3, 2]], (8, 8))
    black = np.array([10, 20, 30, 40])
    white = np.array([110, 220, 430, 540])
    levels = np.array([0.2, 0.3, 0.6, 0.5])
    mosaic = black[colors] + (white - black)[colors] * levels[colors]
    rgb, valid, saturated, info = bayer_superpixels(mosaic, colors, black, white, b"RGBG")
    np.testing.assert_allclose(rgb, np.broadcast_to([0.2, 0.4, 0.6], (8, 8, 3)), atol=1e-7)
    assert valid.all() and not saturated.any()
    assert "no WB/gamma" in info["processing"]


def test_raw_signed_below_black_and_saturation_preserved_but_excluded():
    colors = np.tile([[0, 1], [3, 2]], (8, 8))
    mosaic = np.full((16, 16), 60.0)
    mosaic[0, 0] = 5
    mosaic[2, 2] = 110
    rgb, valid, saturated, _ = bayer_superpixels(mosaic, colors, [10] * 4, [110] * 4, b"RGBG")
    assert rgb[0, 0, 0] < 0 and not valid[0, 0]
    assert saturated[1, 1] and not valid[1, 1]


def test_raw_loader_uses_mosaic_not_rendered_postprocess(tmp_path, monkeypatch):
    class Raw:
        raw_pattern = np.array([[0, 1], [3, 2]])
        raw_colors_visible = np.tile(raw_pattern, (8, 8))
        raw_image_visible = np.full((16, 16), 50, dtype=np.uint16)
        black_level_per_channel = [0] * 4
        camera_white_level_per_channel = None
        white_level = 100
        color_desc = b"RGBG"
        sizes = SimpleNamespace(flip=0)
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def postprocess(self):
            pytest.fail("Rendered RAW processing must not run")
    monkeypatch.setitem(sys.modules, "rawpy", SimpleNamespace(imread=lambda path: Raw()))
    path = tmp_path / "fixture.dng"
    path.write_bytes(b"mock-decoder-test-only-not-a-real-dng")
    frame = load_image(path)
    assert frame.domain == "linear_camera_rgb" and frame.linear_source
    np.testing.assert_allclose(frame.rgb, 0.5)


@pytest.mark.parametrize("mode", ["P", "RGB", "L", "RGBA"])
def test_all_transparency_forms_exclude_hidden_color(tmp_path, mode):
    if mode == "P":
        image = Image.new(mode, (16, 16), 0)
        image.putpalette([120, 50, 30] + [0] * 765)
        image.info["transparency"] = 0
    elif mode == "RGB":
        image = Image.new(mode, (16, 16), (120, 50, 30))
        image.info["transparency"] = (120, 50, 30)
    elif mode == "L":
        image = Image.new(mode, (16, 16), 120)
        image.info["transparency"] = 120
    else:
        image = Image.new(mode, (16, 16), (120, 50, 30, 0))
    path = tmp_path / "transparent.png"
    image.save(path)
    assert not load_image(path).valid.any()


def test_npy_rejects_pickle_integer_nonfinite_and_unknown_domain(tmp_path):
    path = tmp_path / "input.npy"
    for array in (np.ones((8, 8, 3), dtype=np.uint8), np.full((8, 8, 3), np.nan), np.full((8, 8, 3), 1.1)):
        np.save(path, array)
        with pytest.raises(ValueError):
            load_image(path, {"input_domain": "linear_camera_rgb"})
    np.save(path, np.ones((8, 8, 3), dtype=float) * 0.3)
    with pytest.raises(ValueError, match="input_domain"):
        load_image(path)


def test_png_transfer_and_saturation(tmp_path):
    path = tmp_path / "srgb.png"
    image = np.full((16, 16, 3), 128, dtype=np.uint8)
    image[0, 0] = 255
    Image.fromarray(image).save(path)
    frame = load_image(path)
    assert frame.rgb[1, 1, 0] == pytest.approx(0.21586, abs=1e-5)
    assert not frame.linear_source and frame.saturated[0, 0] and not frame.valid[0, 0]


def test_non_bayer_and_bad_levels_rejected():
    colors = np.tile([[0, 1], [3, 2]], (8, 8))
    colors[8, 8] = 1
    with pytest.raises(ValueError, match="2x2"):
        bayer_superpixels(np.ones((16, 16)), colors, [0] * 4, [100] * 4, b"RGBG")
    with pytest.raises(ValueError, match="black/white"):
        bayer_superpixels(np.ones((16, 16)), colors, [0] * 4, [0] * 4, b"RGBG")
