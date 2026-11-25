# Operating the PocketSense feedback inbox

GitHub Pages serves the scientific tools and the dashboard UI. A separate HTTPS Worker receives submitted feedback, writes it to a private D1 database, and authenticates dashboard requests. The project includes the Worker, migration and a loopback SQLite adapter that runs the same handler. The public frontend needs only the API origin.

## Run the complete system locally

Use Node.js 24 LTS for the local SQLite adapter. The frontend retains its existing Node requirement. From the repository root, open two terminals.

```sh
# Terminal 1
node backend/local.mjs

# Terminal 2
npm ci
npm run dev
```

Open the address printed by Vite. On loopback the application uses the feedback API on port 8787. Submit a short synthetic message, then open `/#admin` on that same frontend origin. The API startup message identifies a private file named `owner-token` containing the local owner key. Read it locally, enter it into the owner form, and check the new submission. Set the status to Under Review, reload the dashboard, and verify the change persists. Keep the API running while using feedback. The normal science tools can run independently.

SQLite and the generated 256-bit key are kept in the current user's application data directory under `PocketSense Feedback`. On macOS this is under `~/Library/Application Support`, on Windows under `%LOCALAPPDATA%`, and on Linux under `$XDG_DATA_HOME` or `~/.local/share`. The adapter binds to 127.0.0.1. Optional environment settings:

| Setting | Purpose |
| --- | --- |
| `FEEDBACK_DATA_DIR` | Absolute private directory for local data and the generated key. Choose a directory outside any web server root. |
| `FEEDBACK_DB` | Override the SQLite database path, for example for an isolated test. |
| `OWNER_TOKEN` | Supply an existing randomly generated owner secret to the local adapter instead of the local key file. |
| `PORT` | Local API listening port, default 8787. Match the frontend's `VITE_FEEDBACK_API_URL` when changing this. |
| `ALLOWED_ORIGINS` | Comma-separated, exact frontend origins. Local defaults cover localhost and 127.0.0.1 on 4173 and 5173. |

For a persistent local preview after building, use `npm run build` and `npm run preview` in terminal 2. Run `node --test backend/api.test.mjs` to exercise the HTTP handler, private storage, authentication and quotas using synthetic fixtures and a temporary database.

## Deploy the Worker and connect GitHub Pages

An owner needs access to a Cloudflare Workers account with D1 and permission to configure and rebuild the GitHub Pages frontend. The example configuration is for a dedicated Worker on workers.dev. Select an appropriate D1 location or jurisdiction when creating the database if your project has data residency requirements.

1. From the repository root, run the commands below. Complete Wrangler's account login in the browser. Record the database UUID returned by the create command. Wrangler may offer to edit a configuration file automatically; the supplied example already has the required bindings.

   ```sh
   cd backend
   cp wrangler.example.jsonc wrangler.jsonc
   npx wrangler@4 login
   npx wrangler@4 d1 create pocketsense-feedback
   ```

2. Edit `backend/wrangler.jsonc`. Replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with the real database UUID. Keep the D1 binding named `DB`. Set `ALLOWED_ORIGINS` to the exact scheme and host of each trusted frontend, for example `https://qizhang1102.github.io`. Omit paths and trailing slashes. All projects hosted on a single GitHub Pages hostname share a browser origin. Use a dedicated trusted domain for the admin UI if other repositories on that hostname run untrusted JavaScript. The rate-limit binding's numeric namespace must be unique to this application's limiter in your account.

3. Apply the remote migration and deploy the Worker. On first deployment, the handler returns 503 until the owner secret has been configured. Generate a 32-byte random secret in your password manager, save it there, and paste it into Wrangler's masked prompt for `OWNER_TOKEN`. Restrict access to authorized administrators. Use a separate key for local development.

   ```sh
   npx wrangler@4 d1 migrations apply pocketsense-feedback --remote
   npx wrangler@4 deploy
   npx wrangler@4 secret put OWNER_TOKEN
   ```

4. In GitHub, open **Settings → Secrets and variables → Actions → Variables**. Set the repository **variable** `VITE_FEEDBACK_API_URL` to the Worker's public HTTPS origin, for example `https://pocketsense-feedback.<your-subdomain>.workers.dev`. Set only the URL. Keep `OWNER_TOKEN` in Cloudflare's Worker secrets and the admins' password manager. Vite embeds every referenced `VITE_*` value into browser code. Run the **Deploy GitHub Pages** workflow on the branch containing this implementation. Updates to a repository variable take effect at build time.

5. Open the deployed Pages site. Intentionally send a synthetic, non-sensitive message through Feedback. On the same site's `#admin` page enter the owner key, locate that exact message, change its status, then reload and sign in again. A signed-out GET to `<worker-origin>/admin/feedback` must return HTTP 401. Only this round trip establishes that the **hosted** site, CORS, secret, migration and production D1 binding are correctly connected.

Cloudflare maintains the [D1 binding and setup guide](https://developers.cloudflare.com/d1/get-started/), [migration instructions](https://developers.cloudflare.com/d1/reference/migrations/) and [Worker secrets guide](https://developers.cloudflare.com/workers/configuration/secrets/).

## Access, filtering and privacy

The intake route accepts a JSON object containing the selected category, message, and any explicitly entered feature, email and integer rating. A honeypot must be empty. The Worker rejects unrecognized fields and limits the body to 24 KiB, the message to 4,000 UTF-16 code units and the email to 254. Each stored row has a random **submission** ID, a server-side UTC timestamp and a review status. The browser creates one UUID v4 for a draft and sends it in the optional `Idempotency-Key` header. If acknowledgement is lost, an explicit retry with the same key and content recovers the original receipt. A conflicting payload gets HTTP 409. This key identifies a single submission; it rotates when the draft content changes. Clients omitting the header receive a server-generated UUID. There are no file, profile, analysis, device ID or IP columns. Operators should ask users to leave medical details and identifying sample data out of free text.

| Route | Access and response |
| --- | --- |
| `POST /feedback` | Public submission. Returns HTTP 201 and a receipt ID after D1 confirms storage. |
| `GET /admin/feedback` | Owner bearer key. Returns 100 items per page and a nullable next offset. Accepts category, feature, status, date order (`sort=newest` or `oldest`) and offset. |
| `PATCH /admin/feedback/:id` | Owner bearer key. Accepts a single status. Valid values are `new`, `reviewing`, `planned`, `completed` and `declined`. |

Both admin routes verify the supplied key inside the Worker for every request. Missing or incorrect keys receive HTTP 401. Only authorization grants access; CORS restricts browser origins. D1 is accessed through the Worker's binding and through Cloudflare account administration. No browser database credentials are distributed. API replies use `Cache-Control: no-store`. The owner enters a separate secret at runtime and the UI holds it in memory. Authorized owners can see optional contact emails.

The Worker records no request-body, header or IP logs. The example disables Workers Observability. The hosting provider still handles ordinary connection metadata, including the network address needed to serve the request. Review the account's other logging and retention settings before launch. Saved records stay in D1 until an authorized operator deletes them. Choose a review and deletion schedule, restrict access to CSV exports, and apply the same policy to exports and backups. For an individual deletion, identify and verify the submission ID in the private dashboard, then remove that row in the authenticated D1 console. Cloudflare's [Time Travel retention](https://developers.cloudflare.com/d1/reference/time-travel/) also applies to historical recovery data.

The public endpoint has two limits. A shared edge bucket allows about 60 requests per minute **per Cloudflare location**. A single atomic SQL statement caps successful records across locations at 12 per rolling minute and 240 per rolling day. The same limits cover all senders and use no per-user identifier. This suits a low-volume pilot. A busy event or spammer can fill the shared budget and temporarily block legitimate submissions. Review actual demand before changing thresholds. A 429 asks the user to retry later; storage or configuration failures return 503. The frontend retains the draft for an explicit retry. The local adapter implements the SQL caps and production schema. Wrangler also exercises the edge binding. See the [rate-limiter semantics](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

A single owner key fits the current small team. Rotation takes effect server-side with `wrangler secret put OWNER_TOKEN`; redistribute the replacement only to current admins. There is no per-admin audit trail or individual revocation in this design. For a larger reviewer group, integrate an identity provider with individual roles and revocation before broadening access.

## Alternatives considered

| Option | Setup, owner access and privacy | Reliability, abuse controls and maintenance |
| --- | --- | --- |
| **Cloudflare Worker + D1** | One Worker, one SQL database and a server secret. No public database endpoint or client SDK is required. Explicit field validation isolates the optional service from the scientific workspace. | Database-level write limits work across Worker instances. Provider quotas can interrupt service. The free plan currently includes 100,000 Worker requests/day and D1 allowances of 5 million rows read/day, 100,000 rows written/day and 5 GB total storage. Review limits before an event. [Worker pricing](https://developers.cloudflare.com/workers/platform/pricing/) · [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) |
| **Supabase** | Postgres, Auth and row-level policies support individual admin identities and richer queries. An intake function can validate writes and enforce abuse controls. Public Data API tables need explicit RLS configuration and policy testing. | An attractive option for a larger authenticated team. Free projects can pause after a week of inactivity, a consideration for occasional conference traffic. More components to maintain for a single inbox. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) · [plans and inactivity](https://supabase.com/pricing) |
| **Firebase / Firestore** | Firebase Authentication and Security Rules can separate public create from owner read/update. Fine-grained input validation and rules tests are needed. A function can own ingestion quotas. | Free Firestore quotas exist. Budget separately for functions and other chosen services. App Check can help with abuse, but web attestation adds a provider and operational/privacy choices. Compound queries can require additional indexes. [Firestore quotas](https://firebase.google.com/docs/firestore/quotas) · [Security Rules](https://firebase.google.com/docs/firestore/security/get-started) · [App Check](https://firebase.google.com/docs/app-check) |

All three can serve a static frontend over HTTPS. For this pilot, the small data model and low administrative overhead favor a Worker with D1. Revisit the decision if independent admin accounts or a much higher sustained submission rate become requirements.

## Verification evidence

Seven backend test groups include a real localhost HTTP request, insertion into a temporary SQLite database, server restart, authenticated retrieval, status updates and rejected anonymous requests. Additional cases cover capped concurrent writes, per-draft idempotency, optional fields, malformed or oversized submissions, forbidden fields, pagination, filters, date order and storage failures. A second smoke test applied the migration with Wrangler 4.166.0 and exercised real local workerd/D1 bindings through HTTP. It observed 201 on submission, 401 on anonymous list and 200 on owner update, then retrieved the matching stored record using a status filter. These tests used synthetic records. Production acceptance requires the owner-operated check in step 5.
