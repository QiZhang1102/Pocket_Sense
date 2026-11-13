# Deployment and sharing

## Public website

Target: https://qizhang1102.github.io/Pocket_Sense/

The application has no sign-in or analysis backend. A successful deployment is required before sharing this URL. Photos are processed on-device; opening the repository URL shows source code rather than the application.

## GitHub Pages

1. In this repository, open Settings → Pages.
2. Set Build and deployment → Source to **GitHub Actions**.
3. Keep exactly one publishing workflow: `.github/workflows/deploy.yml`. It installs dependencies, checks and builds the app, then uploads **dist/**.
4. Push to `main`, or run **Deploy GitHub Pages** from Actions. Wait for both build and deploy to succeed.
5. Open the public URL in a fresh browser tab.

Do not add GitHub’s Static HTML publishing template. It uploads the repository root without compiling React/TypeScript and may replace the working app with a blank page.

## Other static hosting

Run `npm ci` and `npm run build`. Upload the contents of `dist/` to the desired HTTPS directory. The same build supports the domain root and a subdirectory; paths do not need manual replacement. Opening an HTML file from the filesystem does not enable offline installation.

The tracked `.openai/hosting.json` retains the existing Sites project identity. Publishing on Sites is separate from GitHub Pages; a GitHub push does not update the old Sites URL.

## Phone and offline use

Open the HTTPS site in Safari or Chrome. No account is needed. Wait for **Offline ready** before disconnecting. Close old tabs and reopen to activate a new release. A phone’s `localhost` does not point to the developer’s computer.

## Verification

`npm run build` verifies that HTML references compiled assets and that the offline worker resolves cached files correctly at `/`, `/Pocket_Sense/`, and another app path. `npm test` checks the inherited scientific algorithms. Responsive browser checks do not establish physical-phone camera behavior or laboratory measurement accuracy.
