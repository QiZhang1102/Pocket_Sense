"""Benchmark bookkeeping/guard tests with explicitly synthetic math fixtures."""
import csv
import json

import numpy as np
import pytest

from pocketsense_calibration.benchmark import CSV_FIELDS, main, run_benchmark
from pocketsense_calibration.colorimetry import WHITEPOINTS


def neutral_xyz(lightness):
    return WHITEPOINTS["D65"] * ((lightness + 16) / 116) ** 3


def row(sample="s1", *, method="matrix3x3", session="test-session", split="test", lightness=50,
        ref_lightness=50, device="device-a", lighting="daylight", target="patch-1", status="ok", source="synthetic", time=10):
    pred, ref = neutral_xyz(lightness), neutral_xyz(ref_lightness)
    values = dict(zip(("pred_x", "pred_y", "pred_z"), pred))
    values.update(zip(("ref_x", "ref_y", "ref_z"), ref))
    return {"sample_id": sample, "method": method, "device": device, "session": session,
            "lighting": lighting, "target_id": target, "split": split, "source_kind": source,
            "whitepoint": "D65", "processing_ms": time, "status": status, **values}


def write_csv(tmp_path, rows, *, fields=CSV_FIELDS):
    path = tmp_path / "input.csv"
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    return path


def test_metrics_count_failed_attempts_and_separate_unimplemented(tmp_path):
    rows = [row(), row("s2", lightness=60, time=20), row("s3", status="fail", time=30),
            row("s4", method="ml_unavailable", status="not_implemented", time="")]
    for record in rows[2:]:
        for field in ("pred_x", "pred_y", "pred_z"):
            record[field] = ""
    output = tmp_path / "report"
    report = run_benchmark(write_csv(tmp_path, rows), output, allow_synthetic=True)
    metric = next(item for item in report["metrics"] if item["method"] == "matrix3x3")
    assert metric["n_attempted"] == 3 and metric["n_failed"] == 1
    assert metric["failure_rate"] == pytest.approx(1 / 3)
    # CIEDE2000 for neutrals L*=50 and 60, from its closed-form lightness term.
    distance = 10 / (1 + 0.015 * 25 / np.sqrt(45))
    assert metric["mean_delta_e00"] == pytest.approx(distance / 2, abs=1e-12)
    assert metric["median_delta_e00"] == pytest.approx(distance / 2, abs=1e-12)
    assert metric["p95_delta_e00"] == pytest.approx(distance * 0.95, abs=1e-12)
    assert metric["processing_ms_mean"] == 20
    skipped = next(item for item in report["metrics"] if item["method"] == "ml_unavailable")
    assert skipped["n_skipped"] == 1 and skipped["n_attempted"] == 0
    assert skipped["failure_rate"] is None and skipped["mean_delta_e00"] is None
    assert "not experimental evidence" in report["evidence_label"]
    saved = json.loads((output / "benchmark_summary.json").read_text())
    assert saved == report
    with (output / "benchmark_samples.csv").open(newline="") as stream:
        stored = list(csv.DictReader(stream))
    assert len(stored) == 4 and stored[2]["status"] == "fail"
    assert {p.name for p in output.iterdir()} == {"benchmark_summary.json", "benchmark_samples.csv", "benchmark_metrics.csv", "benchmark_consistency.csv"}


def test_all_failures_produce_null_error_not_zero_error(tmp_path):
    record = row(status="fail", time="")
    for field in ("pred_x", "pred_y", "pred_z"):
        record[field] = ""
    report = run_benchmark(write_csv(tmp_path, [record]), tmp_path / "out", allow_synthetic=True)
    metric = report["metrics"][0]
    assert metric["failure_rate"] == 1
    assert metric["mean_delta_e00"] is None
    assert metric["processing_ms_mean"] is None
    assert report["consistency"] == []


def test_consistency_only_compares_same_target_matching_whitepoint(tmp_path):
    records = [row(), row("s2", lightness=60, lighting="warm"), row("s3", device="device-b"),
               row("different-target", target="patch-2", lightness=20)]
    report = run_benchmark(write_csv(tmp_path, records), tmp_path / "out", allow_synthetic=True)
    consistency = {item["comparison"]: item for item in report["consistency"]}
    assert consistency["cross_device"]["n_pairs"] == 2
    assert consistency["cross_lighting"]["n_pairs"] == 2
    assert consistency["cross_lighting_same_device"]["n_pairs"] == 1
    assert consistency["cross_lighting"]["mean_delta_e00"] > 9
    records = [row(), row("s2", device="device-b")]
    records[1]["whitepoint"] = "D50"
    report = run_benchmark(write_csv(tmp_path, records), tmp_path / "out2", allow_synthetic=True)
    assert report["consistency"] == []
    assert {item["whitepoint"] for item in report["metrics"]} == {"D50", "D65"}
    assert all(item["n_rows"] == 1 for item in report["metrics"])


def test_train_and_test_are_separate_same_target_is_allowed(tmp_path):
    records = [row("train-s1", session="training-session", split="train", lightness=60), row()]
    report = run_benchmark(write_csv(tmp_path, records), tmp_path / "out", allow_synthetic=True)
    metrics = {item["split"]: item for item in report["metrics"]}
    assert metrics["test"]["mean_delta_e00"] == pytest.approx(0)
    assert metrics["train"]["mean_delta_e00"] > 9
    assert "training residuals" in metrics["train"]["interpretation"]
    assert report["provenance_verified"] is False


@pytest.mark.parametrize("split", ["train", "validation"])
def test_session_leakage_is_rejected_even_if_device_differs(tmp_path, split):
    records = [row("s1", split=split), row("s2", device="device-b")]
    with pytest.raises(ValueError, match="session leakage"):
        run_benchmark(write_csv(tmp_path, records), tmp_path / "out", allow_synthetic=True)
    assert not (tmp_path / "out").exists()


def test_sample_leakage_and_duplicates_rejected(tmp_path):
    with pytest.raises(ValueError, match="duplicate"):
        run_benchmark(write_csv(tmp_path, [row(), row()]), tmp_path / "out", allow_synthetic=True)
    records = [row(method="a", session="training", split="train"), row(method="b")]
    with pytest.raises(ValueError, match="sample_id leakage"):
        run_benchmark(write_csv(tmp_path, records), tmp_path / "out", allow_synthetic=True)


@pytest.mark.parametrize("field,value,error", [
    ("pred_x", "NaN", "finite"), ("ref_y", -1, "nonnegative"),
    ("processing_ms", -1, "negative"), ("processing_ms", "", "numeric"),
    ("status", "success", "status"), ("split", "unknown", "split"),
    ("source_kind", "", "identities"), ("whitepoint", "D75", "whitepoint"),
])
def test_bad_rows_rejected(tmp_path, field, value, error):
    record = row()
    record[field] = value
    with pytest.raises(ValueError, match=error):
        run_benchmark(write_csv(tmp_path, [record]), tmp_path / "out", allow_synthetic=True)


def test_synthetic_requires_opt_in_and_real_labels_are_not_verified(tmp_path):
    path = write_csv(tmp_path, [row()])
    with pytest.raises(ValueError, match="synthetic results require"):
        run_benchmark(path, tmp_path / "out")
    report = run_benchmark(write_csv(tmp_path, [row(source="real")]), tmp_path / "out")
    assert report["synthetic_rows"] == 0
    assert "provenance not independently verified" in report["evidence_label"]
    assert [m["method"] for m in report["metrics"]] == ["matrix3x3"]  # no invented ML rows


def test_empty_or_missing_schema_rejected(tmp_path):
    with pytest.raises(ValueError, match="no measurements"):
        run_benchmark(write_csv(tmp_path, []), tmp_path / "out")
    with pytest.raises(ValueError, match="missing fields"):
        run_benchmark(write_csv(tmp_path, [row()], fields=["sample_id", "method"]), tmp_path / "out")


def test_standalone_cli_requires_explicit_synthetic_flag(tmp_path, capsys):
    path = write_csv(tmp_path, [row()])
    assert main([str(path), str(tmp_path / "out"), "--allow-synthetic"]) == 0
    assert json.loads(capsys.readouterr().out)["synthetic_rows"] == 1
