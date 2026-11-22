// Build and test the PWA against a new database, even when a real service is configured locally.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import { serve } from "../../backend/local.mjs";

export default async function setup(config) {
  const siteOrigin = new URL(config.projects[0].use.baseURL).origin;
  const temp = await mkdtemp(join(tmpdir(), "pocketsense-browser-"));
  const outDir = join(temp, "dist");
  const token = randomBytes(32).toString("hex");
  let api, site;
  const close = async (server) => {
    if (!server) return;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
  const cleanup = async () => {
    try {
      await Promise.all([close(site?.httpServer), close(api)]);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  };
  try {
    api = await serve({
      filename: join(temp, "test.sqlite"),
      token,
      port: 0,
      origins: siteOrigin,
    });
    const apiOrigin = "http://127.0.0.1:" + api.address().port;
    await build({
      define: {
        "import.meta.env.VITE_FEEDBACK_API_URL": JSON.stringify(apiOrigin),
      },
      build: { outDir, emptyOutDir: true },
      logLevel: "warn",
    });
    execFileSync(process.execPath, [
      fileURLToPath(new URL("../../scripts/build-sw.mjs", import.meta.url)),
      outDir,
    ]);
    site = await preview({
      build: { outDir },
      preview: {
        host: "127.0.0.1",
        port: Number(new URL(siteOrigin).port),
        strictPort: true,
      },
      logLevel: "warn",
    });
    // Only test workers receive this generated credential, after the client bundle is complete.
    process.env.POCKETSENSE_E2E_API = apiOrigin;
    process.env.POCKETSENSE_E2E_OWNER = token;
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
