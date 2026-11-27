"""Describe supplied paired XYZ results without inventing measurements.

CSV schema is explicit; a failed attempt remains in the failure denominator.
Session-disjoint splits are checked within the supplied table, not asserted for
unseen model-training data. No absent method, including ML, is fabricated.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import csv
from itertools import combinations
import json
from pathlib import Path

import numpy as np

from .colorimetry import _whitepoint, delta_e00, xyz_to_lab

CSV_FIELDS = [
    "sample_id", "method", "device", "session", "lighting", "target_id", "split",
    "source_kind", "whitepoint", "pred_x", "pred_y", "pred_z", "ref_x", "ref_y",
    "ref_z", "processing_ms", "status",
]
_IDENTITY_FIELDS = CSV_FIELDS[:9]


def _number(value, field: str, line: int, *, optional=False):
    if optional and value == "":
        return None
    try:
        result = float(value)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"CSV line {line}: {field} must be numeric") from exc
    if not np.isfinite(result):
        raise ValueError(f"CSV line {line}: {field} must be finite")
    return result


def _read_rows(path: Path, allow_synthetic: bool) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames):
            raise ValueError("CSV requires a header with unique field names")
        missing = set(CSV_FIELDS) - set(reader.fieldnames)
        if missing:
            raise ValueError("CSV missing fields: " + ", ".join(sorted(missing)))
        rows = []
        identifiers = set()
        sessions = defaultdict(set)
        samples = defaultdict(set)
        for line, source in enumerate(reader, 2):
            if None in source or any(value is None for value in source.values()):
                raise ValueError(f"CSV line {line}: malformed field count")
            row = {key: source[key].strip() for key in CSV_FIELDS}
            if any(not row[key] for key in _IDENTITY_FIELDS):
                raise ValueError(f"CSV line {line}: sample/method/capture/split/source identities cannot be empty")
            if row["split"] not in ("train", "validation", "test"):
                raise ValueError(f"CSV line {line}: split must be train, validation or test")
            if row["source_kind"] not in ("real", "synthetic"):
                raise ValueError(f"CSV line {line}: source_kind must be real or synthetic")
            if row["source_kind"] == "synthetic" and not allow_synthetic:
                raise ValueError("synthetic results require allow_synthetic=True; they are not experimental evidence")
            if row["status"] not in ("ok", "fail", "not_implemented"):
                raise ValueError(f"CSV line {line}: status must be ok, fail or not_implemented")
            row["whitepoint"], _ = _whitepoint(row["whitepoint"])
            identity = (row["method"], row["sample_id"])
            if identity in identifiers:
                raise ValueError(f"CSV line {line}: duplicate method/sample_id")
            identifiers.add(identity)
            sessions[row["session"]].add(row["split"])
            samples[row["sample_id"]].add(row["split"])
            optional = row["status"] != "ok"
            for field in ("pred_x", "pred_y", "pred_z", "ref_x", "ref_y", "ref_z", "processing_ms"):
                row[field] = _number(row[field], field, line, optional=optional)
            if row["processing_ms"] is not None and row["processing_ms"] < 0:
                raise ValueError(f"CSV line {line}: processing_ms cannot be negative")
            if any(row[key] is not None and row[key] < 0 for key in ("ref_x", "ref_y", "ref_z")):
                raise ValueError(f"CSV line {line}: reference XYZ must be nonnegative (Y_white=1)")
            row["delta_e00"] = None
            row["negative_pred_xyz"] = False
            if row["status"] == "ok":
                predicted = np.array([row[key] for key in ("pred_x", "pred_y", "pred_z")])
                reference = np.array([row[key] for key in ("ref_x", "ref_y", "ref_z")])
                row["lab"] = xyz_to_lab(predicted, row["whitepoint"])
                row["delta_e00"] = float(delta_e00(row["lab"], xyz_to_lab(reference, row["whitepoint"])))
                row["negative_pred_xyz"] = bool(np.any(predicted < 0))
            rows.append(row)
    if not rows:
        raise ValueError("CSV contains no measurements or explicitly labelled synthetic rows")
    # Globally unique session IDs are required: do not reuse a short local label
    # for different devices. Matching chart/target IDs across splits are allowed.
    if any(len(splits) > 1 for splits in sessions.values()):
        raise ValueError("session leakage between splits; use globally unique, disjoint capture sessions")
    if any(len(splits) > 1 for splits in samples.values()):
        raise ValueError("sample_id leakage between splits")
    return rows


def _stats(values: list[float]) -> dict:
    if not values:
        return {"mean": None, "median": None, "p95": None}
    return {"mean": float(np.mean(values)), "median": float(np.median(values)),
            "p95": float(np.percentile(values, 95))}


def _metrics(rows: list[dict]) -> list[dict]:
    groups = defaultdict(list)
    for row in rows:
        groups[(row["method"], row["split"], row["source_kind"], row["whitepoint"])].append(row)
    result = []
    for (method, split, source_kind, whitepoint), group in sorted(groups.items()):
        attempts = [row for row in group if row["status"] != "not_implemented"]
        successful = [row for row in attempts if row["status"] == "ok"]
        errors = _stats([row["delta_e00"] for row in successful])
        timings = _stats([row["processing_ms"] for row in attempts if row["processing_ms"] is not None])
        result.append({
            "method": method, "split": split, "source_kind": source_kind, "whitepoint": whitepoint,
            "n_rows": len(group), "n_attempted": len(attempts), "n_success": len(successful),
            "n_failed": len(attempts) - len(successful), "n_skipped": len(group) - len(attempts),
            "failure_rate": (len(attempts) - len(successful)) / len(attempts) if attempts else None,
            "mean_delta_e00": errors["mean"], "median_delta_e00": errors["median"], "p95_delta_e00": errors["p95"],
            "processing_ms_mean": timings["mean"], "processing_ms_median": timings["median"],
            "processing_ms_p95": timings["p95"],
            "n_timed": sum(row["processing_ms"] is not None for row in attempts),
            "n_negative_predictions": sum(row["negative_pred_xyz"] for row in successful),
            "interpretation": "training residuals only" if split == "train" else "descriptive supplied rows; independence beyond this CSV is unverified",
        })
    return result


def _consistency(rows: list[dict]) -> list[dict]:
    targets = defaultdict(list)
    for row in rows:
        if row["status"] == "ok":
            targets[(row["method"], row["split"], row["source_kind"], row["whitepoint"], row["target_id"])].append(row)
    differences = defaultdict(list)
    for (method, split, source_kind, whitepoint, _target), group in sorted(targets.items()):
        for first, second in combinations(group, 2):
            cross_device = first["device"] != second["device"]
            cross_lighting = first["lighting"] != second["lighting"]
            if not (cross_device or cross_lighting):
                continue
            distance = float(delta_e00(first["lab"], second["lab"]))
            if cross_device:
                differences[(method, split, source_kind, whitepoint, "cross_device")].append(distance)
            if cross_lighting:
                differences[(method, split, source_kind, whitepoint, "cross_lighting")].append(distance)
            if cross_lighting and not cross_device:
                differences[(method, split, source_kind, whitepoint, "cross_lighting_same_device")].append(distance)
    result = []
    for (method, split, source_kind, whitepoint, comparison), distances in sorted(differences.items()):
        stats = _stats(distances)
        result.append({"method": method, "split": split, "source_kind": source_kind,
                       "whitepoint": whitepoint, "comparison": comparison, "n_pairs": len(distances),
                       "mean_delta_e00": stats["mean"], "median_delta_e00": stats["median"],
                       "p95_delta_e00": stats["p95"],
                       "interpretation": "same-target pairwise repeatability; not independent accuracy; pairs may share samples"})
    return result


def _write_table(path: Path, rows: list[dict], fields: list[str] | None = None) -> None:
    columns = fields or (list(rows[0]) if rows else ["no_eligible_pairs"])
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def run_benchmark(csv_path, out_dir, *, allow_synthetic=False) -> dict:
    """Validate CSV, report failures and partitioned DeltaE00/timing statistics.

    All XYZ coordinates must already share the declared relative scale
    Y_white=1. Different whitepoints are not adapted or compared as pairs.
    Methods are listed only when present. 'not_implemented' is an explicit
    skipped method row, excluded from attempts and separately counted.
    """
    source_path = Path(csv_path)
    rows = _read_rows(source_path, allow_synthetic)
    metrics = _metrics(rows)
    consistency = _consistency(rows)
    synthetic = sum(row["source_kind"] == "synthetic" for row in rows)
    report = {
        "schema_version": 1, "input_csv": str(source_path), "xyz_scale": "relative_Y_white_1",
        "row_count": len(rows), "synthetic_rows": synthetic, "real_rows": len(rows) - synthetic,
        "has_test_rows": any(row["split"] == "test" for row in rows),
        "provenance_verified": False,
        "evidence_label": "contains synthetic mathematical fixtures; not experimental evidence" if synthetic else "user-supplied real-labelled rows; provenance not independently verified",
        "split_check": "globally session-disjoint and sample-disjoint across supplied train/validation/test rows; same target is allowed",
        "limits": [
            "External model-training data and capture provenance are not audited.",
            "Device and lighting may recur across splits; this is not a held-out-device or held-out-light study.",
            "DeltaE00 describes successful rows; failure_rate includes every attempted failure.",
            "Not-implemented rows are skipped, counted separately, and never reported as ML results.",
            "Consistency pairs use the same target and whitepoint; they are descriptive and not independent observations.",
        ],
        "metrics": metrics, "consistency": consistency,
    }
    destination = Path(out_dir)
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "benchmark_summary.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    _write_table(destination / "benchmark_metrics.csv", metrics)
    _write_table(destination / "benchmark_consistency.csv", consistency)
    _write_table(destination / "benchmark_samples.csv", rows, CSV_FIELDS + ["delta_e00", "negative_pred_xyz"])
    return report


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--allow-synthetic", action="store_true")
    args = parser.parse_args(argv)
    try:
        report = run_benchmark(args.csv_path, args.out_dir, allow_synthetic=args.allow_synthetic)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps(report, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
