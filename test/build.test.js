import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";

const root = new URL("../", import.meta.url);
const dist = (p) => new URL(`dist/${p}`, root);

test("site build: hashed bundles, self-hosted MapLibre, no leftover dev paths", () => {
  execFileSync(process.execPath, ["scripts/build-site.mjs"], { cwd: root, stdio: "pipe" });
  const html = readFileSync(dist("index.html"), "utf8");
  const refs = [...html.matchAll(/(?:src|href)="\/([^"]+)"/g)].map((m) => m[1]).filter((r) => !r.startsWith("snapshot/"));
  assert.ok(refs.length >= 4);
  for (const r of refs) assert.ok(existsSync(dist(r)), `index.html references missing /${r}`);
  assert.match(html, /assets\/app-[0-9a-f]{10}\.js/);
  assert.doesNotMatch(html, /unpkg\.com|\/js\/app\.js|MAPLIBRE_VERSION/);
  for (const g of ["weather", "tides", "buoys", "climate"]) assert.ok(html.includes(`href="/snapshot/${g}"`), `preloads ${g}`);

  const app = refs.find((r) => r.startsWith("assets/app-"));
  const kb = statSync(dist(app)).size / 1024;
  assert.ok(kb < 60, `app bundle is ${kb.toFixed(1)} KB; keep client JS small`);
  assert.ok(existsSync(dist("_headers")) && existsSync(dist("404.html")));
});
