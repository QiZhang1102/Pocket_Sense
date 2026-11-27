"""Local artifact export with explicit experimental/provenance labels.

Display clipping and transfer functions never alter the saved numerical arrays.
Missing calibrated coordinates remain missing; export does not infer them.
"""

import csv
import json
from pathlib import Path
from textwrap import fill

from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure
import numpy as np


_IMAGE_KEYS = ("ambient", "ambient_aligned", "flash", "signed_difference")
_MASK_KEYS = ("valid_mask", "roi_mask", "overlap_mask", "saturation_mask",
              "negative_excluded_mask", "low_signal_mask", "motion_or_shadow_mask")


def _json_value(value):
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    if isinstance(value, np.ndarray):
        return _json_value(value.tolist())
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, Path):
        return str(value)
    return value


def _validate_arrays(arrays):
    missing = set(_IMAGE_KEYS + _MASK_KEYS + ("transform",)) - set(arrays)
    if missing:
        raise ValueError("Missing output arrays: " + ", ".join(sorted(missing)))
    ambient = np.asarray(arrays["ambient"])
    if ambient.ndim != 3 or ambient.shape[2] != 3 or min(ambient.shape[:2]) < 1:
        raise ValueError("ambient must have nonempty HxWx3 dimensions")
    shape = ambient.shape
    converted = {}
    for name, source in arrays.items():
        value = np.asarray(source)
        if value.dtype.kind not in "buif" or not np.isfinite(value).all():
            raise ValueError(f"{name} must contain finite numeric or boolean samples")
        if name in _IMAGE_KEYS and value.shape != shape:
            raise ValueError(f"{name} must match ambient HxWx3 shape")
        if name in _MASK_KEYS and value.shape != shape[:2]:
            raise ValueError(f"{name} must have matching HxW shape")
        if name == "transform" and value.shape != (3, 3):
            raise ValueError("transform must be 3x3")
        converted[name] = value
    return converted


def _display_rgb(linear):
    # A display convention only, including for native-camera channels. This is
    # not a native-camera-to-sRGB calibration or a measured-reflectance image.
    clipped = np.clip(np.asarray(linear, dtype=np.float64), 0, 1)
    return np.where(clipped <= 0.0031308, 12.92 * clipped,
                    1.055 * clipped ** (1 / 2.4) - 0.055)


def _evidence_label(source_kind):
    if source_kind == "synthetic":
        return "Synthetic math fixture — not accuracy validation"
    if source_kind == "real":
        return "Real-labelled inputs — provenance and accuracy unverified"
    return "Unverified capture — not accuracy validation"


def _rgb_label(report):
    domain = report.get("color", {}).get("domain", "unspecified")
    if domain == "linear_camera_rgb":
        return "Native RGB preview — not standard color"
    if domain == "linear_srgb":
        return "Linear sRGB preview — display clipping/transfer only"
    return "Unspecified RGB preview — not standard color"


def _figure(width, height):
    result = Figure(figsize=(width, height), dpi=130)
    FigureCanvasAgg(result)
    return result


def _save_figure(figure, path):
    figure.savefig(path, dpi=130, facecolor="white")
    figure.clear()


def _triplet_fields(row, color, key, labels):
    value = color.get(key)
    if value is None:
        row.update({name: "" for name in labels})
        return
    array = np.asarray(value, dtype=np.float64)
    if array.shape != (len(labels),) or not np.isfinite(array).all():
        raise ValueError(f"color.{key} has invalid coordinates")
    row.update({name: float(channel) for name, channel in zip(labels, array)})


def _color_row(report):
    color = report.get("color", {})
    capture = report.get("capture_assertions", {})
    row = {
        "experimental": True,
        "source_kind": report.get("source_kind", "unverified_capture"),
        "accepted": report.get("accepted", ""),
        "device": capture.get("device", ""), "camera": capture.get("camera", ""),
        "mode": report.get("mode", ""), "color_mode": report.get("color_mode", ""),
        "domain": color.get("domain", ""), "whitepoint": color.get("whitepoint") or "",
    }
    _triplet_fields(row, color, "linear_difference_rgb_mean", ("linear_mean_R", "linear_mean_G", "linear_mean_B"))
    _triplet_fields(row, color, "linear_difference_rgb_median", ("linear_median_R", "linear_median_G", "linear_median_B"))
    _triplet_fields(row, color, "xy", ("x_chromaticity", "y_chromaticity"))
    _triplet_fields(row, color, "xyz_relative", ("relative_X", "relative_Y", "relative_Z"))
    _triplet_fields(row, color, "lab", ("Lab_L", "Lab_a", "Lab_b"))
    return row


def save_pair_output(report: dict, arrays: dict, out_dir: Path) -> None:
    """Write strict JSON, existing ROI coordinates, signed arrays and previews.

    No image is uploaded. The NPZ stores all supplied arrays without display
    clipping, rescaling or RGB conversion. UTF-8 preserves user metadata.
    """
    # Validate and serialize before leaving partially written scientific data.
    serializable = _json_value(report)
    encoded = json.dumps(serializable, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    packed = _validate_arrays(arrays)
    row = _color_row(serializable)
    destination = Path(out_dir)
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "report.json").write_text(encoded, encoding="utf-8")
    with (destination / "colors.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(row))
        writer.writeheader()
        writer.writerow(row)
    np.savez_compressed(destination / "signed_difference.npz", **packed)

    evidence = _evidence_label(serializable.get("source_kind"))
    rgb_label = _rgb_label(serializable)
    accepted = "ROI accepted by prototype heuristics" if serializable.get("accepted") else "ROI rejected / no valid color claim"
    positive_preview = _display_rgb(packed["signed_difference"])

    preview = _figure(7, 6)
    axis = preview.add_subplot(111)
    axis.imshow(positive_preview)
    axis.set_title("Difference display (negative values retained in NPZ)", fontsize=10)
    axis.axis("off")
    preview.suptitle("Experimental\n" + evidence, fontsize=12, fontweight="bold")
    preview.text(0.5, 0.025, rgb_label + "\n" + accepted, ha="center", fontsize=8)
    preview.subplots_adjust(top=0.82, bottom=0.12)
    _save_figure(preview, destination / "preview.png")

    exclusions = ~packed["valid_mask"].astype(bool)
    for name in ("saturation_mask", "negative_excluded_mask", "low_signal_mask", "motion_or_shadow_mask"):
        exclusions = exclusions | packed[name].astype(bool)
    contact = _figure(12, 8)
    panels = [
        ("Ambient", _display_rgb(packed["ambient"]), None),
        ("Flash + ambient", _display_rgb(packed["flash"]), None),
        ("Ambient aligned to flash", _display_rgb(packed["ambient_aligned"]), None),
        ("Difference display (positive portion only)", positive_preview, None),
        ("Valid support (white = valid)", packed["valid_mask"], "gray"),
        ("Exclusions (white = excluded)", exclusions, "gray"),
    ]
    for index, (title, data, cmap) in enumerate(panels, 1):
        axis = contact.add_subplot(2, 3, index)
        axis.imshow(data, cmap=cmap, vmin=0, vmax=1)
        axis.set_title(title, fontsize=9)
        axis.axis("off")
    contact.suptitle("Experimental\n" + evidence, fontsize=13, fontweight="bold")
    contact.text(0.5, 0.025, rgb_label + " | Display scaling is not calibration\n" + accepted,
                 ha="center", fontsize=8)
    contact.subplots_adjust(left=0.03, right=0.97, top=0.83, bottom=0.10, wspace=0.08, hspace=0.18)
    _save_figure(contact, destination / "contactsheet.png")


def save_benchmark_plot(summary, out_dir) -> None:
    """Plot supplied metrics in separate provenance/split/reference panels.

    Missing/skipped methods get no invented zero bar. Real-labelled input data
    is not reclassified as independently verified experimental evidence.
    """
    metrics = summary.get("metrics")
    if not isinstance(metrics, list):
        raise ValueError("summary.metrics must be a list")
    groups = {}
    for record in metrics:
        if not isinstance(record, dict) or not record.get("method"):
            raise ValueError("Each metric record requires a method")
        key = (str(record.get("source_kind", "unspecified")), str(record.get("split", "unspecified")),
               str(record.get("whitepoint", "declared reference")), str(record.get("partition", "")))
        group = groups.setdefault(key, [])
        if any(other["method"] == record["method"] for other in group):
            raise ValueError("Duplicate method within a benchmark partition; do not combine incompatible summaries")
        for field in ("mean_delta_e00", "median_delta_e00", "p95_delta_e00"):
            value = record.get(field)
            if value is not None and (not np.isfinite(float(value)) or float(value) < 0):
                raise ValueError(f"{field} must be finite, nonnegative or null")
        group.append(record)
    if not groups:
        groups[("unspecified", "unspecified", "declared reference", "")] = []
    figure = _figure(11, 1.7 + 4.3 * len(groups))
    figure.suptitle("Experimental benchmark — supplied computed statistics\nPartitions shown separately; not independent accuracy validation",
                    fontsize=12, fontweight="bold")
    for panel, (key, records) in enumerate(sorted(groups.items()), 1):
        source_kind, split, whitepoint, partition = key
        axis = figure.add_subplot(len(groups), 1, panel)
        records = sorted(records, key=lambda row: str(row["method"]))
        positions = np.arange(len(records))
        fields = (("mean_delta_e00", "Mean", "#3a7c7b"),
                  ("median_delta_e00", "Median", "#cf963b"),
                  ("p95_delta_e00", "95th percentile", "#7a649b"))
        any_data = False
        for index, (field, label, color) in enumerate(fields):
            available = [(position, record[field]) for position, record in zip(positions, records)
                         if record.get(field) is not None]
            if available:
                xs, ys = zip(*available)
                axis.bar(np.asarray(xs) + (index - 1) * 0.24, [float(y) for y in ys],
                         width=0.23, label=label, color=color)
                any_data = True
        if any_data:
            axis.legend(loc="upper right", fontsize=8)
        else:
            axis.text(0.5, 0.5, "No eligible successful rows — no numerical bars", ha="center", transform=axis.transAxes)
        labels = [fill(str(record["method"]).replace("_", " "), width=22) +
                  ("\nNot implemented / skipped" if record.get("n_attempted") == 0 and record.get("n_skipped", 0) > 0
                   else f"\n{record.get('n_success', '?')}/{record.get('n_attempted', '?')} successful")
                  for record in records]
        axis.set_xticks(positions, labels, rotation=0, ha="center", fontsize=8)
        axis.set_ylabel("Delta E00 on successful rows")
        detail = "Training fit residuals only" if split == "train" else "Descriptive supplied rows; provenance unverified"
        title = f"{source_kind} | {split} | {whitepoint}" + (f" | {partition}" if partition else "")
        axis.set_title(title + "\n" + _evidence_label(source_kind) + "\n" + detail, fontsize=9)
        axis.set_ylim(bottom=0)
        axis.grid(axis="y", alpha=0.2)
        axis.set_axisbelow(True)
    figure.subplots_adjust(left=0.09, right=0.97, top=1 - 1.0 / (1.7 + 4.3 * len(groups)),
                           bottom=0.18, hspace=1.0)
    destination = Path(out_dir)
    destination.mkdir(parents=True, exist_ok=True)
    _save_figure(figure, destination / "benchmark.png")
