// Keeps the config-as-code honest: wrangler crons ⇔ groups.js, bindings line up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GROUPS } from "../workers/data/src/groups.js";

// Minimal JSONC: strip line and block comments outside strings, and trailing commas.
function parseJSONC(src) {
  let out = "", inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") out += src[++i];
      else if (c === '"') inStr = false;
    } else if (c === '"') { inStr = true; out += c; }
    else if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; }
    else if (c === "/" && n === "*") { i = src.indexOf("*/", i + 2) + 1; }
    else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}
const read = (p) => parseJSONC(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const dataCfg = read("workers/data/wrangler.jsonc");
const siteCfg = read("workers/site/wrangler.jsonc");

test("every group's cron is registered in wrangler, and no cron is orphaned", () => {
  const crons = new Set(dataCfg.triggers.crons);
  const used = new Set(Object.values(GROUPS).map((g) => g.cron));
  for (const c of used) assert.ok(crons.has(c), `groups.js uses "${c}" but wrangler.jsonc doesn't schedule it`);
  for (const c of crons) assert.ok(used.has(c), `wrangler.jsonc schedules "${c}" but no group uses it`);
  assert.ok(crons.size <= 5, "Cloudflare's free plan allows 5 cron triggers per account");
});

test("pre-warm runs at least as often as each snapshot goes stale", () => {
  const everyMinutes = (cron) => {
    const [min, hour] = cron.split(" ");
    if (min.startsWith("*/")) return +min.slice(2);
    if (hour.startsWith("*/")) return +hour.slice(2) * 60;
    throw new Error(`unrecognised cron ${cron}`);
  };
  for (const [id, g] of Object.entries(GROUPS))
    assert.ok(everyMinutes(g.cron) * 60 <= g.ttl, `${id}: cron every ${everyMinutes(g.cron)} min but ttl is ${g.ttl / 60} min`);
});

test("site worker binds to the data worker and serves dist/", () => {
  assert.equal(siteCfg.services[0].binding, "DATA");
  assert.equal(siteCfg.services[0].service, dataCfg.name);
  assert.equal(siteCfg.assets.binding, "ASSETS");
  assert.equal(siteCfg.assets.directory, "../../dist");
  assert.equal(dataCfg.r2_buckets[0].binding, "SNAPSHOTS");
  assert.equal(dataCfg.workers_dev, false, "data worker is private behind the service binding");
});

test("site and deploy workflow agree on names", () => {
  const deploy = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  const refreshWf = readFileSync(new URL("../.github/workflows/refresh.yml", import.meta.url), "utf8");
  const domain = siteCfg.routes.find((r) => r.custom_domain).pattern;
  for (const wf of [deploy, refreshWf]) assert.ok(wf.includes(`'https://${domain}'`), `workflows default SITE_URL to ${domain}`);
  assert.ok(deploy.includes(dataCfg.r2_buckets[0].bucket_name), "deploy.yml creates the R2 bucket");
});
