#!/usr/bin/env node
/* Audits a site's pages for the things that quietly cost you search traffic,
   plus the per-product rules in sites.js that are too important to leave as
   prose in a README.

   Two modes:
     --dir <path>   read a local checkout   (run it before you push)
     --live         crawl the deployed site (run it on a schedule)

   Usage:
     node bin/audit-seo.js quillbill --dir ../Quillbill
     node bin/audit-seo.js quillbill --live
     node bin/audit-seo.js --all --live --markdown report.md

   Exits non-zero if anything at "fail" severity is found, so it can gate a
   workflow. Warnings are printed but never fail the run. */

const fs = require("fs");
const path = require("path");
const site = require("../lib/site");
const { get } = require("../lib/fetch");
const SITES = require("../sites");

/* Google truncates around 60 characters of title and about 160 of
   description. Below the lower bounds you're usually leaving the snippet to
   chance, so both ends are worth flagging. */
const TITLE_MIN = 15, TITLE_MAX = 65;
const DESC_MIN = 70, DESC_MAX = 165;

function parseArgs(argv) {
  const args = { keys: [], mode: null, dir: null, markdown: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") args.keys = Object.keys(SITES);
    else if (a === "--dir") { args.mode = "dir"; args.dir = argv[++i]; }
    else if (a === "--live") args.mode = "live";
    else if (a === "--markdown") args.markdown = argv[++i];
    else if (a === "--json") args.json = true;
    else if (!a.startsWith("-")) args.keys.push(a);
  }
  return args;
}

function Report(siteName) {
  const findings = [];
  return {
    siteName,
    findings,
    fail(page, check, detail) { findings.push({ severity: "fail", page, check, detail }); },
    warn(page, check, detail) { findings.push({ severity: "warn", page, check, detail }); },
    get failures() { return findings.filter((f) => f.severity === "fail"); },
    get warnings() { return findings.filter((f) => f.severity === "warn"); },
  };
}

/* --- checks ------------------------------------------------------------- */

function checkPage(page, report, config) {
  const id = page.served || page.id;
  if (page.error) { report.fail(id, "fetch", page.error); return; }

  /* JSON-LD has to parse wherever it appears — a broken block is a bug even on
     a page nobody indexes. */
  page.jsonLd.forEach((block, i) => {
    try { JSON.parse(block); }
    catch (err) { report.fail(id, "json-ld", `block ${i + 1} is not valid JSON: ${err.message}`); }
  });

  /* Everything below is about how a page looks in search results. A page
     Disallow'd in robots.txt has deliberately opted out of that, so holding it
     to snippet rules is just noise — /thanks carries an order id in its query
     string and is meant to stay out of the index. */
  if (!page.indexable) return;

  if (!page.title) report.fail(id, "title", "missing <title>");
  else if (page.title.length < TITLE_MIN || page.title.length > TITLE_MAX) {
    report.warn(id, "title", `${page.title.length} chars, outside ${TITLE_MIN}–${TITLE_MAX}: ${JSON.stringify(page.title)}`);
  }

  if (!page.description) report.fail(id, "description", "missing meta description");
  else if (page.description.length < DESC_MIN || page.description.length > DESC_MAX) {
    report.warn(id, "description", `${page.description.length} chars, outside ${DESC_MIN}–${DESC_MAX}`);
  }

  if (!page.canonical) {
    report.fail(id, "canonical", "missing rel=canonical");
  } else {
    if (!/^https?:\/\//i.test(page.canonical)) {
      report.fail(id, "canonical", `not absolute: ${page.canonical}`);
    } else if (config.origin) {
      const expected = config.origin.replace(/\/$/, "") + page.served;
      if (page.canonical !== expected) {
        report.fail(id, "canonical", `points at ${page.canonical}, page is served at ${expected}`);
      }
    }
    if (page.og.url && page.canonical && page.og.url !== page.canonical) {
      report.warn(id, "og:url", `disagrees with canonical (${page.og.url} vs ${page.canonical})`);
    }
  }

  for (const key of ["title", "description", "image"]) {
    if (!page.og[key]) report.warn(id, `og:${key}`, "missing — link previews will fall back to guesswork");
  }
  if (!page.twitterCard) report.warn(id, "twitter:card", "missing");

  /* An SVG og:image is worse than none: the tag looks correct, previews
     validate locally, and then Facebook, X, LinkedIn, WhatsApp and iMessage
     all decline to render it and show a bare grey link instead. None of them
     support SVG. */
  if (page.og.image && /\.svgz?(?:[?#]|$)/i.test(page.og.image)) {
    report.fail(id, "og:image", `is an SVG (${page.og.image}) — no social platform renders SVG previews; use PNG or JPG`);
  }

  if (page.h1Count === 0) report.fail(id, "h1", "no <h1>");
  else if (page.h1Count > 1) report.warn(id, "h1", `${page.h1Count} <h1> elements, expected 1`);
}

/* Sitemap and robots.txt have to agree with the pages that actually exist. */
function checkSitemap(pages, sitemap, config, report) {
  if (!sitemap) { report.warn("(site)", "sitemap", "no sitemap.xml found"); return; }
  const inSitemap = new Set(sitemap);
  const origin = (config.origin || "").replace(/\/$/, "");

  for (const page of pages) {
    if (page.error) continue;
    const url = origin + page.served;
    if (page.indexable && !inSitemap.has(url)) {
      report.fail(page.served, "sitemap", "indexable page missing from sitemap.xml");
    }
    if (!page.indexable && inSitemap.has(url)) {
      report.fail(page.served, "sitemap", "page is Disallow'd in robots.txt but listed in sitemap.xml");
    }
  }

  const known = new Set(pages.filter((p) => !p.error).map((p) => origin + p.served));
  for (const url of sitemap) {
    if (!known.has(url)) report.fail(url, "sitemap", "listed in sitemap.xml but no such page");
  }
}

/* Titles and descriptions repeated across pages make them compete with each
   other. Cheap to miss by hand once there are more than a few. */
function checkDuplicates(pages, report) {
  for (const field of ["title", "description"]) {
    const seen = new Map();
    for (const page of pages) {
      const value = page[field];
      if (!value || page.error || !page.indexable) continue;
      if (!seen.has(value)) seen.set(value, []);
      seen.get(value).push(page.served);
    }
    for (const [value, where] of seen) {
      if (where.length > 1) {
        report.warn(where.join(", "), `duplicate-${field}`, JSON.stringify(value.slice(0, 60) + "…"));
      }
    }
  }
}

/* Internal links that point at nothing. Only meaningful against a checkout,
   where the file tree is the source of truth. */
function checkInternalLinks(pages, root, report) {
  const exists = (p) => fs.existsSync(p);
  for (const page of pages) {
    const dir = path.dirname(page.file);
    for (const href of page.links) {
      if (/^(?:https?:|mailto:|tel:|#|data:)/i.test(href)) continue;
      const clean = href.split("#")[0].split("?")[0];
      if (!clean) continue;

      const candidates = clean.startsWith("/")
        ? [path.join(root, clean), path.join(root, clean + ".html"), path.join(root, clean, "index.html")]
        : [path.join(dir, clean), path.join(dir, clean + ".html"), path.join(dir, clean, "index.html")];

      if (!candidates.some(exists)) {
        report.fail(page.served, "internal-link", `${href} resolves to nothing`);
      }
    }
  }
}

/* The rule that matters most: the pages that promise zero network calls have
   to actually make zero network calls. */
function checkPurity(pages, config, root, report) {
  if (!config.purity) return;
  const allowed = config.purity.allowedHosts || {};

  for (const served of config.purity.pages) {
    const page = pages.find((p) => p.served === served);
    if (!page) { report.fail(served, "purity", "page listed in purity config does not exist"); continue; }

    for (const url of page.subresources) {
      const host = site.hostOf(url);
      if (host && !allowed[host]) {
        report.fail(served, "purity", `loads a third-party subresource from ${host} (${url})`);
      }
    }

    if (page.hasAnalytics) {
      report.fail(served, "purity", "carries an analytics beacon — this page must make no third-party request");
    }

    /* Local scripts the page pulls in are part of the page's promise. */
    if (root) {
      for (const src of page.scripts) {
        if (/^(?:https?:)?\/\//i.test(src)) continue;
        const file = src.startsWith("/")
          ? path.join(root, src)
          : path.join(path.dirname(page.file), src);
        if (!fs.existsSync(file)) continue;
        for (const host of site.scriptHosts(fs.readFileSync(file, "utf8"))) {
          if (!allowed[host]) {
            report.fail(served, "purity", `${src} references ${host}, which is not an allowed host`);
          }
        }
      }
    }
  }
}

/* The beacon belongs on the marketing pages and nowhere else. Both directions
   are worth checking: a missing beacon is invisible, and Cloudflare's
   "automatic setup" silently puts it back everywhere if anyone flips it on. */
function checkAnalytics(pages, config, report) {
  if (!config.analytics) return;
  for (const served of config.analytics.requiredOn || []) {
    const page = pages.find((p) => p.served === served);
    if (!page) { report.warn(served, "analytics", "page in analytics config does not exist"); continue; }
    if (!page.hasAnalytics) report.fail(served, "analytics", "marketing page is missing the analytics beacon");
  }
  for (const served of config.analytics.forbiddenOn || []) {
    const page = pages.find((p) => p.served === served);
    if (page && page.hasAnalytics) {
      report.fail(served, "analytics", "beacon present on a page that must stay beacon-free");
    }
  }

  /* A Cloudflare site token is 32 hex characters. Anything else is either a
     placeholder waiting to be filled in or a typo — and both fail the same
     silent way: the script loads, the request goes out, and no data is ever
     recorded. Better to fail loudly now than to find out a month later. */
  for (const page of pages) {
    if (!page.beaconToken) continue;
    if (!/^[0-9a-f]{32}$/i.test(page.beaconToken)) {
      report.fail(page.served, "analytics",
        `beacon token ${JSON.stringify(page.beaconToken)} is not a 32-character Cloudflare token — ` +
        "fill it in from Cloudflare → Web Analytics before this ships");
    }
  }
}

/* The repo is not the website. Cloudflare Pages publishes the whole directory,
   so working notes, tests and Worker source are served at the live domain
   unless `.assetsignore` says otherwise — "it is only in git" is not true
   here, and a private repo does not make a public deploy private.

   Checked against the file when auditing a checkout, and against the live
   site when auditing production, because the two can disagree: the file only
   takes effect on the next deploy. */
function checkNeverPublished(source, config, report) {
  const paths = config.neverPublish || [];
  if (!paths.length || source.mode !== "dir") return;

  const covered = (p) => (source.assetsIgnore || []).some((entry) =>
    entry === p || (entry.endsWith("/") && p.startsWith(entry)));

  if (!source.assetsIgnore.length) {
    report.fail("(site)", "never-publish",
      "no .assetsignore — Cloudflare Pages will serve every file in the repo, " +
      "including " + paths.join(", "));
    return;
  }
  for (const p of paths) {
    if (!fs.existsSync(path.join(source.root, p))) continue;
    if (!covered(p)) {
      report.fail(p, "never-publish", "exists in the repo and .assetsignore does not exclude it");
    }
  }
}

async function checkNeverPublishedLive(config, report) {
  for (const p of config.neverPublish || []) {
    if (p.endsWith("/")) continue; /* probe files, not directories */
    const url = config.origin.replace(/\/$/, "") + "/" + p.replace(/^\//, "");
    try {
      const res = await get(url, { attempts: 1 });
      if (res.status === 200) {
        report.fail(p, "never-publish", `is being served at ${url}`);
      }
    } catch (err) {
      /* Anything that is not a 200 is the outcome we want. */
    }
  }
}

/* The og:image tag being present and the og:image actually loading are two
   different facts, and only the second one matters to a link preview.

   Checking the format catches an SVG; it does not catch a 404, a path typo, or
   an image that never deployed. Those fail exactly the same way from the
   outside — a bare grey card — and you find out when someone shares your
   product and it looks broken. */
async function checkSocialImagesLive(pages, report) {
  const seen = new Set();
  for (const page of pages) {
    const url = page.og && page.og.image;
    if (!url || seen.has(url)) continue;
    seen.add(url);

    try {
      const res = await get(url, { attempts: 2, timeout: 15000 });
      const type = (res.headers && res.headers.get("content-type")) || "";
      if (!/^image\//i.test(type)) {
        report.fail(page.served, "og:image", `${url} returned ${type || "no content-type"} rather than an image`);
      }
    } catch (err) {
      report.fail(page.served, "og:image", `${url} does not load: ${err.message}`);
    }
  }
}

/* --- output ------------------------------------------------------------- */

function printReport(report) {
  console.log(`\n=== ${report.siteName} ===`);
  if (!report.findings.length) { console.log("ok   no findings"); return; }
  for (const f of report.findings) {
    console.log(`${f.severity === "fail" ? "FAIL" : "warn"} ${f.page} — ${f.check}: ${f.detail}`);
  }
  console.log(`\n${report.failures.length} failure(s), ${report.warnings.length} warning(s)`);
}

function toMarkdown(reports) {
  const lines = ["# Site audit", "", `Run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, ""];
  for (const report of reports) {
    lines.push(`## ${report.siteName}`, "");
    if (!report.findings.length) { lines.push("No findings.", ""); continue; }
    lines.push("| | Page | Check | Detail |", "| --- | --- | --- | --- |");
    for (const f of report.findings) {
      lines.push(`| ${f.severity === "fail" ? "🔴" : "🟡"} | \`${f.page}\` | ${f.check} | ${f.detail.replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/* --- main --------------------------------------------------------------- */

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.keys.length) args.keys = ["quillbill"];
  if (!args.mode) args.mode = "dir";

  const reports = [];
  for (const key of args.keys) {
    const config = SITES[key];
    if (!config) { console.error(`unknown site: ${key} (known: ${Object.keys(SITES).join(", ")})`); process.exit(2); }

    const report = Report(config.name);
    let source;

    try {
      if (args.mode === "live") {
        source = await site.fromOrigin(config.origin);
      } else {
        /* An explicit --dir is resolved from the working directory, the way
           any other command-line path would be; `localPath` is a property of
           this repo's layout, so it resolves from this repo's root. Resolving
           --dir against the script's location instead makes the tool
           unusable from anywhere but a sibling checkout — CI included. */
        const dir = args.dir
          ? path.resolve(process.cwd(), args.dir)
          : (config.localPath && path.resolve(__dirname, "..", config.localPath));
        if (!dir) {
          console.error(`${config.name}: no --dir given and no localPath in sites.js — skipping`);
          continue;
        }
        source = site.fromDir(dir, config.origin, config.urlStyle);
      }
    } catch (err) {
      report.fail("(site)", "load", err.message);
      reports.push(report);
      printReport(report);
      continue;
    }

    for (const page of source.pages) checkPage(page, report, config);
    checkSitemap(source.pages, source.sitemap, config, report);
    checkDuplicates(source.pages, report);
    checkPurity(source.pages, config, source.root, report);
    checkAnalytics(source.pages, config, report);
    checkNeverPublished(source, config, report);
    if (source.mode === "origin") {
      await checkNeverPublishedLive(config, report);
      await checkSocialImagesLive(source.pages, report);
    }
    if (source.mode === "dir") checkInternalLinks(source.pages, source.root, report);

    console.log(`${config.name}: checked ${source.pages.length} page(s) via ${source.mode}`);
    reports.push(report);
    printReport(report);
  }

  if (args.markdown) fs.writeFileSync(args.markdown, toMarkdown(reports));
  if (args.json) console.log(JSON.stringify(reports.map((r) => ({ site: r.siteName, findings: r.findings })), null, 2));

  const failures = reports.reduce((n, r) => n + r.failures.length, 0);
  process.exit(failures ? 1 : 0);
})();
