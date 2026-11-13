# Legacy PocketSense link

The public app is https://qizhang1102.github.io/Pocket_Sense/.
The former https://pocketsense-local-color-lab.zq20021102mia.chatgpt.site/ stays published as a redirect to that address.

This directory is deployed separately to the existing Sites project. It is not included in the GitHub Pages app build. Run `node legacy-redirect/build.mjs` only in the legacy Site checkout, whose `.openai/hosting.json` selects `dist`.

The HTML uses `location.replace`, with an HTML refresh and a visible link as fallbacks. Supported workspace hashes survive; query strings and unrecognized hashes are discarded. The old `/sw.js` URL remains available so cached v1.1 installations receive an immediately activating migration worker. It redirects existing tabs and later navigations, and removes only v1.1 app-shell caches. Local storage and IndexedDB records are not deleted or transferred between origins.

A browser must reconnect to receive the migration. A device that stays offline can continue displaying its previously cached version until it reconnects. Keep the legacy Site deployed and public for previously shared links to keep working.

Run migration checks with `node --test legacy-redirect/verify.mjs`.
