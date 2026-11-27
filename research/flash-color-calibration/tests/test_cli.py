import csv
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
import pytest

from pocketsense_calibration.cli import _fit_csv, _json, main
from pocketsense_calibration.colorimetry import linear_srgb_to_xyz
from pocketsense_calibration.synthetic import capture_metadata


def test_installed_module_help():
    result = subprocess.run([sys.executable, "-m", "pocketsense_calibration", "--help"], capture_output=True, text=True)
    assert result.returncode == 0 and "synthetic" in result.stdout


def test_cli_rejection_report_and_preserves_existing_output(tmp_path):
    destination = tmp_path / "rejected"
    assert main(["pair", str(tmp_path / "missing.npy"), str(tmp_path / "missing2.npy"), "--out", str(destination)]) == 2
    assert json.loads((destination / "rejection.json").read_text())["accepted"] is False
    marker = destination / "keep.txt"
    marker.write_text("existing experimental work", encoding="utf-8")
    assert main(["synthetic", "--out", str(destination)]) == 2
    assert marker.read_text() == "existing experimental work"


def test_pair_cli_end_to_end_and_screen_gate(tmp_path):
    ambient = np.full((32, 32, 3), 0.1, dtype=np.float32)
    np.save(tmp_path / "a.npy", ambient)
    np.save(tmp_path / "f.npy", ambient + 0.2)
    meta = capture_metadata()
    meta_path = tmp_path / "pair.json"
    meta_path.write_text(json.dumps(meta))
    args = ["pair", str(tmp_path / "a.npy"), str(tmp_path / "f.npy"), "--metadata", str(meta_path),
            "--mode", "controlled", "--alignment", "none"]
    output = tmp_path / "accepted"
    assert main(args + ["--out", str(output)]) == 0
    report = json.loads((output / "report.json").read_text())
    assert report["accepted"] and report["color"]["lab"] is None
    assert {"report.json", "colors.csv", "signed_difference.npz", "preview.png", "contactsheet.png"}.issubset({p.name for p in output.iterdir()})
    meta["scene"] = "screen"
    meta_path.write_text(json.dumps(meta))
    assert main(args + ["--out", str(tmp_path / "screen")]) == 2


def test_fit_cli_export_import_and_leakage_guard(tmp_path):
    from pocketsense_calibration.calibration import load_profile
    rng = np.random.default_rng(912)
    rgb = rng.uniform(0.1, 0.6, (14, 3))
    xyz = linear_srgb_to_xyz(rgb)
    fields = ["r", "g", "b", "x", "y", "z", "split", "session"]
    path = tmp_path / "calibration.csv"
    with path.open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(fields)
        for i, (r, x) in enumerate(zip(rgb, xyz)):
            writer.writerow([*r, *x, "train" if i < 10 else "validation", "train-capture" if i < 10 else "validation-capture"])
    meta = {"device": "synthetic", "camera": "synthetic", "input_domain": "linear_camera_rgb",
            "capture_settings": {"iso": 100}, "target": "synthetic", "date": "2026-11-26",
            "scale_reference": "synthetic fixed geometry"}
    metadata_path = tmp_path / "profile.json"
    metadata_path.write_text(json.dumps(meta))
    destination = tmp_path / "result.json"
    assert main(["fit", str(path), "--metadata", str(metadata_path), "--out", str(destination)]) == 0
    assert load_profile(destination)["validation"]["provided"]
    path.write_text(path.read_text().replace("validation-capture", "train-capture"))
    assert main(["fit", str(path), "--metadata", str(metadata_path), "--out", str(tmp_path / "leak.json")]) == 2


def test_synthetic_runs_actual_pipeline_and_keeps_ml_skipped(tmp_path):
    destination = tmp_path / "fixture"
    assert main(["synthetic", "--out", str(destination)]) == 0
    report = json.loads((destination / "pair" / "report.json").read_text())
    assert report["accepted"] and report["source_kind"] == "synthetic"
    assert report["color"]["lab"] is not None
    benchmark = json.loads((destination / "benchmark" / "benchmark_summary.json").read_text())
    assert benchmark["real_rows"] == 0
    ml = next(row for row in benchmark["metrics"] if row["method"] == "hybrid_ml")
    assert ml["n_attempted"] == 0 and ml["n_skipped"] == 1 and ml["mean_delta_e00"] is None
    matrix = next(row for row in benchmark["metrics"] if row["method"] == "flash_device_matrix")
    assert matrix["mean_delta_e00"] < 1e-10  # Exact known synthetic model, not a phone-accuracy threshold.


def test_malformed_raw_is_a_rejection_not_an_uncaught_decoder_error(tmp_path):
    pytest.importorskip("rawpy")
    left, right = tmp_path / "invalid.dng", tmp_path / "other.dng"
    left.write_bytes(b"not a RAW file")
    right.write_bytes(b"not a RAW file")
    assert main(["pair", str(left), str(right), "--out", str(tmp_path / "rejected")]) == 2


def test_calibration_session_whitespace_cannot_bypass_split_guard(tmp_path):
    path = tmp_path / "session.csv"
    path.write_text("r,g,b,x,y,z,split,session\n0.1,0.2,0.3,0.1,0.2,0.3,train,same-session\n"
                    "0.2,0.3,0.4,0.2,0.3,0.4,validation, same-session \n")
    with pytest.raises(ValueError, match="leakage"):
        _fit_csv(path)


@pytest.mark.parametrize("body", ["r,g,b,x,y,z,split,session\n0.1,0.2,0.3,0.1,0.2,0.3,train\n",
                                   "r,g,b,x,y,z,split,session,session\n"])
def test_malformed_calibration_csv_fails_cleanly(tmp_path, body):
    path = tmp_path / "bad.csv"
    path.write_text(body)
    with pytest.raises(ValueError):
        _fit_csv(path)


def test_metadata_json_must_be_an_object(tmp_path):
    path = tmp_path / "metadata.json"
    path.write_text('["not an object"]')
    with pytest.raises(ValueError, match="JSON object"):
        _json(path)
