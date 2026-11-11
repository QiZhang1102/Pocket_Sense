# PocketSense verification — 2026-11-11

## Completed checks

- TypeScript: `npm run typecheck` passed.
- ESLint: `npm run lint` passed.
- Scientific/data tests: **56 passed** in Vitest. Includes all 34 published Sharma/Wu/Dalal CIEDE2000 pairs; sRGB transfer and D65 Lab; HEX; region statistics and transparency; neutral-reference validity and calibration; native ImageData getter compatibility; k-means; pH profiles, matching and interpolation safeguards; CSV and JSON exports; error metrics.
- Production build: `npm run build` passed. Locally bundled JS ~291 kB before gzip; CSS ~33 kB. Seven app-shell resources are precached plus the root document. No remote fonts/scripts/image-analysis endpoints.
- Dependency audit after updates: `npm install` reported **0 vulnerabilities** (a time-specific package-audit snapshot).
- HTTP production preview returned 200 at the selected available local port 4174.

## Actual browser checks

Performed with the connected in-app browser against the production build:

1. Synthetic pH demonstration: reference match **pH 7**, HEX **#94B889**, RGB **148 / 184 / 137**, ΔE00 **0.00**.
2. Uploaded PNG through the real file chooser: RGB/HEX matched the known test fixture. Without selecting a pH profile, displayed **no pH estimate**.
3. Created and locally saved a new test reference profile. A fractional reference label **6.5** remained **6.5** in the nearest-category readout.
4. Entered a test meter value of **6.7**, saved a record, and observed MAE **0.200**, Bias **−0.200**, RMSE **0.200** and the scatter plot. These were software test inputs, not physical measurements. No such records are bundled or seeded into the application.
5. Downloaded a measurement JSON through the actual export control.
6. Selected the demo neutral patch via the canvas and precise ROI fields (795,440,80,80), enabled correction and observed gains **0.900 / 0.973 / 1.161**, sample RGB changing from **148 / 184 / 137** to **141 / 182 / 147**.
7. Verified that correction remains active in Color Sense; selected eight-color clustering and observed eight computed palette entries.
8. Verified zoom to **150%**.
9. At **390 px** and **320 px** viewport widths, document scroll width equaled viewport width. Screenshots recorded for desktop and mobile layout.
10. **Cache-origin-offline test:** stopped the owned production preview server and independently confirmed connection refusal with curl. Reloaded the page in the browser. The app loaded from cache and newly generated/analyzed a sunset demo, returning **#F8D6A1** and five palette colors. Subsequently reran the pH demo and obtained **pH 7** while the server remained stopped.
11. Removed the temporary UI verification profile. Test records were session-only and disappeared on reload. Final published source contains no test measurement history or private photos.

## Bug found and repaired during browser QA

The first white-reference correction exposed a native `ImageData` compatibility error: spreading the object did not copy its prototype-based width/height getters. The corrected-image function now explicitly preserves width and height. Added a regression test using prototype getters, rebuilt, verified the new fingerprinted bundle was loaded, and repeated the real browser calibration successfully.

## Verification limits

- The eight Playwright desktop/mobile E2E cases are included in the repository but **did not execute**: the environment aborted the standalone Chrome process at launch (`SIGABRT`; process cleanup also reported `EPERM`). This was an environment launch failure, not eight successful tests. The connected browser checks above were the fallback and should not be described as a passed Playwright suite.
- The offline check establishes application availability and processing while its origin server is unavailable. The device's global network was not disabled, so this is **not a physical airplane-mode test**. No absolute offline reliability guarantee is made for arbitrary browsers or storage-eviction states.
- Browser viewport resizing is not an actual iPhone/Android device test. Mobile camera permissions, Safari installation, orientation metadata across device models, and real photographs under diverse lighting still need device validation.
- No physical pH accuracy, swab workflow accuracy, illuminance/lux accuracy, device-independent colorimetry, statistical confidence interval or cross-object normalization has been established.

## Version 1.1 — English interface and sharing preparation

- Translated every built-in interface string, accessibility label, quality warning, error, demo label, PWA metadata and README into English. User-entered names and imported profile content are preserved as entered.
- Scanned source, browser-test selectors, static metadata and documentation for CJK characters; no built-in Chinese copy remained.
- Reran 56 unit tests, ESLint and the TypeScript/production build successfully. No measurement algorithms changed.
- Verified the English production build in the connected browser at 1440, 390 and 320 px. At 320 px, the pH page, profile editor, Light Sense, Color Sense, Notebook and About page had no horizontal document overflow and no Chinese visible text.
- Verified that the English synthetic pH demonstration still returns pH 7 and that the eight-color palette control produces eight colors.
- Updated Playwright selectors to English and moved screenshots into each test output directory. Standalone Chrome execution remains subject to the previously recorded environment limitation; no passed automated E2E run is claimed for this release.
- Added consistent source formatting and English startup, deployment, mobile-installation and physical-validation documentation.
