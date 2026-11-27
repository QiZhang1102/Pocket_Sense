# PocketSense mobile acquisition roadmap

Research planning baseline: **2026-11-26**. This document accompanies the isolated
`research/flash-color-calibration/` Python prototype. It does not ship a mobile
app, replace the production PWA, enable camera controls on the website, or claim
validated object reflectance, laboratory accuracy, or a medical measurement.

## 1. Keep acquisition, estimation and interpretation separate

The first useful native deliverable is a reproducible **capture bundle**, not an
automatic material classifier. A bundle should contain original ambient and
flash captures, explicit capture-space/encoding information, per-frame metadata,
an optional measured reference, geometry/ROI correspondence, quality warnings,
and a versioned processing report. An image with flash is not a known illuminant:
flash spectrum, beam geometry, distance, thermal state and device processing can
change the measurement. A visually plausible corrected picture is not evidence
of recovery of true surface reflectance.

The Python prototype is a reference implementation and offline experiment. A
future shared core must reproduce its accepted numerical fixtures and rejection
behavior before being used by either mobile platform. Do not bundle a Python
runtime into a phone app merely to label the core shared; evaluate a small
portable C++/Rust library and, if the web later needs it, a WebAssembly build.
Swift/Kotlin ports with common fixtures are also viable at the early prototype
stage, but require maintenance of numerical equivalence.

The production browser app already provides image sampling and reference-based
pH estimation. Keep those available while research proceeds. A native pilot can
export a bundle for this Python tool; it need not immediately duplicate every
screen, feedback feature or deployment system.

## 2. Browser/PWA and native access are different contracts

The W3C Image Capture API describes photo capture and capability-dependent
controls, including exposure/focus/white-balance modes, torch and fill light.
These are not a promise that every browser/device exposes every control. Check
the actual track capabilities and settings; a requested setting or the presence
of an interface is not evidence that the desired acquisition occurred. The web
contract does not supply a portable equivalent of a native RAW/DNG plus verified
per-frame sensor-metadata workflow. A continuous torch and a synchronized still
flash must also be distinguished. See the [W3C Image Capture working
draft](https://www.w3.org/TR/image-capture/).

| Area | Existing PWA / exploratory browser capture | Native research acquisition |
| --- | --- | --- |
| Distribution | Existing HTTPS site and offline app shell | Separate install, signing, permissions and release process |
| Input | Existing JPG/PNG/WebP workflow; browser processing is not sensor RAW | Query exact camera/lens/format; preserve original files and metadata |
| Controls | Use only controls actually exposed by that browser and device | AVFoundation or Camera2/CameraX controls, with runtime capability checks |
| Pair evidence | Imported pair and user-provided metadata may be incomplete | Record requested **and resolved** settings, timestamps and errors for both frames |
| Offline/privacy | Local processing remains useful | Can also run locally; design private storage, explicit export and deletion |
| Unsupported hardware | Report limitations; no invented controls | Fall back to exploratory processed capture or reject controlled capture |

Installing a PWA does not grant AVFoundation/Camera2 access. Wrapping a web view
does not remove that limitation without a native camera bridge. Neither route
should silently relabel a JPEG-derived linearization as sensor-linear RAW.

## 3. iOS feasibility: AVFoundation, per configuration

Use a dedicated `AVCaptureSession` and a known physical camera where possible;
retain the device/lens identity rather than assuming the displayed zoom label
identifies a stable sensor. Capability discovery and a real capture attempt must
precede enabling a controlled acquisition mode.

- **White balance:** check `isWhiteBalanceModeSupported(.locked)`. Locking current
  gains and choosing custom gains are different abilities; inspect
  `isLockingWhiteBalanceWithCustomDeviceGainsSupported`. When custom gains are
  supported, honor the documented channel range and acquire
  `lockForConfiguration()` before changing them. Wait for the applied-settings
  completion timestamp rather than treating a UI toggle as proof of a lock.
  [Apple gain locking](https://developer.apple.com/documentation/avfoundation/avcapturedevice/setwhitebalancemodelocked(with:completionhandler:)),
  [custom-gain capability](https://developer.apple.com/documentation/avfoundation/avcapturedevice/islockingwhitebalancewithcustomdevicegainssupported).
- **Exposure:** check custom/locked mode support and the active format's ISO and
  exposure-duration limits. `setExposureModeCustom` can set both values, but
  Apple's current documentation warns that the default balanced photo-quality
  policy may temporarily override them for dark-scene fusion. Use the documented
  `.speed` prioritization when requiring the device exposure settings to be
  honored, then inspect actual output metadata. This is a reproducibility choice,
  not a claim that faster capture yields more accurate colors.
  [Apple custom exposure](https://developer.apple.com/documentation/avfoundation/avcapturedevice/setexposuremodecustom(duration:iso:completionhandler:)).
- **Focus:** check the supported focus modes, and separately check
  `isLockingFocusWithCustomLensPositionSupported` before choosing a lens position.
  Locking the current position is not the same as calibrated physical focus
  distance. Record the lens state and reject unacceptable focus/motion by the
  acquisition protocol.
  [Apple manual focus](https://developer.apple.com/documentation/avfoundation/avcapturedevice/setfocusmodelocked(lensposition:completionhandler:)).
- **RAW:** query `availableRawPhotoPixelFormatTypes` for the configured photo
  output. Apple ProRAW needs its own support/enabling checks and is not identical
  to Bayer RAW: it combines RAW information with computational processing. Keep
  the format type explicit, and do not mix Bayer, ProRAW and processed files under
  a single undocumented linearity assumption.
  [Apple RAW/ProRAW guide](https://developer.apple.com/documentation/avfoundation/capturing-photos-in-raw-and-apple-proraw-formats).
- **Flash and RAW together:** the APIs expose both RAW formats and flash settings;
  do not infer universal support or universal incompatibility. Query the current
  output's `supportedFlashModes`, the device's current flash availability, and
  the validity of the complete photo settings. In particular, RAW has documented
  stabilization restrictions. Thermal unavailability can occur even while a flash
  mode remains in the supported list. Check the resolved flash result and capture
  error for the selected lens/format on each supported device. A rejected or
  non-fired flash capture must not become a successful controlled pair.
  [Apple flash validation](https://developer.apple.com/documentation/avfoundation/avcapturephotosettings/flashmode),
  [RAW settings restrictions](https://developer.apple.com/documentation/avfoundation/avcapturephotosettings/rawphotopixelformattype).

An iOS spike should export one ambient/flash pair with requested/resolved ISO,
duration, white-balance gains, focus state, format, orientation, timestamps and
flash outcome. Verify that the metadata and pixel response agree with the capture
protocol. Front-camera screen illumination, continuous torch and rear LED flash
are separate modes and need separate characterization.

## 4. Android feasibility: Camera2 capabilities, CameraX convenience

Read `CameraCharacteristics` per camera ID, including the physical sensor chosen
behind a logical multi-camera. Hardware level alone is insufficient:

| Level / capability | Relevant implication |
| --- | --- |
| `LEGACY` | Limited older control contract; no manual-sensor or per-frame-control guarantee |
| `LIMITED` | Basic capability set plus optional features; query each required capability |
| `FULL` | Manual sensor and manual post-processing support; **RAW is not implied by FULL alone** |
| `LEVEL_3` | Adds RAW and YUV reprocessing to FULL-level capabilities |
| `REQUEST_AVAILABLE_CAPABILITIES_RAW` | Advertises RAW sensor output and metadata needed for DNG |

Do not compare hardware-level enum integers as an ordered scale. Query
`MANUAL_SENSOR`, `MANUAL_POST_PROCESSING`, `RAW`, flash availability, supported
request/result keys and stream configurations explicitly.
[Android capability contracts](https://developer.android.com/reference/android/hardware/camera2/CameraCharacteristics),
[hardware-level definitions](https://developer.android.com/reference/android/hardware/camera2/CameraMetadata).

For a controlled pair, implement an explicit request/result state machine:
converge as appropriate, establish supported exposure/WB/focus controls, wait for
results confirming them, capture ambient and flash, and retain `TotalCaptureResult`
beside each original image. `CONTROL_AWB_LOCK` locks calculated automatic values;
manual gains/transforms require supported manual control. In-flight requests mean
the first received result is not necessarily the locked one. Disable or account
for automatic pipelines and physical-camera switching that could change the
transform between frames. [Android WB request behavior](https://developer.android.com/reference/android/hardware/camera2/CaptureRequest#CONTROL_AWB_LOCK),
[manual post-processing contract](https://developer.android.com/reference/android/hardware/camera2/CameraMetadata#REQUEST_AVAILABLE_CAPABILITIES_MANUAL_POST_PROCESSING).

RAW plus flash is not a blanket platform guarantee. Check `FLASH_INFO_AVAILABLE`,
RAW output support and the complete stream combination; follow the appropriate
AE/precapture protocol and verify actual capture results. `FLASH_MODE_SINGLE` is
effective only with compatible AE modes, while auto-flash AE modes can override
direct flash control. Continuous torch has different timing and power behavior.
Unsupported, partially fired, mismatched or clipped pairs must be rejected or
explicitly downgraded. [Android flash request semantics](https://developer.android.com/reference/android/hardware/camera2/CaptureRequest#FLASH_MODE).

CameraX is a useful lifecycle, preview and compatibility layer. Its current API
supports `OUTPUT_FORMAT_RAW` and `OUTPUT_FORMAT_RAW_JPEG` (added in 1.5.0); query
`ImageCapture.getImageCaptureCapabilities(cameraInfo).supportedOutputFormats` and
validate the requested combination. The official release table checked for this
document lists **1.7.0 stable**, updated 2026-11-18. Do not assume that a general
JPEG tutorial describes every current output mode. Use the documented interop
API for the pinned CameraX version if low-level controls are needed; do not submit
requests directly to CameraX-owned sessions or assume interop settings cannot
conflict with its management. If paired-capture timing/result control is not
adequate, use a dedicated Camera2 path for that mode.
[ImageCapture reference](https://developer.android.com/reference/androidx/camera/core/ImageCapture),
[CameraX releases](https://developer.android.com/jetpack/androidx/releases/camera),
[Camera2 interop](https://developer.android.com/reference/androidx/camera/camera2/interop/Camera2Interop).

## 5. Scene advice now; optional ML only after a separate evaluation

The prototype's `assess_scene(image, scene)` accepts a **user declaration**:
`paper`, `test_strip`, `skin`, `fabric`, `wall`, `screen`, `glossy`,
`transparent`, `general` or `unknown`. Its clipping, local bright-candidate,
gradient and Laplacian statistics are deterministic heuristics. A bright patch
could be a printed white region; low spatial detail could be a uniform wall.
Neither is material recognition, a sensor-noise estimate, or a medical result.

Declared screen scenes are emissive and unsuitable for the opaque-surface flash
subtraction assumption. Declared glossy/transparent scenes are also rejected by
that paired workflow. Unknown scenes remain exploratory. Other declared contexts
only receive **conditional** flash-trial advice; the scene name does not establish
diffuse reflectance or validate the pair. The Python scene module contains no
pretrained semantic model.

| Candidate to evaluate later | What the available resource actually does | License / offline gate |
| --- | --- | --- |
| MobileNet V2/V3 backbone | Compact classification/features can be a starting point for training. ImageNet object classes are not labels for matte/glossy, paper, fabric, transmissive or emissive behavior. | TensorFlow Models source is Apache-2.0. Do not assume every redistributed checkpoint shares that license: the inspected `google/mobilenet_v2_1.0_224` model card reports `other`. Resolve the exact checkpoint terms before packaging; no weights are bundled here. |
| MediaPipe DeepLab-v3 | The linked task model segments Pascal VOC objects; it does not supply PocketSense material classes or reliable measurement ROIs. The listed 257x257 FP32 model is an optional segmentation baseline, not a material classifier. | The linked release model card declares Apache-2.0; MediaPipe source is Apache-2.0. Pin and archive the artifact's own license, revision and hash before bundling. Evaluate a local mobile runtime and its separate notices. |

Sources: [TensorFlow Models license](https://github.com/tensorflow/models/blob/master/LICENSE),
[MobileNet model card](https://huggingface.co/google/mobilenet_v2_1.0_224),
[MediaPipe segmenter documentation](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter),
[linked DeepLab release card](https://huggingface.co/litert-community/MediaPipe-ImageSegmenter-DeepLab-V3),
[MediaPipe source license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE).

An ML experiment needs permissioned examples of the actual scene/material classes,
annotation rules, an unknown/reject class, held-out phones and lighting, confusion
analysis, and tests for failure to recognize emissive/specular scenes. A person
must be able to override an incorrect label. Model suggestions must never bypass
capture-quality rejection. Skin-related data needs appropriate participant
control; do not train a diagnosis or lesion-risk model under this feature.

Offline inference requires packaging the runtime and model locally, rather than
copying CDN or auto-download examples. Verify tensor preprocessing, quantization,
operators/delegate support, RAM, sustained latency, thermal behavior, power and
license notices on the intended devices. Published example-device timings are
not performance commitments for this app. No model weights are required for, or
included in, this research prototype.

## 6. Phases, architecture choices and release gates

| Phase | Concrete deliverable | Exit evidence |
| --- | --- | --- |
| A: offline numerical research | Synthetic and real permissioned bundles; explicit linearization, pairing and rejection contracts; measured-reference comparisons | Repeatable tests plus held-out captures; report when correction worsens a result; synthetic success alone is insufficient |
| B: one native acquisition spike | Choose the platform and two physical devices available to the team; export originals and resolved metadata | Demonstrate supported/unsupported modes, real flash outcome, locks and failure paths on both devices |
| C: shared numerical contract | Versioned bundle schema and portable core or equivalent native implementations | Same fixtures and tolerances on desktop, iOS and Android; retain rejection behavior and provenance |
| D: second platform pilot | Implement its own camera state machine and supported-device matrix | Repeat the measurement protocol; do not inherit the first platform's device validation |
| E: limited native beta | Guided capture, local review/export/delete and honest supported-device UI | Permission/privacy review, interruptions/thermal/storage tests and documented measurement limits |
| F: optional product integration | Decide whether native capture, PWA import, or both best serve users | Separate review before changes to production features, hosting or scientific claims |

| UI approach | Benefits | Engineering cost that remains |
| --- | --- | --- |
| Swift + Kotlin | Direct platform camera APIs, predictable metadata and debugging access | Two UI implementations and release pipelines; fixtures/schema/core can still be shared |
| Flutter | Shared UI and possible native-core FFI integration | Advanced RAW/flash/lock/result paths may need custom Swift/Kotlin plugins; validate bridge lifetimes, image copies and plugin capabilities |
| React Native | Existing React skills and shared product UI patterns | The website is not a drop-in native camera app; native modules are still needed for precise acquisition and metadata |
| Existing PWA + small native capture companion | Keeps the current site useful and limits the initial rewrite | Design a private bundle export/import flow and clear compatibility boundaries |

Planning judgment: a two-device, single-platform capture spike is a bounded
multi-week engineering exercise for a developer already comfortable with that
camera stack. A reproducible two-platform pilot with hardware validation,
interruptions, storage/privacy and release work is a person-month-scale effort,
not a weekend UI wrapper. The exact duration depends on device availability,
developer experience and measurement targets; these are scope estimates, not
delivery commitments. Data collection and independent validation may dominate
the schedule even after a camera preview appears to work.

Before a beta, test app backgrounding, permission denial, interrupted captures,
flash not firing, lens switching, rolling-shutter/lighting flicker, motion,
thermal throttling, memory pressure, file corruption and export/deletion. Device
support must be recorded by model, camera ID/lens, OS, format and capture mode.
Do not advertise all-phone support or clinical conclusions from a supported
API list. A separately reviewed decision is required before migrating hosting,
adding accounts/cloud image storage, or replacing production analysis.

## 7. What this repository does not yet prove

The Python research code does not acquire native camera frames, enforce hardware
locks, demonstrate flash+RAW compatibility on any physical phone, implement a
material model, or validate a calibrated color instrument. Native apps, training
data, independent measurements and a supported-device matrix remain future work.
This roadmap records checked API contracts and an engineering plan; its existence
must not be counted as implementation of those capabilities.
