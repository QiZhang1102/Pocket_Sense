# Flash color calibration: research and experimental prototype

**Research status: experimental; no physical-phone accuracy claim.**

This work investigates whether controlled illumination and explicit device calibration improve PocketSense measurements. The prototype lives in `research/flash-color-calibration/`; it is separate from the production Color Sense and pH Sense engines. The [prototype README](../research/flash-color-calibration/README.md) describes executable commands and file formats. The [mobile roadmap](POCKETSENSE_MOBILE_APP_ROADMAP.md) covers future acquisition software. This document defines the scientific interpretation, evidence, and physical validation still required.

The difference between a flash image and an ambient image is a **flash-induced camera signal** under stated acquisition assumptions. It is neither an automatic measurement of surface reflectance nor an absolute color standard. Successful synthetic tests establish software behavior; they do not establish measurement accuracy on a phone.

## 1. Evidence and literature

### 1.1 Nixon et al., 2020

Nixon and colleagues combine ambient subtraction with calibration of each physical phone. They analyze linear RAW responses, keep exposure time and ISO fixed within a pair, and require stable ambient illumination. A colorcard and a separate grey-card capture establish a device-specific mapping to D50 XYZ; routine outputs use xy chromaticity to remove unknown intensity scaling. This removes a brightness dimension, so the paper does not establish unrestricted full-Lab measurement. Four phones from two models were evaluated under particular conditions. Its empirical SSNR threshold of 3.4 and classification results are evidence for that experiment, not acceptance thresholds for PocketSense. Application-specific calibration cards were also investigated. The useful transferable idea is a constrained acquisition-and-calibration workflow, followed by independent testing. The paper does not show that arbitrary JPEG subtraction, an uncalibrated camera, or a learned scene label recovers physical color. [Primary article](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0230561)

### 1.2 Flash/no-flash computational photography

Petschnigg et al. use image pairs for denoising, detail transfer, white balancing, and related photographic improvements. Eisemann and Durand combine flash detail with ambient appearance and explicitly handle flash shadows. These are important precedents for pair processing and artifact detection. Their attractive reconstructed photographs are not a calibration target or evidence of traceable colorimetric accuracy. PocketSense must keep any display-enhancement image separate from numerical measurement arrays. [Petschnigg et al., author-hosted paper](https://www.microsoft.com/en-us/research/wp-content/uploads/2004/08/Petschnigg-SG04.pdf), [Eisemann and Durand, author project](https://people.csail.mit.edu/fredo/PUBLI/flash/index.htm)

### 1.3 Deterministic and learned color correction

Finlayson et al. explain that ordinary polynomial features change nonuniformly with exposure. Root-polynomial features preserve homogeneous exposure scaling while allowing a richer mapping than a 3-by-3 matrix. This motivates the prototype's root-polynomial comparator; it does not remove the need for characterized targets or representative held-out spectra. [Author manuscript](https://ueaeprints.uea.ac.uk/id/eprint/52673/1/root_polynomial_accepted_preprint2.pdf)

Kucuk et al. compare classical regressions with neural color correction, including exposure changes and cross-dataset tests. Their tested neural approach did not consistently beat the stronger regression baselines. Dataset shift changed the ranking of classical methods too. Consequently, PocketSense should compare against a competent linear and, where justified, root-polynomial baseline before adding a learned residual. Those findings concern their sensor/spectral experiments; they predict no numerical improvement for this prototype. [Primary article](https://www.mdpi.com/2313-433X/9/10/214)

FC4 predicts illumination through confidence-weighted pooling of image regions. Its task is learned color constancy, not measurement of a material's reflectance spectrum or certified XYZ. A future comparison would require matching its RAW preprocessing, measuring behavior on unseen PocketSense devices and scenes, and reporting failures. [CVPR paper](https://openaccess.thecvf.com/content_cvpr_2017/html/Hu_FC4_Fully_Convolutional_CVPR_2017_paper.html)

### 1.4 Public data that was actually inspected

The Harvard Dataverse metadata API for [Nixon's accompanying dataset](https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/JJRH4N) was inspected on 26 November 2026. Released version 1.0 lists:

| File | Published content |
| --- | --- |
| `SubtractionData_Figure3.tab` | Tabular data associated with the subtraction figure |
| `SSNRData_Figure5.tab` | Tabular data associated with the SSNR figure |
| `CAMPData_Figure6.tab` | Tabular classification-figure data |
| `CAMPData_Figure7.tab` | Tabular custom-card classification-figure data |

No paired RAW images are listed in that release. These tables can support a separate figure-reproduction exercise; they cannot exercise this prototype's RAW decoder, registration, masks, or real-image subtraction. No image dataset or pretrained model was downloaded as part of this source review. [Dataset metadata API](https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId=doi:10.7910/DVN/JJRH4N)

## 2. Measurement contract

### 2.1 Image formation and subtraction

For a fixed linear camera response, write the ambient frame as `A` and the frame with ambient plus flash as `B`. The operational model is:

```text
A = ambient camera signal + noise_A
B = ambient camera signal + flash camera signal + noise_B
D = B - A
```

The approximation requires the same subject, compatible camera processing, stable illumination between frames, matched exposure and gain, and valid correspondence. The flash spectrum and geometry must also be compatible with the calibration profile. LED flicker, rolling-shutter bands, motion, scene changes, flash shadows, and changing flash power can violate these conditions.

A useful physical interpretation is that each sensor channel integrates the product of illumination, material response, camera spectral sensitivity, and geometry. Subtraction can remove an unchanged additive ambient contribution. Three resulting channel values still cannot uniquely determine a complete reflectance spectrum. Fluorescence, specular reflection, translucency, and self-emission require additional care; a generic material label does not resolve them.

The first prototype should reject incompatible pairs rather than silently estimate a correction for arbitrary exposure changes. Multiplying one processed frame by the exposure-time ratio is not a validated repair for all flash, gain, HDR, or tone-mapping differences.

### 2.2 Three different RGB meanings

Keep these quantities explicitly named in files and reports:

1. **Encoded display RGB:** rendered JPEG/PNG channels, possibly altered by an unknown camera pipeline and image profile.
2. **Linear display RGB approximation:** inverse-transfer-decoded channels under an explicitly stated sRGB assumption. This does not undo local tone mapping or recover clipped samples.
3. **Linear camera RGB:** sensor-derived channels after documented black-level and normalization operations, without an undocumented display-color conversion.

A device profile fitted in one of these domains must not be applied to another. In particular, the production sRGB-to-D65-Lab transform is not a calibration of native RAW channels. Applying it directly to a flash difference would give numbers with the wrong interpretation.

### 2.3 Chromaticity and the missing scale

A matrix can map a camera response vector `r` to an estimated XYZ vector, `q = r M`, with the profile's declared reference conditions. If the observation has an unknown common multiplicative factor `k`, then `q` has that factor too. Chromaticity removes it:

```text
x = X / (X + Y + Z)
y = Y / (X + Y + Z)
```

The denominator must be finite and positive. Do not silently create values for a zero, negative, saturated, or otherwise invalid signal.

The report distinguishes:

| Result mode | Permitted interpretation |
| --- | --- |
| No compatible profile | Camera/display-domain signal statistics and quality diagnostics only |
| Compatible profile, unknown intensity scale | Estimated xy chromaticity; any intermediate XYZ is proportional, not a full-color measurement |
| Compatible profile with a matching declared scale and acquisition/reference conditions | Relative XYZ and CIELAB under the declared reference white; associated color differences may be evaluated |

Full-color output requires more than naming D50 or D65. The profile must document what fixes scale, for example a measured white/grey standard in the same geometry, or a genuinely validated fixed acquisition and illumination arrangement. A user declaration records an assumption; it does not prove that the scene met it. Arbitrarily setting every sample to the same Y may be useful for a separate chromaticity visualization, but that result must not be presented as measured full Lab or ordinary full-color Delta E.

RGB for preview/export must be identified as a display rendering with a stated transfer function and any gamut clipping. Preserve numerical pre-rendering values separately.

### 2.4 Accuracy, repeatability, and reproducibility

**Accuracy** asks how close a result is to an independent reference under the same declared colorimetric conditions. **Repeatability** asks how much repeated captures vary under a specified fixed setup. **Cross-lighting or cross-device reproducibility** asks how much results change when those factors change. Report each separately. A system that always produces the same grey is consistent and inaccurate.

A mean error alone can conceal poor conditions and exclusions. Report the median, 95th percentile, signed component bias where appropriate, failure rate, and the number of independent sessions/devices. For chromaticity-only results, use an explicitly named chromaticity distance rather than fabricating a missing lightness value to calculate Delta E00.

## 3. Prototype behavior and safeguards

The executable implementation and its tests are the authority for currently supported options. The following interfaces are isolated from the website; final executed-test evidence is recorded in section 7.

| Prototype capability | Implemented interface | Scientific status |
| --- | --- | --- |
| Paired image import, registration, difference, masks and ROI report | `pocketsense-calibration pair` | Real image-array processing; phone accuracy unmeasured |
| Matrix and second-order root-polynomial fitting; profile export/import | `pocketsense-calibration fit` | Fit residuals are distinguished from supplied validation rows; physical independence needs external provenance |
| Metric summaries, grouped comparisons and graphics | `pocketsense-calibration benchmark` | Input measurements/provenance determine validity; synthetic rows require explicit opt-in |
| Deterministic quality statistics and declared-scene advice | `pocketsense-calibration scene` | No automatic object/material recognition or trained model |
| Known mathematical pairs and method comparison fixtures | `pocketsense-calibration synthetic` | Explicitly synthetic; no physical phone or real accuracy claim |
| Native capture, semantic ML, residual ML, public web integration | No current implementation | Deferred experiments |

Representative CLI calls after the installation described in the prototype README:

```sh
pocketsense-calibration pair ambient.npy flash.npy --metadata pair.json --alignment ecc --roi 20,20,80,80 --mode controlled --out results/pair
pocketsense-calibration fit samples.csv --metadata device.json --method matrix --out profile.json
pocketsense-calibration fit samples.csv --metadata device.json --method root_polynomial --out root-profile.json
pocketsense-calibration pair ambient.npy flash.npy --metadata pair.json --profile profile.json --color-mode chromaticity --mode controlled --out results/calibrated-pair
pocketsense-calibration benchmark measurements.csv --out results/benchmark
pocketsense-calibration scene screen.png --scene screen
pocketsense-calibration synthetic --out generatedfixtures
```

The filenames/ROI in these commands are examples, not supplied physical measurements. Use `--color-mode referenced` only with a compatible scale declaration and locked geometry; the default is `chromaticity`. `--mode controlled` describes the required acquisition assertions and linear input, not experimental validation. JPEG/PNG remain `exploratory`. The `synthetic` command produces mathematical fixtures explicitly; it does not simulate a research result and must not be relabeled as a phone experiment.

Pair output includes a JSON report, ROI CSV, signed difference/aligned arrays and validity masks in NPZ, preview PNGs, and an inspection contact sheet. Numerical arrays retain measurement-domain values; previews are display renderings. Originals remain local and no image upload is needed. Detailed option and CSV schemas are maintained with the code in the prototype README.

### 3.1 Import and linear processing

- Retain source filenames/hashes, input domain, decoder version, dimensions, camera identification, and available acquisition metadata in the report. Do not collect unrelated personal metadata.
- RAW handling uses optional `rawpy` decoding and a restricted Bayer 2-by-2 superpixel path: subtract/normalize the declared channel black/white levels, retain red and blue, and average the two green positions. It applies no white balance, camera-to-display matrix or gamma. This sacrifices spatial resolution and is not a general full-resolution demosaicer. Unsupported mosaics/metadata must fail explicitly. A `.dng` suffix by itself is insufficient evidence of an untouched, linear sensor signal.
- Preserve the relation between the pair. Independently rescaling each frame by its own maximum destroys the subtraction model.
- JPEG/PNG processing remains exploratory unless the complete rendering process is characterized. A PNG container can contain rendered nonlinear data too. State the sRGB assumption when used; unsupported profiles must not become silent claims of calibration.
- Detect saturation using the original valid range before subtraction. Rejected and clipped samples remain visible in the quality record.

The prototype also accepts linear `.npy` arrays with a declared domain. A sidecar records `device`, `camera`, per-frame `exposure_s`, `iso`, `aperture`, `white_balance`, and `flash`, plus `ambient_stable` and `geometry_locked` assertions. Optional `input_domain`, `scale_reference`, and three-channel `noise_sigma_ambient`/`noise_sigma_flash` describe processing/scale and an explicitly supplied noise model. RAW exposure/ISO compatibility currently relies on that sidecar; automatic extraction and independent verification of every phone's capture metadata are not claimed. Do not omit or guess acquisition settings to force a pair through controlled mode.

### 3.2 Registration

The CLI offers ORB-based, ECC-based, or explicitly disabled registration. Begin with a static, approximately planar target and the supported model; inspect the reported transform and overlap. A successful optimizer return code is not sufficient evidence of correct correspondence. Report available registration diagnostics and residuals against independent landmarks when available. Inspect moving edges and newly revealed regions.

Use a common validity mask and exclude warped borders and interpolation-contaminated edges from measurement. A more flexible warp can produce a visually pleasing result while changing the signal being measured. Dense optical flow, deformable materials, and automatic registration of difficult natural scenes remain future experiments unless separately implemented and evaluated.

### 3.3 Difference, ROI, and display

Keep a floating-point, signed difference array. Report negative-channel/pixel fractions before any visualization clipping. Negative values can indicate noise, correspondence error, changed ambient light, or invalid preprocessing. They must not be silently converted into a valid color sample.

Numerical ROI summaries use only the recorded common valid mask and the report's declared statistic. Preserve raw and processed ROI values and the count/fraction retained. Visual difference images may be scaled for inspection, but their display scale is not calibration data.

### 3.4 Quality report interpretation

| Indicator | What must be recorded | Limitation |
| --- | --- | --- |
| Acquisition compatibility | Known exposure/gain/device/domain mismatches and missing metadata | Missing data cannot establish a match |
| Alignment | Chosen model, solver status, overlap and available residuals | Photometric change can confuse similarity scores |
| Saturation/clipping | Fraction from each original frame and joint exclusion | A post-subtraction image alone cannot reveal original clipping |
| Negative difference | Per-channel and/or per-pixel rate before clipping | A universal acceptable rate is not established |
| Flash contribution | Explicitly defined signal comparison | Ratios are unstable near a zero ambient signal |
| Noise/SNR | Formula, input units, aggregation and assumptions | A single pair cannot identify every noise component |
| Spatial variation | Statistic and the ROI/target on which it was calculated | Unknown object texture is not a measurement of illumination uniformity |
| Exclusion | Reasons, masks, counts, and remaining support | Accuracy on accepted records must be reported with rejection rate |

For an engineering noise model, independent frame variances add on subtraction: `Var(D) = Var(B) + Var(A)`. A shot-noise-only proxy calculated from normalized channel values is not a calibrated electron-domain SNR. Scaling the input changes that proxy, so its threshold must be evaluated for the declared data representation and device. Read noise, gain, demosaicing, and registration introduce additional uncertainty. Calibrate quality gates on repeated real captures with a locked held-out set; do not import a literature threshold as a guarantee.

### 3.5 Scene and mode selection

The implemented scene interface uses an explicit user-selected material/mode plus deterministic quality warnings. It includes `unknown`; it does not infer a label. Suggested categories should never authorize a physical interpretation on their own.

- **Matte paper / test strips:** use a compatible reference protocol, avoid glare and respect timing.
- **Painted walls / fabric:** consider texture, directionality, shading, gloss, and a separately characterized sample catalog if matching is later added.
- **Skin:** require a standardized nonclinical capture protocol and consented data handling; no medical diagnosis or lesion score.
- **Screens:** treat emission, brightness/refresh/PWM, exposure, moire, and reflected flash as a separate problem. Subtraction is not automatically a screen-color measurement mode.
- **Glossy/metallic/transparent objects:** warn about specular, transmitted, or geometry-dependent signal and permit an unsupported result.

## 4. Calibration and fair method comparisons

### 4.1 Profile contents

A usable exported profile needs a schema version, actual device/camera identity, input/processing domain, mapping method and coefficients, target and patch provenance, reference illuminant/observer/white, scale interpretation, capture geometry/settings, calibration date, fit diagnostics, and independent validation provenance. Fields unavailable in a prototype must remain unknown rather than acquiring invented defaults.

The implementation fits a 3-by-3 matrix or a second-order root-polynomial mapping using least squares with rank/conditioning guards. A neutral-only correction is a separate diagonal-gain baseline, not full color calibration. Ordinary printer paper is not a certified white standard. A numerical root-polynomial fit can run on fixtures now; a scientific comparison still needs enough independent training colors and genuinely held-out evaluation. Ordinary higher-order polynomial experiments remain deferred.

Profile loading must validate domain, matrix dimensions, finite values, identity/conditions, and scale interpretation. A profile's metadata cannot itself establish that a new capture obeyed the recorded conditions. A profile fitted to synthetic fixtures must remain labeled synthetic.

### 4.2 Comparators

| Method | Required information | Evaluation condition |
| --- | --- | --- |
| Uncorrected ambient | Declared input representation | Baseline signal; full color only if a legitimate mapping/scale is specified |
| Neutral/white balance | Characterized neutral and a stated normalization | Does not establish a complete device mapping |
| Card-assisted matrix | Characterized patch pairs | Separate calibration and scoring physical targets |
| Flash subtraction | Compatible pairs | Camera-domain/xy consistency until a valid profile exists |
| Flash subtraction plus device mapping | Independent per-device calibration | Common white/scale interpretation across all comparators |
| Hybrid residual or segmentation | Above, plus independently labeled training data | Keep physics baseline and ML ablation; lock all choices before the final test |
| End-to-end prediction | Sufficient independent paired ground truth | Deferred; no training on fabricated labels or a handful of near-duplicate captures |

A new device may receive its own permitted calibration captures. That is **per-device adaptation**, not zero-shot generalization to an uncalibrated phone. State which claim is being tested.

The current production pH reference colors are in the existing image domain. They must not be fed to a newly calibrated RAW/flash pipeline as if the domains were interchangeable. Any experimental pH comparison needs compatible reference measurements in the new domain and independent meter/buffer checks; the production algorithm remains unchanged.

## 5. Physical experiment protocol

This is a proposed acquisition plan, not a record of collected measurements.

1. **Select the decision and tolerance first.** Define the intended material, color range, acceptable error and rejection rate, and the cost of retakes. Select a minimum relevant improvement before seeing test results. There is no universal Delta E threshold justified by this prototype.
2. **Use at least two physical smartphones when available.** Record model, physical-device code, camera/lens, OS/camera software, RAW capability, and flash mode. Same-model devices remain distinct. Document any unavailable control instead of assuming support.
3. **Characterize the targets.** Obtain measured patch XYZ or reflectance with instrument/method, illuminant, observer, geometry, uncertainty/provenance, target batch, and condition. Generic downloaded chart values do not establish the actual worn/printed target's truth. Reserve separate physical targets or genuinely independent patches for scoring.
4. **Capture three or more relevant lighting conditions.** For example, stable daylight, indoor LED, and another spectrally different available source. Record the source and setup; correlated color temperature alone does not specify its spectrum. Include a deliberate low-flash/high-ambient failure condition where feasible.
5. **Repeat across sessions.** A starting pilot is three independent sessions on different occasions, with five recaptures per device/light condition. Reposition and refocus between recaptures as the intended use requires. These are planning counts, not a power calculation or collected sample size.
6. **Make paired acquisition auditable.** Use a mount first; lock exposure, sensitivity, focus and processing where possible; capture frames close in time; log timestamps/settings/flash state and reference geometry. Preserve originals. Add held-out handheld, pose-change, clipping, glare, and flicker challenges after the controlled baseline works.
7. **Separate calibration from evaluation.** Store explicit `device`, `session`, `light`, `physical_target`, and `pair` group identifiers. Fit/calibrate/tune on training groups; set quality thresholds on validation groups; reserve untouched test groups. Do not split different pixels or patches from the same capture randomly across these roles and call them independent.
8. **Evaluate paired methods fairly.** Use the same eligible captures and reference truth for each method. Report errors for common accepted records and each method's full acceptance/failure rate. Report per-device/light results as well as aggregates. Bootstrap independent sessions/devices, not pixels, for uncertainty; with only two phones, report that generalization uncertainty remains large.
9. **Add pH only as a separate study.** Use compatible strips, controlled timing, buffer/reference measurements over the intended range, independent specimens/strip lots, and a calibrated meter where appropriate. Keep unknowns held out and record invalid runs. A color calibration success is not evidence of pH accuracy.

### Data to supply or collect

Original, consented non-sensitive RAW pairs; available metadata; characterized target measurements; calibration and independent test partitions; actual capture conditions and repeated sessions; optional dark/repeated-flat captures for a better noise model. Use private local storage for original images and any identifying metadata. Keep datasets out of ordinary Git history. Publish only approved, scrubbed fixtures or aggregate outputs.

## 6. AI candidates and license review

**No pretrained model was downloaded, integrated, trained, or timed in this source review.** The following are candidates, not implemented recognition features or measured mobile performance.

| Candidate | Possible role and task mismatch | Verified primary-source facts | Decision |
| --- | --- | --- | --- |
| Deterministic masks, explicit mode, manual ROI | Saturation, negative differences, overlap, basic capture warnings; no semantic claim | No model weights required | Baseline; retain user control |
| TorchVision MobileNetV3-Small `IMAGENET1K_V1` | Small scene/object feature baseline; ImageNet labels do not directly provide paper/skin/paint material truth | Official model page lists 2,542,856 parameters and a 9.8 MB checkpoint; these are upstream specifications, not local measurements | Defer evaluation until approved weights and labeled target categories are available |
| TorchVision LR-ASPP MobileNetV3-Large `COCO_WITH_VOC_LABELS_V1` | Coarse semantic ROI suggestion; VOC categories do not solve material recognition or precise sensing-pad segmentation | Official page lists 3,221,538 parameters and a 12.5 MB checkpoint | Defer; manual ROI remains the measurement baseline |
| FC4 author implementation | Learned illuminant comparison, not certified RGB-to-XYZ mapping | Author repository has an MIT license; its README requests Python 2.7 and describes historical dependencies | Research comparator only; no checkpoint/source port or licensing conclusion for third-party datasets |
| Small supervised residual regressor | Correct a demonstrated residual after the physical baseline | No trained PocketSense model or sufficient measured dataset currently established | Defer until held-out improvement can be tested |

The [TorchVision software license](https://raw.githubusercontent.com/pytorch/vision/main/LICENSE) is BSD-3-Clause. Its [official model documentation](https://docs.pytorch.org/vision/main/models.html) explicitly warns that pretrained models may carry separate licenses or terms derived from their training data. Therefore the code license is **not** a completed license review of the weights or training dataset. Before integrating a specific checkpoint, record its immutable source/version/hash, weight and dataset terms, redistribution conditions, preprocessing, labels, and intended-use fit. Do not instantiate a constructor with pretrained weights during ordinary setup, because that can trigger a download.

Primary model sources: [MobileNetV3-Small](https://docs.pytorch.org/vision/main/models/generated/torchvision.models.mobilenet_v3_small.html), [LR-ASPP MobileNetV3-Large](https://docs.pytorch.org/vision/main/models/generated/torchvision.models.segmentation.lraspp_mobilenet_v3_large.html), [FC4 author repository](https://github.com/yuanming-hu/fc4), [FC4 MIT license](https://raw.githubusercontent.com/yuanming-hu/fc4/master/LICENSE). Model pages/licenses were checked on 26 November 2026; future integrations should pin and recheck their exact artifacts.

An eventual model comparison must report target-category confusion, harmful mode recommendations, unknown/abstention behavior, ROI boundary error, CPU cold/warm latency, peak memory, asset size, and fully offline operation on actual supported devices. ImageNet accuracy and upstream runtime claims do not answer those questions. Scene recognition can help request a better capture; it cannot invent missing calibration measurements.

## 7. Validation evidence and release gates

### Software verification

Run the prototype's documented tests and CLI examples. Required behavior includes known linear subtraction, signed-negative preservation, incompatible-pair rejection, clipping/overlap masks, synthetic registration recovery, known matrix behavior, invalid-profile rejection, color-difference reference cases, export/import, and failed/invalid-record accounting. Record exact commands, environment, source revision, input provenance, and generated report paths. Do not replace these checks with a screenshot of plausible colors.

The following checks were actually executed on 26 November 2026 in an isolated Windows worktree based on `main` commit `9753bf0`. They are software evidence, not physical accuracy measurements. The dedicated Python environment used CPython 3.10.11, NumPy 2.2.6, OpenCV headless 4.14.0, scikit-image 0.25.2, rawpy 0.27.1 and Matplotlib 3.10.9. The complete observed dependency snapshot is in `research/flash-color-calibration/requirements-validated-py310-windows.txt`.

| Evidence | Result |
| --- | --- |
| Prototype automated tests | `python -m pytest -q`: **146 passed** in the clean environment; `python -m pip check`: no broken requirements |
| Synthetic paired-image CLI smoke test | `python -m pocketsense_calibration synthetic --out <private-output>/release-smoke`: accepted ROI; actual ORB registration, signed subtraction, masks and referenced synthetic XYZ/Lab exported. JSON explicitly says `source_kind=synthetic` and `independently_validated_accuracy=false`. Outputs include `pair/report.json`, `pair/signed_difference.npz` and labelled PNGs |
| Calibration/benchmark CLI smoke test | Separate `fit` CLI calls for matrix and root-polynomial profiles succeeded with 36 training colors and 20 distinct validation colors in separate synthetic sessions. Separate `benchmark ... --allow-synthetic` CLI succeeded with 801 rows: 800 successful numerical calculations, one explicitly skipped hybrid row, zero real observations |
| Existing frontend regression checks | Actual `npm ci`, lint, typecheck, 65 unit tests, 7 HTTP/SQLite backend tests, production build and all 24 Chromium tests passed. No production source, existing workflow, root dependency or existing browser-test file changed |
| Physical-phone RAW acquisition/decoding | Not established by synthetic fixtures |
| Independent measured color accuracy | Not measured; real target/capture study required |
| Trained AI versus deterministic comparison | Deferred; no integrated pretrained model or trained residual |

Observed synthetic test-partition DeltaE00 summaries follow. Each method has 160 calculated rows derived from 20 generated colors, two simulated response matrices, two ambient-light vectors and two **identical mathematical repetitions**. These are not 160 independent experimental captures. The fixed seed and generating model are in `synthetic.py`; timing only covers batched method arithmetic, excluding acquisition and image import/registration.

| Synthetic method | Mean | Median | 95th percentile |
| --- | ---: | ---: | ---: |
| Uncorrected nominal-sRGB interpretation | 8.555 | 7.210 | 17.670 |
| Neutral white-balance gain baseline | 4.874 | 4.898 | 6.570 |
| Reference matrix under the matching synthetic light | <1e-10 | <1e-10 | <1e-10 |
| Flash subtraction, nominal-sRGB interpretation | 6.327 | 5.423 | 12.778 |
| Flash subtraction plus the known-device matrix fit | <1e-10 | <1e-10 | <1e-10 |
| Hybrid learned correction | Not implemented | Not measured | Not measured |

Near-zero matrix errors are expected because the generating relationship is exactly linear and noiseless for this comparison table. They show algebraic recovery under the chosen hypothesis, **not** a forecast of real calibration accuracy. The separate image-pair fixture includes generated noise for plumbing/quality checks. Real-device spectral mismatch, illumination changes, flash geometry, camera processing and target uncertainty are absent from these numerical comparison rows.

The RAW import path has tested CFA/black/white normalization with a mocked decoder and tested malformed-file rejection with the installed LibRaw binding. It has **not** passed acceptance on actual smartphone DNG files. The scene module uses explicit declarations and deterministic indicators; it does not perform semantic recognition. The additional research CI runs Python 3.10/3.12 tests and the synthetic CLI without publishing anything. GitHub checks remain the source of truth for their eventual remote outcomes.

### Gates for the next stage

- **Prototype review:** real array calculations and honest diagnostics run locally, tests pass, assumptions/errors are visible, and production engines remain intact.
- **Physical pilot:** representative paired RAW files are decoded and manually inspected, metadata checks agree with capture logs, and accepted/failed cases have independent ground truth where required.
- **Calibration benefit:** the preregistered held-out task improvement is observed with its uncertainty, per-condition errors and rejection rate, rather than only fitted-chart improvement.
- **ML addition:** a named error or manual-work bottleneck remains; a permitted small model beats the strongest deterministic/manual comparator on untouched data without unacceptable failure/latency/privacy costs.
- **Web/native integration:** preserve these contracts, verify actual supported phone capabilities, and run regression and privacy checks before offering an explicitly experimental tool. Follow the separate mobile roadmap.

Until those gates are met, describe this work as an experimental local pipeline and evaluation framework. Do not claim universal camera independence, absolute reflectance recovery, precision color measurement, or medical performance.
