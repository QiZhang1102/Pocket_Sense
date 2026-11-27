"""Local-only research commands. No HTTP service, telemetry, or model download."""
import argparse
import csv
import json
from pathlib import Path
import sys

import numpy as np

from .benchmark import run_benchmark
from .calibration import fit_profile, load_profile, save_profile
from .images import load_image
from .pipeline import analyze_pair
from .reporting import save_benchmark_plot, save_pair_output
from .scene import assess_scene
from .synthetic import generate_experiment


def _json(path):
    result = json.loads(Path(path).read_text(encoding="utf-8-sig"),
                        parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"Nonfinite JSON token {value}")))
    if not isinstance(result, dict):
        raise ValueError("Metadata must be a JSON object.")
    return result


def _output(path):
    path = Path(path)
    if path.exists() and (not path.is_dir() or any(path.iterdir())):
        raise ValueError("Output directory must be new or empty; existing results are never silently overwritten.")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _roi(value):
    try:
        parts = tuple(int(item.strip()) for item in value.split(","))
    except ValueError as error:
        raise argparse.ArgumentTypeError("ROI is x,y,width,height") from error
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("ROI is x,y,width,height")
    return parts


def _fit_csv(path):
    with Path(path).open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        keys = ("r", "g", "b", "x", "y", "z", "split", "session")
        if not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames) or not set(keys).issubset(reader.fieldnames):
            raise ValueError("Calibration CSV requires r,g,b,x,y,z,split,session; XYZ uses Y_white=1.")
        groups = {"train": [], "validation": []}
        sessions = {}
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise ValueError("Calibration CSV has a malformed field count.")
            split, session = row["split"].strip(), row["session"].strip()
            if split not in groups or not session:
                raise ValueError("Calibration rows need train/validation split and a nonempty global session ID.")
            if session in sessions and sessions[session] != split:
                raise ValueError("Calibration train/validation session leakage.")
            sessions[session] = split
            groups[split].append([float(row[key]) for key in keys[:6]])
    if not groups["train"]:
        raise ValueError("No calibration training rows.")
    training = np.asarray(groups["train"])
    heldout = np.asarray(groups["validation"]) if groups["validation"] else None
    return training, heldout


def main(argv=None):
    parser = argparse.ArgumentParser(description="Experimental local color calculations; no precision-accuracy validation is implied.")
    commands = parser.add_subparsers(dest="command", required=True)
    pair = commands.add_parser("pair", help="align and subtract a flash/no-flash pair")
    pair.add_argument("ambient", type=Path)
    pair.add_argument("flash", type=Path)
    pair.add_argument("--metadata", type=Path)
    pair.add_argument("--out", required=True, type=Path)
    pair.add_argument("--alignment", choices=("orb", "ecc", "none"), default="orb")
    pair.add_argument("--mode", choices=("exploratory", "controlled"), default="exploratory")
    pair.add_argument("--color-mode", choices=("chromaticity", "referenced"), default="chromaticity")
    pair.add_argument("--profile", type=Path)
    pair.add_argument("--roi", type=_roi)
    fit = commands.add_parser("fit", help="fit a device profile from linear RGB and reference XYZ")
    fit.add_argument("samples", type=Path)
    fit.add_argument("--metadata", type=Path, required=True)
    fit.add_argument("--out", type=Path, required=True)
    fit.add_argument("--method", choices=("matrix", "root_polynomial"), default="matrix")
    fit.add_argument("--whitepoint", choices=("D65", "D50"), default="D65")
    bench = commands.add_parser("benchmark", help="evaluate supplied XYZ predictions, failures and consistency")
    bench.add_argument("measurements", type=Path)
    bench.add_argument("--out", type=Path, required=True)
    bench.add_argument("--allow-synthetic", action="store_true")
    scene = commands.add_parser("scene", help="deterministic quality indicators and user-declared scene advice")
    scene.add_argument("image", type=Path)
    scene.add_argument("--metadata", type=Path)
    scene.add_argument("--scene", default="unknown")
    synthetic = commands.add_parser("synthetic", help="generate and run explicitly synthetic mathematical fixtures")
    synthetic.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    destination = None
    try:
        if args.command == "pair":
            destination = _output(args.out)
            report, arrays = analyze_pair(args.ambient, args.flash, metadata=_json(args.metadata) if args.metadata else {},
                                          alignment=args.alignment, roi=args.roi, mode=args.mode,
                                          profile=load_profile(args.profile) if args.profile else None, color_mode=args.color_mode)
            save_pair_output(report, arrays, destination)
            print(json.dumps({"accepted": report["accepted"], "report": str(destination / "report.json"),
                              "experimental": True, "source_kind": report["source_kind"]}, allow_nan=False))
            return 0 if report["accepted"] else 2
        if args.command == "fit":
            if args.out.exists():
                raise ValueError("Profile output already exists; choose a new path.")
            training, heldout = _fit_csv(args.samples)
            profile = fit_profile(training[:, :3], training[:, 3:], metadata=_json(args.metadata), method=args.method,
                                  whitepoint=args.whitepoint, validation_rgb=heldout[:, :3] if heldout is not None else None,
                                  validation_xyz=heldout[:, 3:] if heldout is not None else None)
            args.out.parent.mkdir(parents=True, exist_ok=True)
            save_profile(profile, args.out)
            print(json.dumps({"profile": str(args.out), "validation": profile["validation"]}, allow_nan=False))
        elif args.command == "benchmark":
            destination = _output(args.out)
            report = run_benchmark(args.measurements, destination, allow_synthetic=args.allow_synthetic)
            save_benchmark_plot(report, destination)
            print(json.dumps({"rows": report["row_count"], "evidence_label": report["evidence_label"], "out": str(destination)}))
        elif args.command == "scene":
            frame = load_image(args.image, _json(args.metadata) if args.metadata else {})
            print(json.dumps(assess_scene(np.clip(frame.rgb, 0, 1), args.scene), indent=2, allow_nan=False))
        else:
            destination = _output(args.out)
            summary, inputs = generate_experiment(destination)
            save_benchmark_plot(summary, destination / "benchmark")
            report, arrays = analyze_pair(inputs / "ambient.npy", inputs / "flash.npy", metadata=_json(inputs / "pair.json"),
                                          alignment="orb", mode="controlled", profile=load_profile(inputs / "synthetic-profile.json"),
                                          color_mode="referenced")
            save_pair_output(report, arrays, destination / "pair")
            if not report["accepted"]:
                raise ValueError("Synthetic arithmetic fixture ROI was rejected; inspect the quality report.")
            print(json.dumps({"source_kind": "synthetic", "experimental_accuracy_evidence": False,
                              "rows": summary["row_count"], "out": str(destination), "pair_accepted": report["accepted"]}))
        return 0
    except (ValueError, OSError, RuntimeError) as error:
        if destination is not None:
            failure = {"accepted": False, "experimental": True, "error": str(error)}
            if hasattr(error, "report"):
                failure["alignment"] = error.report
            (destination / "rejection.json").write_text(json.dumps(failure, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        print(f"Rejected: {error}", file=sys.stderr)
        return 2
