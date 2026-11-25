# PocketSense privacy

| When you use | Where information goes | How to manage it |
| --- | --- | --- |
| Color Sense or pH Sense | Image pixels, selected regions, palettes and readings are processed in the browser. The service worker caches application assets. | Images and measurement logs are kept in working memory. Export the readings you want to keep. |
| Saved reference profiles | Profiles stay in this browser's local storage. | Use profile export/import for backups and clear site data to remove local copies. |
| A feedback draft | The form stores its fields, including any optional email, in local storage on this browser. On a shared device, anyone using the same profile and site can reopen the draft. | Select **Clear draft** to remove it. When storage is unavailable, keep the form open until you submit. Reconnecting enables the Submit button and leaves the decision to send with you. |
| Submit feedback | The feedback server receives your category and message, and any feature, email or rating you provide. A random receipt ID belongs to that submission, so retrying the same draft after a lost response can recover the receipt. The server records its timestamp and review status. | Success appears after a server receipt. Project owners can review the record and use the contact address for follow-up. Keep health information out of the message. |
| Owner review | The private API checks the owner key before reading feedback or updating a status. Review data and the key are held in browser memory during access. | Lock the inbox or leave the page when finished. An exported CSV contains the visible records, including any contact details. Store and dispose of exports as private records. |

The app uses no analytics, advertising identifiers or device fingerprints. The application database stores no IP addresses or user agents. Hosting and network providers necessarily handle connection metadata when serving the app or feedback API. The operator should review provider settings and retention when enabling a hosted inbox.

Clearing site data removes drafts, saved profiles and offline application files on that device. Once submitted, feedback lives in the operator's database. Owners can remove records directly in their database as described in the deployment guide. See [service setup and retention](FEEDBACK_DEPLOYMENT.md).
