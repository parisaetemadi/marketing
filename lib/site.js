/* The page model shared by every tool in here.

   A "page" can come from two places, and both produce the same shape:

     fromDir(path)   a local checkout, for running before you push
     fromOrigin(url) the live site, for running on a schedule against prod

   No dependencies and no HTML parser. Both sites are hand-written static HTML
   with a consistent head layout, so targeted regexes are honest here — and
   they keep this repo to "clone it and it runs", same as the sites it checks. */

const fs = require("fs");
const path = require("path");
const { get } = require("./fetch");

/* Directories that never hold a publishable page. */
const SKIP_DIRS = new Set([
  ".git", ".github", "node_modules", ".wrangler", "worker",
  "scripts", "assets", "css", "js", "img", "images", "fonts",
]);

function walk(dir, root, out) {
  out = out || [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, root, out);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      out.push(path.relative(root, full));
    }
  }
  return out;
}

/* The path a page is canonically served at.

   Cloudflare Pages answers both `/guides/foo` and `/guides/foo.html`, so each
   site picks one and canonicalises to it. They picked differently: Quillbill
   drops the extension, Quire keeps it. Neither is wrong, but a checker that
   assumes one style reports every page on the other site as broken — which is
   worse than not checking at all, because you learn to ignore it.

   Directory indexes are the trailing-slash form in both styles; that part
   both sites do agree on. */
function servedPath(relPath, urlStyle) {
  const parts = relPath.split(path.sep).join("/");
  if (parts === "index.html") return "/";
  if (parts.endsWith("/index.html")) return "/" + parts.slice(0, -"index.html".length);
  if (urlStyle === "explicit") return "/" + parts;
  return "/" + parts.slice(0, -".html".length);
}

/* Conventional error pages. They are served, but they are not content: they
   belong in no sitemap and have no search snippet worth checking. */
const ERROR_PAGES = /^\/(?:404|403|500|_error)(?:\.html)?$/;

function isErrorPage(served) {
  return ERROR_PAGES.test(served);
}

/* Paths robots.txt tells crawlers to skip, so the sitemap builder and the
   auditor agree with robots.txt instead of drifting away from it. */
function parseRobots(text) {
  if (!text) return [];
  const out = [];
  let applies = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") applies = value === "*";
    else if (field === "disallow" && applies && value) out.push(value);
  }
  return out;
}

function isDisallowed(disallows, served, raw) {
  return disallows.some((d) =>
    served === d || raw === d ||
    (d.endsWith("/") && d !== "/" && (served.startsWith(d) || raw.startsWith(d))));
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–");
}

/* Scan out whole tags of one name, respecting quoted attribute values so a
   `>` or a quote inside a value doesn't end the tag early. */
function findTags(html, tagName) {
  const tags = [];
  const re = new RegExp("<" + tagName + "\\b", "gi");
  let m;
  while ((m = re.exec(html)) !== null) {
    let i = m.index + m[0].length;
    let quote = null;
    while (i < html.length) {
      const c = html[i];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      i++;
    }
    tags.push(html.slice(m.index, i + 1));
  }
  return tags;
}

/* Attributes of a single tag.

   This is a real parser rather than one regex per attribute because the naive
   version — matching `content="([^"']*)"` — silently stops at the first
   apostrophe in the value. A description reading "a family's photographs" came
   back as 24 characters, and the length check then reported a perfectly good
   description as far too short. Wrong answers are worse than no answers here:
   you go and "fix" something that was never broken. */
function tagAttrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag)) !== null) {
    const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
    out[m[1].toLowerCase()] = decodeEntities(value);
  }
  return out;
}

/* Pull one attribute off the tag carrying a known identifying attribute,
   e.g. the content of <meta property="og:title" ...>. */
function tagAttr(html, tag, keyAttr, keyValue, wanted) {
  for (const raw of findTags(html, tag)) {
    const attrs = tagAttrs(raw);
    if (attrs[keyAttr.toLowerCase()] === keyValue) {
      return attrs[wanted.toLowerCase()] !== undefined ? attrs[wanted.toLowerCase()] : null;
    }
  }
  return null;
}

/* Absolute URLs the browser fetches by itself when the page loads.

   <a href> and rel="canonical" are deliberately excluded: they are
   destinations, not subresources, and cost the visitor nothing. That
   distinction is the whole point of the app-purity check — app.html links to
   Stripe, which is fine; it must not *load* anything third-party. */
function subresourceUrls(html) {
  const out = [];
  const patterns = [
    /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi,
    /<link\b[^>]*\brel\s*=\s*["'](?:stylesheet|preload|preconnect|dns-prefetch|prefetch)["'][^>]*\bhref\s*=\s*["']([^"']+)["']/gi,
    /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["'](?:stylesheet|preload|preconnect|dns-prefetch|prefetch)["']/gi,
    /<(?:img|iframe|source|video|audio|embed|track)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi,
    /@import\s+(?:url\()?\s*["']([^"']+)["']/gi,
    /url\(\s*["']?(https?:\/\/[^"')\s]+)["']?\s*\)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) out.push(m[1]);
  }
  return out.filter((u) => /^(?:https?:)?\/\//i.test(u));
}

function hostOf(url) {
  const m = String(url).match(/^(?:https?:)?\/\/([^/?#:]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/* Every host mentioned by an absolute URL in a script. Deliberately blunt: for
   the app-purity check a false positive is a five-second read, a false
   negative is a broken promise on the landing page. */
function scriptHosts(source) {
  const hosts = new Set();
  const re = /https?:\/\/([a-z0-9.-]+)/gi;
  let m;
  while ((m = re.exec(source)) !== null) hosts.add(m[1].toLowerCase());
  return hosts;
}

function analyse(id, html, served, origin) {
  const title = html.match(/<title>([\s\S]*?)<\/title>/i);
  const jsonLd = [];
  const ldRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRe.exec(html)) !== null) jsonLd.push(m[1]);

  return {
    id,
    html,
    served,
    url: origin ? origin.replace(/\/$/, "") + served : served,
    title: title ? decodeEntities(title[1]).trim() : null,
    description: tagAttr(html, "meta", "name", "description", "content"),
    canonical: tagAttr(html, "link", "rel", "canonical", "href"),
    robotsMeta: tagAttr(html, "meta", "name", "robots", "content"),
    og: {
      title: tagAttr(html, "meta", "property", "og:title", "content"),
      description: tagAttr(html, "meta", "property", "og:description", "content"),
      image: tagAttr(html, "meta", "property", "og:image", "content"),
      url: tagAttr(html, "meta", "property", "og:url", "content"),
    },
    twitterCard: tagAttr(html, "meta", "name", "twitter:card", "content"),
    h1Count: (html.match(/<h1\b/gi) || []).length,
    jsonLd,
    subresources: subresourceUrls(html),
    scripts: (html.match(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi) || [])
      .map((t) => (t.match(/src\s*=\s*["']([^"']+)["']/i) || [])[1])
      .filter(Boolean),
    hasAnalytics: /cloudflareinsights\.com|data-cf-beacon|googletagmanager|google-analytics|plausible|umami/i.test(html),
    /* The beacon's site token, so a placeholder can't quietly reach
       production and collect nothing for a month. */
    beaconToken: (html.match(/data-cf-beacon\s*=\s*['"][^'"]*["']?token["']?\s*:\s*"([^"]+)"/i) || [])[1] || null,
    links: (html.match(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi) || [])
      .map((t) => decodeEntities((t.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || ""))
      .filter(Boolean),
  };
}

/* --- sources ------------------------------------------------------------ */

function fromDir(dir, origin, urlStyle) {
  const root = path.resolve(dir);
  const robotsFile = path.join(root, "robots.txt");
  const disallows = parseRobots(fs.existsSync(robotsFile) ? fs.readFileSync(robotsFile, "utf8") : "");

  const pages = walk(root, root).sort().map((rel) => {
    const html = fs.readFileSync(path.join(root, rel), "utf8");
    const served = servedPath(rel, urlStyle);
    const page = analyse(rel, html, served, origin);
    page.file = path.join(root, rel);
    page.isError = isErrorPage(served);
    page.indexable = !page.isError &&
      !isDisallowed(disallows, served, "/" + rel.split(path.sep).join("/"));
    return page;
  });

  let sitemap = null;
  const sitemapFile = path.join(root, "sitemap.xml");
  if (fs.existsSync(sitemapFile)) sitemap = parseSitemap(fs.readFileSync(sitemapFile, "utf8"));

  /* Cloudflare Pages publishes the whole directory. `.assetsignore` is the
     only thing keeping the parts of the repo that are not the website — the
     working notes, the tests, the Worker source — off the live domain. */
  const assetsIgnoreFile = path.join(root, ".assetsignore");
  const assetsIgnore = fs.existsSync(assetsIgnoreFile)
    ? fs.readFileSync(assetsIgnoreFile, "utf8").split("\n")
        .map((line) => line.replace(/#.*$/, "").trim()).filter(Boolean)
    : [];

  return { root, origin, pages, sitemap, disallows, assetsIgnore, mode: "dir" };
}

function parseSitemap(xml) {
  const out = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(decodeEntities(m[1]));
  return out;
}

/* Crawl the live site by way of its sitemap. Intentionally sitemap-driven
   rather than a link crawler: if a page is missing from the sitemap that is
   itself a finding, and the auditor will say so. */
async function fromOrigin(origin) {
  const base = origin.replace(/\/$/, "");
  const robots = await get(base + "/robots.txt").catch(() => ({ body: "" }));
  const disallows = parseRobots(robots.body);

  const sitemapRes = await get(base + "/sitemap.xml");
  const sitemap = parseSitemap(sitemapRes.body);

  const pages = [];
  for (const url of sitemap) {
    try {
      const res = await get(url);
      const served = url.startsWith(base) ? (url.slice(base.length) || "/") : url;
      const page = analyse(url, res.body, served, null);
      page.url = url;
      page.status = res.status;
      page.isError = isErrorPage(served);
      page.indexable = !page.isError && !isDisallowed(disallows, served, served);
      pages.push(page);
    } catch (err) {
      pages.push({ id: url, url, served: url, error: err.message, indexable: true, jsonLd: [], subresources: [], links: [], scripts: [] });
    }
  }
  return { root: null, origin: base, pages, sitemap, disallows, mode: "origin" };
}

module.exports = {
  fromDir, fromOrigin, parseSitemap, parseRobots, servedPath, isErrorPage,
  hostOf, scriptHosts, decodeEntities, walk, analyse,
};
