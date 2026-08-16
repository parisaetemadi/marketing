#!/usr/bin/env node
/* Regenerates sitemap.xml from the pages that actually exist.

   A hand-maintained sitemap rots silently: you add a guide, forget the entry,
   and the page just never gets crawled. Nothing errors, traffic simply doesn't
   arrive. This makes the file tree the source of truth and takes lastmod from
   git, so the dates mean something instead of being "the day I last
   remembered to touch this".

   Usage:
     node bin/build-sitemap.js quillbill --dir ../Quillbill          # write it
     node bin/build-sitemap.js quillbill --dir ../Quillbill --check  # CI mode */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const site = require("../lib/site");
const SITES = require("../sites");

/* Priority and change frequency by served path. First match wins; the last
   entry is the fallback. Tweak here rather than in the generated file — the
   generated file gets overwritten. */
const RULES = [
  { match: /^\/$/,          priority: "1.0", changefreq: "weekly" },
  { match: /^\/app$/,       priority: "0.8", changefreq: "monthly" },
  { match: /^\/guides\/$/,  priority: "0.7", changefreq: "monthly" },
  { match: /^\/guides\//,   priority: "0.7", changefreq: "monthly" },
  { match: /.*/,            priority: "0.5", changefreq: "monthly" },
];

function ruleFor(served) {
  return RULES.find((r) => r.match.test(served));
}

/* The date of the last commit that touched the file. Falls back to mtime for
   an uncommitted file, and to today if git isn't available at all. */
function lastModified(root, file) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", file],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (out) return out;
  } catch (err) { /* not a git checkout, or the file is untracked */ }
  try {
    return fs.statSync(file).mtime.toISOString().slice(0, 10);
  } catch (err) {
    return new Date().toISOString().slice(0, 10);
  }
}

function build(config, dir) {
  const source = site.fromDir(dir, config.origin);
  const origin = config.origin.replace(/\/$/, "");

  const entries = source.pages
    .filter((page) => page.indexable)
    .map((page) => {
      const rule = ruleFor(page.served);
      return {
        loc: origin + page.served,
        lastmod: lastModified(source.root, page.file),
        changefreq: rule.changefreq,
        priority: rule.priority,
      };
    })
    .sort((a, b) => (Number(b.priority) - Number(a.priority)) || a.loc.localeCompare(b.loc));

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const e of entries) {
    lines.push(
      "  <url>",
      `    <loc>${e.loc}</loc>`,
      `    <lastmod>${e.lastmod}</lastmod>`,
      `    <changefreq>${e.changefreq}</changefreq>`,
      `    <priority>${e.priority}</priority>`,
      "  </url>");
  }
  lines.push("</urlset>", "");
  return { xml: lines.join("\n"), entries, root: source.root };
}

(async () => {
  const argv = process.argv.slice(2);
  const key = argv.find((a) => !a.startsWith("-")) || "quillbill";
  const dirFlag = argv.indexOf("--dir");
  const check = argv.includes("--check");

  const config = SITES[key];
  if (!config) { console.error(`unknown site: ${key}`); process.exit(2); }

  const dir = dirFlag !== -1 ? argv[dirFlag + 1] : config.localPath;
  if (!dir) { console.error(`${config.name}: no --dir and no localPath in sites.js`); process.exit(2); }

  const { xml, entries, root } = build(config, path.resolve(__dirname, "..", dir));
  const target = path.join(root, "sitemap.xml");
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;

  if (check) {
    /* Only a difference in the set of URLs is worth failing a build over. A
       crawler does not care what order the entries are in or whether a lastmod
       shifted by a day, and failing on that trains people to ignore the check
       — which is how a genuinely missing page gets waved through. */
    const before = new Set(site.parseSitemap(current || ""));
    const after = new Set(entries.map((e) => e.loc));
    const added = [...after].filter((url) => !before.has(url));
    const removed = [...before].filter((url) => !after.has(url));

    if (added.length || removed.length) {
      console.error("FAIL sitemap.xml does not match the pages that exist");
      for (const url of added) console.error(`     + ${url} (exists, not listed)`);
      for (const url of removed) console.error(`     - ${url} (listed, does not exist)`);
      console.error("     run build-sitemap.js without --check to fix");
      process.exit(1);
    }

    console.log(`ok   sitemap.xml lists the right ${entries.length} URLs`);
    if (current !== xml) console.log("note formatting or lastmod would change on a rebuild");
    process.exit(0);
  }

  fs.writeFileSync(target, xml);
  console.log(`wrote ${path.relative(process.cwd(), target)} — ${entries.length} URLs`);
  if (current !== xml) {
    const before = new Set(site.parseSitemap(current || ""));
    for (const e of entries) if (!before.has(e.loc)) console.log(`  + ${e.loc}`);
  }
})();
