#!/usr/bin/env node
/* Checks whether the prices the guides quote are still true.
 *
 * The guides rank because they carry real numbers — "$23/mo", "$4.90 a
 * booklet", "2.9% + 30¢". That is also their weakness: the numbers age, and a
 * guide quoting last year's price is worse than no guide, because being
 * specific is the whole reason anyone trusts it.
 *
 * Two passes, because vendor pricing pages cannot be relied on:
 *
 *   1. Fetch the source and look for the quoted figure. Modern pricing pages
 *      render in JavaScript, so a miss proves nothing — it is reported as
 *      "could not verify", never as "the price changed".
 *   2. Age. Every claim records when a human last confirmed it. Past the
 *      staleness window it is flagged for re-checking regardless of what the
 *      fetch did.
 *
 * The second pass is the one that always works, and it is the point. This
 * tool's job is to put the question in front of you on a schedule, not to
 * pretend it can read a pricing page better than you can.
 *
 * Usage:
 *   node bin/check-prices.js                 # every claim
 *   node bin/check-prices.js quillbill
 *   node bin/check-prices.js --out prices.md
 */

const fs = require("fs");
const { get } = require("../lib/fetch");
const SITES = require("../sites");

/* How long a price is trusted before it wants looking at again. Vendors change
   plans a few times a year; a quarter keeps the guides honest without turning
   this into a chore. */
const STALE_DAYS = 90;

function parseArgs(argv) {
  const args = { keys: [], out: null, staleDays: STALE_DAYS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--stale-days") args.staleDays = Number(argv[++i]);
    else if (!a.startsWith("-")) args.keys.push(a);
  }
  if (!args.keys.length) args.keys = Object.keys(SITES);
  return args;
}

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso + "T00:00:00Z").getTime()) / 86400000);
}

/* Strip tags and collapse whitespace so "$23 /mo" and "$23/mo" both match. */
function readableText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

async function checkClaim(claim, staleDays) {
  const age = claim.verified ? daysSince(claim.verified) : null;
  const result = {
    label: claim.label,
    page: claim.page,
    value: claim.value,
    source: claim.source,
    age,
    stale: age === null || age > staleDays,
    found: null,
    note: null,
  };

  if (!claim.source) {
    result.note = "no source URL recorded — cannot be checked automatically";
    return result;
  }

  try {
    const res = await get(claim.source, { attempts: 2, timeout: 20000 });
    const text = readableText(res.body);
    const needles = claim.match || [claim.value];
    result.found = needles.some((n) => text.includes(n));
    result.note = result.found
      ? "quoted figure still appears on the source page"
      : "quoted figure not found — the page may be JavaScript-rendered, so check by hand before changing anything";
  } catch (err) {
    result.note = `could not fetch the source (${err.message})`;
  }
  return result;
}

function render(rows, args) {
  const lines = [
    "# Price check",
    "",
    `Run ${new Date().toISOString().slice(0, 10)}. Claims older than ${args.staleDays} days are flagged for re-checking.`,
    "",
    "A figure not being found is **not** evidence it changed — most pricing pages render in",
    "JavaScript and this tool reads raw HTML. Treat every row as a prompt to look, not a verdict.",
    "",
  ];

  for (const site of rows) {
    lines.push(`## ${site.name}`, "");
    if (!site.claims.length) { lines.push("No price claims recorded.", ""); continue; }

    lines.push("| | Claim | Value | Age | Source says |", "| --- | --- | --- | --- | --- |");
    for (const r of site.claims) {
      const flag = r.stale ? "🔴" : r.found === false ? "🟡" : "🟢";
      const age = r.age === null ? "never verified" : `${r.age}d`;
      lines.push(`| ${flag} | ${r.label}<br><span title="page">\`${r.page}\`</span> | ${r.value} | ${age} | ${r.note} |`);
    }
    lines.push("");
  }

  lines.push("---", "",
    "When you have re-checked one, update its `value` if it moved and set `verified` to",
    "today's date in `sites.js`. That date is the only thing keeping this honest.");
  return lines.join("\n");
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const rows = [];
  let flagged = 0;

  for (const key of args.keys) {
    const config = SITES[key];
    if (!config) { console.error(`unknown site: ${key}`); process.exit(2); }

    const claims = [];
    for (const claim of config.priceClaims || []) {
      const r = await checkClaim(claim, args.staleDays);
      if (r.stale || r.found === false) flagged++;
      console.error(`${r.stale ? "STALE" : r.found === false ? "check" : "ok   "} ${config.name} — ${r.label}`);
      claims.push(r);
    }
    rows.push({ name: config.name, claims });
  }

  const markdown = render(rows, args);
  if (args.out) { fs.writeFileSync(args.out, markdown); console.error(`wrote ${args.out}`); }
  else { console.log(markdown); }

  /* Never fails the build. A stale price is a thing to look at, not a reason to
     block a deploy that has nothing to do with it. */
  console.error(`\n${flagged} claim(s) want a look.`);
})();
