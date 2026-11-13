import { mkdir, copyFile, rm } from "node:fs/promises";
// Run from the selected legacy Site checkout, never the GitHub Pages app build.
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const name of ["index.html", "sw.js"]) {
  await copyFile(new URL(name, import.meta.url), `dist/${name}`);
}
console.log("Built the legacy PocketSense redirect and service-worker migration.");
