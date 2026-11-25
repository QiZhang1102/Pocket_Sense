// A loopback-only adapter runs the production request handler against on-disk SQLite.
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import worker from "./worker.mjs";

// Keep database and owner credentials outside the static frontend project.
const userData = process.platform === "win32"
  ? process.env.LOCALAPPDATA || resolve(homedir(), "AppData", "Local")
  : process.platform === "darwin"
    ? resolve(homedir(), "Library", "Application Support")
    : process.env.XDG_DATA_HOME || resolve(homedir(), ".local", "share");
const directory = resolve(process.env.FEEDBACK_DATA_DIR || resolve(userData, "PocketSense Feedback"));
const schema = readFileSync(new URL("./migrations/0001_feedback.sql", import.meta.url), "utf8");
export const localOrigins = [4173, 5173].flatMap((port) =>
  ["127.0.0.1", "localhost"].map((host) => "http://" + host + ":" + port)).join(",");

function ownerKey() {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, "owner-token");
  try {
    writeFileSync(path, randomBytes(32).toString("base64url") + "\n", { flag: "wx", mode: 0o600 });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  console.log("Local owner key file: " + path);
  return readFileSync(path, "utf8").trim();
}

export function openLocalDatabase(filename) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const sqlite = new DatabaseSync(filename);
  sqlite.exec(schema);
  const DB = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...values) {
          return {
            run: () => ({ meta: statement.run(...values) }),
            all: () => ({ results: statement.all(...values) }),
          };
        },
      };
    },
  };
  return { DB, close: () => sqlite.close() };
}

export async function serve({ filename, token, port, origins = localOrigins }) {
  if (!/^[^\s]{32,256}$/.test(token ?? "")) throw new Error("Set OWNER_TOKEN to a generated key of 32–256 characters.");
  const db = openLocalDatabase(filename);
  const env = { OWNER_TOKEN: token, ALLOWED_ORIGINS: origins, DB: db.DB };
  const server = createServer(async (incoming, outgoing) => {
    try {
      // Prevent DNS rebinding from making an arbitrary browser origin appear local.
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(incoming.headers.host || "")) {
        outgoing.writeHead(403).end();
        return;
      }
      const init = { method: incoming.method, headers: incoming.headers };
      if (["POST", "PATCH"].includes(incoming.method)) {
        init.body = Readable.toWeb(incoming);
        init.duplex = "half";
      }
      const request = new Request("http://127.0.0.1" + incoming.url, init);
      const response = await worker.fetch(request, env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(400, { "Cache-Control": "no-store" }).end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on("close", db.close);
  await new Promise((ok, fail) => server.once("error", fail).listen(port, "127.0.0.1", ok));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  const server = await serve({
    filename: process.env.FEEDBACK_DB || resolve(directory, "feedback.sqlite"),
    token: process.env.OWNER_TOKEN || ownerKey(),
    port: Number(process.env.PORT || 8787),
    origins: process.env.ALLOWED_ORIGINS || localOrigins,
  });
  console.log("Feedback API listening at http://127.0.0.1:" + server.address().port);
}
