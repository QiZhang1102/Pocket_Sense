# Flash Calibration Research Lab

**Experimental — Not Validated for Precision Color Measurement.**

This independent Python tool performs actual image import, registration, signed
flash subtraction, masking, ROI statistics, device calibration and evaluation.
It does not replace, import or modify the production Color Sense or pH Sense
algorithms. No service, account, model download or photo upload is required.

See [scientific interpretation and experiments](../../docs/FLASH_CALIBRATION_RESEARCH.md)
and the [native mobile roadmap](../../docs/POCKETSENSE_MOBILE_APP_ROADMAP.md).

## Install and run a reproducible mathematical check

Use Python 3.10 or newer. From this directory, create and activate a virtual
environment using your platform's normal Python workflow, then run:

```sh
python -m pip install ".[raw,test]"
python -m pytest
python -m pocketsense_calibration synthetic --out results/synthetic-01
```

`raw` adds rawpy/LibRaw; omit it if testing only JPEG/PNG/linear NPY. Dependencies
are ordinary numerical packages; there are no pretrained weights or runtime
network requests. `pyproject.toml` records supported dependency ranges. Pin your
resolved environment with `python -m pip freeze` when recording an experiment.
`requirements-validated-py310-windows.txt` records the actual isolated Windows
Python 3.10 environment used for the initial verification; it is an observed
snapshot, not a claim that every platform/dependency combination was tested.

The synthetic command generates floating-point image pairs, runs the **same real
pair pipeline**, fits known camera-response matrices and evaluates five numerical
baselines under two generated devices and lighting settings. It also records an
unimplemented hybrid ML method as skipped, never as a zero-error result. Every
figure/report is labelled synthetic. Exact matrix recovery in this deliberately
linear model is a software check, **not a smartphone measurement or accuracy
improvement claim**. Identical mathematical repetitions are not experimental
replicates. Generated data stays in the ignored `results/` directory.

The output includes `pair/contactsheet.png`, `pair/preview.png`,
`pair/report.json`, `pair/colors.csv`, `pair/signed_difference.npz`, and benchmark
JSON/CSVs plus `benchmark/benchmark.png`. Existing nonempty output directories
are rejected to preserve prior results.

## Process your own pair

```sh
python -m pocketsense_calibration pair data/ambient.dng data/flash.dng \
  --metadata data/pair.json --alignment orb --mode controlled \
  --roi 100,120,80,60 --out results/pair-01
```

Use the same exposure time, ISO, aperture, fixed camera processing and stable
ambient illumination. The sidecar must record actual settings, not the example
values. Start from [pair.example.json](examples/pair.example.json).

- **Compatible Bayer RAW:** rawpy reads visible sensor samples, per-CFA black
  and white levels and the CFA map. The decoder normalizes each site, then forms
  one RGB superpixel from each 2x2 Bayer tile, averaging its two green sites. It
  applies no camera WB, gamma, auto-brightening or display matrix. Only repeating
  RGB Bayer patterns are supported. X-Trans/Foveon/processed computational RAW
  are not assumed compatible; unsupported data is rejected. Exposure and device
  identity must come from the sidecar because rawpy does not expose a complete
  auditable capture contract. No real DNG has yet been independently validated.
- **Linear NPY:** floating HxWx3 values normalized to [0,1], with explicit
  `input_domain=linear_camera_rgb|linear_srgb`. Controlled mode also requires
  `linear_confirmed=true`. These are provenance assertions, not sensor evidence.
- **JPEG/PNG:** ICC conversion to sRGB where a profile exists, then inverse sRGB
  transfer. Unknown camera HDR/tone mapping/WB cannot be undone. These inputs
  are **exploratory only** and cannot enter controlled/referenced color mode.
  Transparent pixels, including PNG palette/tRNS transparency, are excluded.

RAW ROIs use **half-resolution visible sensor coordinates without orientation
rotation**. JPEG/PNG ROIs use decoded coordinates after EXIF orientation. The
entire image is used if `--roi` is omitted. An out-of-bounds ROI is rejected,
not silently cropped. The analysis limit is 16 megapixels after RAW binning.

`orb` uses feature-based partial affine registration with held-out correspondence
checks. `ecc` uses an explicitly constrained Euclidean alternative. Both reject
low texture or failed alignment and record their diagnostics. Choose a method
explicitly; no optical-flow correction silently deforms objects. `none` is only
for externally aligned inputs: controlled mode additionally requires
`alignment_confirmed=true`; the report still labels this manual/unverified.
The geometric model assumes a sufficiently static, approximately planar scene.

`--mode exploratory` is the default, with explicit warnings. Controlled mode
requires linear-source input, capture settings, device/camera, stable-ambient
and fixed-geometry assertions. Known mismatched exposure/ISO/aperture/WB is
rejected in **both** modes, rather than repaired by an unvalidated multiplier.
“Controlled” describes input conditions, not demonstrated measurement accuracy.

## Quality and color outputs

The tool saves signed difference arrays **before display clipping**. Masks
exclude invalid interpolation support, source saturation, substantial negative
differences, insufficient signal and conflicting-edge motion/shadow candidates.
The report contains fractions, accepted-pixel counts, registration diagnostics,
flash contribution, a spatial-signal coefficient of variation and all warnings.
These exclusion thresholds are conservative pilot heuristics, not validated
universal thresholds. A rejected ROI has no color statistics and returns exit 2.

If both normalized per-channel `noise_sigma_ambient` and `noise_sigma_flash`
are supplied, the report estimates subtraction SNR under an explicitly stated
independent-noise approximation. Otherwise SNR is null. A high-frequency
variation proxy is **not** called sensor noise. Texture and reflectance confound
spatial variation; illumination uniformity is not inferred without a declared
uniform target. Surface/flash shadows can also trigger motion candidate masks.

By default output is linear camera/display-domain RGB signal. With a compatible
device profile, default `--color-mode chromaticity` additionally reports xy.
It withholds full XYZ/Lab because unknown intensity scale remains unresolved.

```sh
python -m pocketsense_calibration pair data/a.npy data/f.npy \
  --metadata data/pair.json --profile data/device-profile.json \
  --mode controlled --color-mode referenced --out results/referenced-01
```

Referenced output requires the same device, camera, input domain and recorded
profile capture settings, locked geometry and an identical, specific
`scale_reference` declaration. This must describe a real intensity-normalization
reference or a separately validated fixed arrangement. Matching text cannot
prove physical scale: the report explicitly marks accuracy as unvalidated.
The profile's D50/D65 white and relative `Y_white=1` convention are retained;
there is no automatic chromatic adaptation. Extrapolation beyond calibration
RGB bounds is recorded in JSON. Nonphysical calibrated XYZ is withheld rather
than clipped into a plausible color. Preview native RGB is not standard sRGB.

## Fit/import/export device profiles

```sh
python -m pocketsense_calibration fit data/calibration.csv \
  --metadata data/device.json --method matrix --whitepoint D65 \
  --out data/device-profile.json
```

Use `--method root_polynomial` for the six-term exposure-homogeneous comparator.
CSV header: `r,g,b,x,y,z,split,session`. RGB must be linear in the documented
domain; reference XYZ must be independently characterized under the declared
white and `Y_white=1`. Use `split=train|validation` and globally unique capture
session IDs. The CLI rejects cross-split sessions; the fitting API also rejects
exact duplicate RGB/XYZ rows across training/validation. Neither can audit an
unseen dataset or prove acquisition independence. Training residuals are labelled
as such; held-out data is separate. Rank-deficient/ill-conditioned RGB or XYZ
designs are rejected. A neutral target alone is not full camera calibration.

[device.example.json](examples/device.example.json) describes profile metadata.
Profiles are versioned JSON containing device/camera, acquisition settings,
target, date, input domain, scale reference, whitepoint, coefficients, training
bounds and separate validation diagnostics. `load_profile` validates imported
profiles. A `neutral_correct` Python baseline implements per-channel gains only;
it does not manufacture certified full-color calibration from printer paper.

## Benchmark supplied measurements

```sh
python -m pocketsense_calibration benchmark data/measurements.csv \
  --out results/benchmark-01
```

Use [benchmark-template.csv](examples/benchmark-template.csv). Required fields:

```text
sample_id,method,device,session,lighting,target_id,split,source_kind,whitepoint,pred_x,pred_y,pred_z,ref_x,ref_y,ref_z,processing_ms,status
```

Use `split=train|validation|test`, `source_kind=real|synthetic` and
`status=ok|fail|not_implemented`. Synthetic rows require `--allow-synthetic`.
Failed attempts remain in the failure denominator even when predictions are
missing. Unimplemented methods are explicitly skipped with no invented error.
Successful rows require finite predictions, independent reference values on the
same declared scale, and nonnegative processing time. “Real” is a user label;
the tool does not certify provenance. Signed nonphysical XYZ is flagged.

Summary outputs include mean/median/95th-percentile DeltaE00, failure rate,
processing-time summaries, counts, and same-target pairwise cross-lighting and
cross-device differences. Partitions and whitepoints stay separate. Consistency
is not accuracy; shared-sample pairs are not independent observations. The table
must not reuse a session or sample across splits. Device/light IDs may recur;
this does not establish held-out-device/light generalization. The evaluator
cannot detect external model-training leakage. Record exclusion decisions and
evaluate common captures as well as each method's overall acceptance rate.

## Scene advice and future ML

```sh
python -m pocketsense_calibration scene data/photo.png --scene screen
```

Supported declarations: paper, test_strip, skin, fabric, wall, screen, glossy,
transparent, general and unknown. **There is no automatic semantic classifier.**
Rule-based image indicators and explicit declarations produce conditions,
abstentions and recommendations. Screens are emissive; glossy/transparent
surfaces need another capture strategy, so the pair command refuses those modes.
Unknown scenes remain exploratory. Skin advice never performs diagnosis.

No learned residual or end-to-end predictor is trained without suitable true
measurements. Candidate models, license questions, mobile CPU evaluation and
future staged acquisition work are documented, not presented as implemented AI.

## Data and release boundaries

Keep photos, RAWs, arrays and identifying metadata in private `data/` or ignored
output directories. Do not force-add these to Git. No reference datasets or
private images are included. A plot of synthetic values is not experimental
evidence. Reproduce the software checks, then collect the independent sessions,
characterized targets and actual device captures required by the research plan.
The optional website lab is deferred: the existing offline site is unchanged.
