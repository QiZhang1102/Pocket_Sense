# PocketSense

**Your Camera. Your Color Sensor. Your Data.**

[Open PocketSense](https://pocketsense-local-color-lab.zq20021102mia.chatgpt.site) · [Source code](https://github.com/QiZhang1102/Pocket_Sense)

PocketSense turns photos into on-device color measurements and reference-based pH estimates. The public website works in desktop and mobile browsers without an account. Images are decoded and analyzed locally; they are never uploaded for analysis. After the first successful cache, the app can run offline.

## What you can do

- **Color Sense:** upload JPG, PNG or WebP, use a mobile camera input, or drag and drop a photo. Sample a point or rectangle, adjust its coordinates, zoom and pan. Inspect HEX, RGB, HSL, HSV, D65 Lab, mean, median and standard deviation. Extract 5 or 8 representative palette colors with real Lab k-means; copy and export them.
- **pH Sense:** build, edit, import, export and locally save a reference chart for your strip brand and batch. Sample chart patches directly from the photo or enter HEX values. Match using CIEDE2000, optionally interpolate between suitable adjacent references, and review quality flags and the descriptive chart-label span.
- **Light Sense:** inspect relative luminance, the histogram, dark pixels, clipped highlights and channel clipping. Select a known neutral gray or white reference, check its suitability, and apply a constrained correction across all modules. Compare original and corrected RGB.
- **Notebook:** enter a pH meter reference reading, save measurements, and inspect signed error, absolute error, MAE, bias, RMSE and a scatter plot. Built-in synthetic demonstrations are excluded from validation statistics. Records remain session-only unless you explicitly enable local storage. Export CSV or JSON; photos are not stored with records.
- **Offline PWA:** installable app metadata, locally bundled assets, content-versioned service-worker caching and synthetic demos that run entirely on-device. No analysis backend, external model API, runtime CDN, tracking script or remote font.

## Quick start

Use Node.js 22.12 or later; Node.js 24 was used during development.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Development mode does not register a service worker. For production and offline testing:

```sh
npm run build
npm run preview -- --port 4173 --strictPort
```

Open `http://127.0.0.1:4173` and wait for **Offline ready**. To test on a phone, use the public HTTPS website. A phone cannot access a computer through the phone's own `localhost` address.

## Share and use on a phone

Send this link directly:

**https://pocketsense-local-color-lab.zq20021102mia.chatgpt.site**

No sign-in is required for the published app. Open it in Safari or Chrome, then choose **Try the demo**, **Choose photo**, or **Take photo**. Camera capture depends on the phone/browser and its permissions. When opening from an embedded messaging browser, use **Open in Safari/Chrome** if file or camera controls are unavailable.

To install, use the browser installation menu or Safari **Share → Add to Home Screen**. Open the installed app once while online and wait for **Offline ready** before switching to airplane mode. Clearing browser storage, private mode or storage pressure can remove the cache.

## pH workflow

1. Prepare a single-pad strip using the manufacturer instructions. Keep swab sampling, wetting and read time consistent.
2. Photograph the strip, its matching brand/batch chart and a neutral reference in the same plane under uniform lighting.
3. In **pH Sense**, select the uniform center of the colored pad, avoiding the swab, edges, shadows and glare.
4. Create a reference profile. To sample a chart patch, select it in the image and click the target button beside its pH row. Repeat, save, then reselect the strip sample.
5. Optionally select a neutral gray/white patch in **Light Sense** and enable correction. Same-photo references are corrected with the sample; known reference RGB values are not transformed.
6. Review the estimate and quality flags. Missing profiles or excessively distant colors do not produce a pH estimate.
7. Enter the pH meter reading of the same sample, save the measurement, and accumulate independent validation data.

Changing the image resets the correction, neutral region, selected pH profile and meter input. Saved profiles remain available, but same-photo profiles must be resampled or verified for matching capture conditions.

## Algorithms and reproducibility

See [ALGORITHMS.md](ALGORITHMS.md) for formulas, thresholds, assumptions and primary sources. The app uses deterministic numerical methods and does not download machine-learning weights.

Images are proportionally resized to a maximum 1600-pixel long edge. Single-point sampling reads the processed canvas. The representative region color uses a 10% trimmed mean per channel; large regions use a regular grid of up to about 40,000 samples. Pixels with alpha below 250/255 are excluded.

JSON measurement exports include the full profile, original and corrected RGB, D65 Lab, region coordinates in working-image pixels, correction gains, optional meter value and quality flags. They do not contain the photo; retain original photographs separately for research reproducibility.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

The unit suite includes all 34 published Sharma/Wu/Dalal CIEDE2000 test pairs, color conversion, sampling, calibration, clustering, pH matching/interpolation safeguards, export handling and validation metrics.

The included Playwright suite targets desktop and mobile viewports. Start the production preview separately, then run:

```sh
npm run test:e2e
```

The configuration uses installed macOS Chrome when available. On other systems, install Playwright Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROME_PATH` to the desired executable. Set `PLAYWRIGHT_BASE_URL` if the preview runs on another port. See [VERIFICATION.md](VERIFICATION.md) for checks actually completed and environment limitations; the presence of a test script does not imply it passed.

## Deployment

`npm run build` produces a static `dist/` directory suitable for HTTPS static hosting. Runtime paths are relative. Serve JavaScript, CSS, web manifests and images with their correct MIME types. Prefer `Cache-Control: no-cache` for `index.html` and `sw.js`; fingerprinted assets can be cached long-term. The service worker must be reachable and its scope must cover the app directory. Opening `index.html` with `file://` does not support service workers or installation.

The existing Sites deployment is identified in `.openai/hosting.json`; that file contains no credential. GitHub contains the complete source, tests, dependency lockfile and documentation. Sites publishing is a separate deployment step; pushing to GitHub alone does not automatically update the hosted site. The downloaded source can also be deployed independently of Sites.

## Scientific and technical limits

- No physical swab/strip accuracy has been established. Agreement with a pH meter must be measured; a displayed decimal does not establish ±0.1 pH accuracy.
- Relative image luminance is not illuminance in lux. Exposure, camera processing, HDR, white balance and spectral differences cannot reliably be separated using an ordinary photograph alone.
- Neutral-reference correction is a diagonal linear-RGB gain, not full camera calibration. It cannot restore clipped highlights. White paper is not a certified color standard.
- Chart-label spans are descriptive, not confidence intervals. Matching, interpolation and quality thresholds are unvalidated engineering heuristics.
- This release supports one colored pad. Multi-pad analysis, automatic strip detection, multi-reference matrix calibration and cross-object normalized plot estimation are future work.
- HEIC and RAW are not supported. The file limit is 30 MB; decoded images above 80 megapixels are rejected. Browser memory limits may be stricter.
- Resizing, compression, ICC-to-sRGB conversion and transparency handling affect reported colors. The app is not a spectrophotometer or a medical diagnostic device.
- Local records are browser-specific, with no cross-device synchronization. Browser eviction or cleanup can remove records and the offline cache.
- Responsive browser checks are not physical iPhone/Android validation. Camera permission flows, Safari installation and airplane-mode capture still need device testing.

## Physical validation plan

Lock down one strip brand and swab procedure: sampling area, liquid volume, reaction time, lighting and camera distance. Use reference samples spanning the target pH range and record independently calibrated pH meter values. Separate calibration and validation sets. Repeat measurements across pH values, phones and lighting conditions, then assess bias, variability and outliers before reporting accuracy. Software tests cannot replace this experiment.
