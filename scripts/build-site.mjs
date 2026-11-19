// Builds the static site into dist/:
//   - bundles + minifies site/js/app.js (and shared/) into one hashed ES module
//   - minifies site/css/style.css into a hashed file
//   - copies MapLibre GL from node_modules to a versioned /vendor path
//   - rewrites index.html to point at the hashed files
// Output is plain static files, served by Workers Static Assets (bcw-site).

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");
const out = join(root, "dist");
const require = createRequire(import.meta.url);

const hash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);

await rm(out, { recursive: true, force: true });
await mkdir(join(out, "assets"), { recursive: true });

async function bundle(entry, ext) {
  const r = await build({
    entryPoints: [join(site, entry)],
    bundle: true,
    minify: true,
    format: ext === "js" ? "esm" : undefined,
    target: ["es2022", "chrome111", "firefox114", "safari16.4"],
    legalComments: "none",
    write: false,
    logLevel: "warning",
  });
  const code = r.outputFiles[0].contents;
  const name = `assets/${entry.split("/").pop().replace(/\.\w+$/, "")}-${hash(code)}.${ext}`;
  await writeFile(join(out, name), code);
  return { name, bytes: code.length };
}

const js = await bundle("js/app.js", "js");
const css = await bundle("css/style.css", "css");

const mlPkg = require("maplibre-gl/package.json");
const mlDir = dirname(require.resolve("maplibre-gl/package.json"));
const vendor = join(out, "vendor", `maplibre-gl@${mlPkg.version}`);
await mkdir(vendor, { recursive: true });
for (const f of ["maplibre-gl.js", "maplibre-gl.css", "LICENSE.txt"])
  await cp(join(mlDir, "dist", f), join(vendor, f)).catch(() => cp(join(mlDir, f), join(vendor, f)));

let html = await readFile(join(site, "index.html"), "utf8");
html = html
  .replaceAll("MAPLIBRE_VERSION", mlPkg.version)
  .replace('href="/css/style.css"', `href="/${css.name}"`)
  .replace('src="/js/app.js"', `src="/${js.name}"`);
for (const s of ['/css/style.css"', '/js/app.js"', "MAPLIBRE_VERSION"])
  if (html.includes(s)) throw new Error(`index.html still references ${s}`);
await writeFile(join(out, "index.html"), html);
await cp(join(site, "404.html"), join(out, "404.html"));
await cp(join(site, "_headers"), join(out, "_headers"));

console.log(`dist/${js.name}  ${(js.bytes / 1024).toFixed(1)} KB`);
console.log(`dist/${css.name}  ${(css.bytes / 1024).toFixed(1)} KB`);
console.log(`dist/vendor/maplibre-gl@${mlPkg.version}/`);
