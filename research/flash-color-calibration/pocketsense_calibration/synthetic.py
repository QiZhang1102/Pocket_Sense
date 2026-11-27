"""Deterministic algebra fixtures. These are not smartphone measurements."""
import csv
import json
from pathlib import Path
from time import perf_counter

import numpy as np

from .benchmark import CSV_FIELDS, run_benchmark
from .calibration import apply_profile, fit_profile, neutral_correct, save_profile
from .colorimetry import linear_srgb_to_xyz


def capture_metadata():
    settings = {"exposure_s": 0.01, "iso": 100, "aperture": 1.8, "white_balance": "raw_not_applied"}
    return {
        "schema_version": 1, "device": "synthetic-device-A", "camera": "synthetic-camera",
        "input_domain": "linear_camera_rgb", "scene": "paper", "source_kind": "synthetic",
        "ambient": {**settings, "flash": False}, "flash": {**settings, "flash": True},
        "ambient_stable": True, "geometry_locked": True, "alignment_confirmed": True,
        "linear_confirmed": True, "scale_reference": "synthetic-unit-flash-fixed-geometry",
        "noise_sigma_ambient": [0.0005] * 3, "noise_sigma_flash": [0.0005] * 3,
    }


def _profile_metadata(device, settings):
    return {"device": device, "camera": "synthetic-camera", "input_domain": "linear_camera_rgb",
            "capture_settings": {key: settings[key] for key in ("exposure_s", "iso", "aperture", "white_balance")},
            "target": "generated linear-sRGB coordinates, not a certified physical target", "date": "2026-11-26",
            "scale_reference": "synthetic-unit-flash-fixed-geometry", "source_kind": "synthetic"}


def generate_experiment(out_dir):
    """Create one actual paired-image calculation and a tabular method comparison.

    The model is linear, noiseless in the comparison table and deliberately
    matches the fitted matrix hypothesis. Near-zero errors are algebra checks,
    never predictions of physical device performance. No learned ML row runs.
    """
    out = Path(out_dir)
    inputs = out / "inputs"
    inputs.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(20261126)
    responses = [np.array([[0.9, 0.05, 0.02], [0.04, 1.08, 0.03], [0.03, 0.05, 0.84]]),
                 np.array([[1.08, 0.03, 0.04], [0.02, 0.89, 0.04], [0.04, 0.02, 1.03]])]
    from itertools import product
    # Include bounding corners so held-out colors are interpolation, not silent extrapolation.
    training = np.vstack((np.array(list(product((0.03, 0.7), repeat=3))), rng.uniform(0.04, 0.68, (28, 3))))
    testing = rng.uniform(0.06, 0.58, (20, 3))
    truth = linear_srgb_to_xyz(testing)
    meta = capture_metadata()
    profile = fit_profile(training @ responses[0], linear_srgb_to_xyz(training),
                          metadata=_profile_metadata(meta["device"], meta["flash"]),
                          validation_rgb=testing @ responses[0], validation_xyz=truth)
    save_profile(profile, inputs / "synthetic-profile.json")
    (inputs / "device.json").write_text(json.dumps(_profile_metadata(meta["device"], meta["flash"]), indent=2) + "\n", encoding="utf-8")
    with (inputs / "calibration.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(["r", "g", "b", "x", "y", "z", "split", "session"])
        for split, latent in (("train", training), ("validation", testing)):
            for camera_rgb, xyz in zip(latent @ responses[0], linear_srgb_to_xyz(latent)):
                writer.writerow([*camera_rgb, *xyz, split, f"synthetic-profile-{split}-session"])
    # A textured image tests arithmetic, masks, and the real registration code.
    texture = rng.uniform(0.5, 1.0, (160, 224, 1)).astype(np.float32)
    target = np.array([0.25, 0.36, 0.19], dtype=np.float32) * texture
    signal = target @ responses[0]
    ambient = target * np.array([0.22, 0.13, 0.3]) @ responses[0]
    flashed = ambient + signal
    ambient += rng.normal(0, 0.0005, ambient.shape)
    flashed += rng.normal(0, 0.0005, flashed.shape)
    np.save(inputs / "ambient.npy", ambient.astype(np.float32))
    np.save(inputs / "flash.npy", flashed.astype(np.float32))
    (inputs / "pair.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    rows = []
    for device_index, response in enumerate(responses):
        device = f"synthetic-device-{'AB'[device_index]}"
        calibration = fit_profile(training @ response, linear_srgb_to_xyz(training),
                                  metadata=_profile_metadata(device, meta["flash"]))
        for lighting_index, ambient_light in enumerate(([0.2, 0.12, 0.3], [0.1, 0.32, 0.16])):
            for repetition in range(2):
                camera = testing @ response
                ambient_camera = (testing * ambient_light) @ response
                observed = camera + ambient_camera
                reference_model = fit_profile((training * (1 + np.asarray(ambient_light))) @ response,
                                              linear_srgb_to_xyz(training),
                                              metadata=_profile_metadata(device, meta["flash"]))
                neutral = (np.full(3, 0.3) * (1 + np.asarray(ambient_light))) @ response
                methods = {
                    "uncorrected": lambda: linear_srgb_to_xyz(observed),
                    "neutral_white_balance": lambda: linear_srgb_to_xyz(neutral_correct(observed, neutral)),
                    "reference_matrix": lambda: apply_profile(observed, reference_model),
                    "flash_subtraction_nominal_srgb": lambda: linear_srgb_to_xyz(observed - ambient_camera),
                    "flash_device_matrix": lambda: apply_profile(observed - ambient_camera, calibration),
                }
                for method, calculate in methods.items():
                    start = perf_counter()
                    predictions = calculate()
                    elapsed = (perf_counter() - start) * 1000 / len(testing)
                    for index, (predicted, reference) in enumerate(zip(predictions, truth)):
                        rows.append({"sample_id": f"{device}-{lighting_index}-{repetition}-{index}",
                                     "method": method, "device": device,
                                     "session": f"{device}-heldout-{lighting_index}-{repetition}",
                                     "lighting": f"synthetic-light-{lighting_index}", "target_id": f"generated-color-{index}",
                                     "split": "test", "source_kind": "synthetic", "whitepoint": "D65",
                                     **dict(zip(("pred_x", "pred_y", "pred_z"), predicted)),
                                     **dict(zip(("ref_x", "ref_y", "ref_z"), reference)),
                                     "processing_ms": elapsed, "status": "ok"})
    rows.append({key: "" for key in CSV_FIELDS} | {
        "sample_id": "unimplemented-hybrid", "method": "hybrid_ml", "device": "synthetic-device-A",
        "session": "synthetic-skipped", "lighting": "synthetic", "target_id": "not-measured", "split": "test",
        "source_kind": "synthetic", "whitepoint": "D65", "status": "not_implemented"})
    measurements = out / "synthetic-measurements.csv"
    with measurements.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    summary = run_benchmark(measurements, out / "benchmark", allow_synthetic=True)
    summary["fixture_design"] = "known linear model, fixed unit flash scale, no physical cameras; repetitions are deterministic, not independent measurements"
    (out / "fixture-description.json").write_text(json.dumps({
        "source_kind": "synthetic", "seed": 20261126,
        "purpose": "verify algebra, import/CLI, fitting and evaluation plumbing, not physical accuracy",
        "training_colors": len(training), "heldout_colors": len(testing), "synthetic_devices": 2,
        "synthetic_lighting_conditions": 2, "repetitions": "identical mathematical repetitions, not statistical replicates",
        "timing": "only batched method computation divided by batch length; excludes capture/import/registration",
        "no_claim": "No phone, certified target, pH strip, buffer solution or real-world measurement was used."
    }, indent=2) + "\n", encoding="utf-8")
    return summary, inputs
