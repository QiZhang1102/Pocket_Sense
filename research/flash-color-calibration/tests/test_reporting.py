"""Artifact/provenance checks, not visual golden images or physical results."""

import copy
import csv
import json

import numpy as np
from PIL import Image
import pytest

from pocketsense_calibration.reporting import save_benchmark_plot, save_pair_output


def _fixture():
    ambient = np.full((10, 12, 3), 0.2, dtype=np.float32)
    difference = np.full_like(ambient, 0.1)
    difference[0, 0] = [-0.2, -0.1, 0.05]
    valid = np.ones(ambient.shape[:2], bool)
    valid[0, 0] = False
    arrays = {"ambient": ambient, "ambient_aligned": ambient.copy(),
              "flash": ambient + difference, "signed_difference": difference,
              "valid_mask": valid, "roi_mask": np.ones_like(valid),
              "overlap_mask": np.ones_like(valid), "transform": np.eye(3)}
    for key in ("saturation_mask", "negative_excluded_mask", "low_signal_mask", "motion_or_shadow_mask"):
        arrays[key] = np.zeros_like(valid)
    arrays["negative_excluded_mask"][0, 0] = True
    report = {"experimental": True, "source_kind": "synthetic", "accepted": True,
              "mode": "controlled", "color_mode": "chromaticity",
              "capture_assertions": {"device": "数学夹具手机", "camera": "后置相机"},
              "warnings": ["合成数据，不能验证真实准确度"],
              "color": {"domain": "linear_camera_rgb",
                        "linear_difference_rgb_mean": [0.1, 0.1, 0.1],
                        "linear_difference_rgb_median": [0.1, 0.1, 0.1],
                        "xy": [0.31, 0.33], "xyz_relative": None, "lab": None,
                        "whitepoint": "D65"}}
    return report, arrays


def test_pair_exports_strict_utf8_json_existing_coordinates_and_signed_arrays(tmp_path):
    report, arrays = _fixture()
    originals = {key: value.copy() for key, value in arrays.items()}
    save_pair_output(report, arrays, tmp_path)
    encoded = (tmp_path / "report.json").read_text(encoding="utf-8")
    assert "数学夹具手机" in encoded and "合成数据" in encoded
    assert "NaN" not in encoded and "Infinity" not in encoded
    assert json.loads(encoded) == report
    with (tmp_path / "colors.csv").open(encoding="utf-8", newline="") as stream:
        rows = list(csv.DictReader(stream))
    assert len(rows) == 1 and rows[0]["device"] == "数学夹具手机"
    assert float(rows[0]["x_chromaticity"]) == 0.31
    assert rows[0]["relative_Y"] == "" and rows[0]["Lab_L"] == ""
    with np.load(tmp_path / "signed_difference.npz", allow_pickle=False) as stored:
        assert stored["signed_difference"][0, 0, 0] < 0
        for key, value in originals.items():
            np.testing.assert_array_equal(stored[key], value)
            np.testing.assert_array_equal(arrays[key], value)
    for name in ("preview.png", "contactsheet.png"):
        with Image.open(tmp_path / name) as image:
            assert image.format == "PNG" and image.width > 100 and image.height > 100


def test_no_profile_export_does_not_invent_xy_or_lab(tmp_path):
    report, arrays = _fixture()
    report["color"].update(xy=None, whitepoint=None)
    save_pair_output(report, arrays, tmp_path)
    with (tmp_path / "colors.csv").open(encoding="utf-8", newline="") as stream:
        row = next(csv.DictReader(stream))
    assert row["x_chromaticity"] == row["relative_X"] == row["Lab_L"] == ""


def test_nonfinite_report_is_rejected_before_files_are_written(tmp_path):
    report, arrays = _fixture()
    report["processing_ms"] = float("nan")
    with pytest.raises(ValueError):
        save_pair_output(report, arrays, tmp_path / "bad")
    assert not (tmp_path / "bad").exists()


def test_existing_referenced_coordinates_are_preserved_without_recalculation(tmp_path):
    report, arrays = _fixture()
    report["color"].update(xyz_relative=[0.2, 0.25, 0.3], lab=[52.1, -1.3, 4.5])
    original = copy.deepcopy(report)
    save_pair_output(report, arrays, tmp_path)
    with (tmp_path / "colors.csv").open(encoding="utf-8", newline="") as stream:
        row = next(csv.DictReader(stream))
    assert float(row["relative_Y"]) == 0.25 and float(row["Lab_a"]) == -1.3
    assert report == original


def _metric(method, split="test", source_kind="synthetic", value=1.2):
    return {"method": method, "split": split, "source_kind": source_kind,
            "n_success": 3 if value is not None else 0, "n_attempted": 4,
            "mean_delta_e00": value, "median_delta_e00": value,
            "p95_delta_e00": value}


def test_benchmark_renders_separate_provenance_splits_and_missing_results(tmp_path):
    summary = {"metrics": [_metric("matrix", "train"), _metric("matrix", "test"),
                           _metric("matrix", "test", "real"),
                           _metric("not_implemented", "test", value=None)]}
    original = copy.deepcopy(summary)
    save_benchmark_plot(summary, tmp_path)
    with Image.open(tmp_path / "benchmark.png") as image:
        assert image.format == "PNG" and image.height > image.width
    assert summary == original


def test_empty_benchmark_is_an_explicit_no_data_plot(tmp_path):
    save_benchmark_plot({"metrics": []}, tmp_path)
    assert (tmp_path / "benchmark.png").is_file()


@pytest.mark.parametrize("metrics", [[_metric("matrix"), _metric("matrix")],
                                    [_metric("matrix", value=float("nan"))]])
def test_incompatible_or_nonfinite_benchmark_summary_is_rejected(tmp_path, metrics):
    with pytest.raises(ValueError):
        save_benchmark_plot({"metrics": metrics}, tmp_path)
