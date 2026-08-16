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

/* The path Cloudflare Pages serves a file at: it drops the .html extension and
   serves directory indexes at the trailing-slash form. That's why the canonical
   tags on both sites carry no .html — and why comparing them naively to the
   filename reports a mismatch that isn't real. */
function servedPath(relPath) {
  const parts = relPath.split(path.sep).join("/");
  if (parts === "index.html") return "/";
  if (parts.endsWith("/index.html")) return "/" + parts.slice(0, -"index.html".length);
  return "/" + parts.slice(0, -".html".length);
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

/* Pull one attribute off the tag that carries a known identifying attribute,
   e.g. the content of <meta property="og:title" ...>. */
function tagAttr(html, tag, keyAttr, keyValue, wanted) {
  const escaped = keyValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("<" + tag + "\\b[^>]*\\b" + keyAttr +
    "\\s*=\\s*[\"']" + escaped + "[\"'][^>]*>", "i");
  const found = html.match(re);
  if (!found) return null;
  const value = found[0].match(new RegExp("\\b" + wanted + "\\s*=\\s*[\"']([^\"']*)[\"']", "i"));
  return value ? decodeEntities(value[1]) : null;
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
    links: (html.match(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi) || [])
      .map((t) => decodeEntities((t.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || ""))
      .filter(Boolean),
  };
}

/* --- sources ------------------------------------------------------------ */

function fromDir(dir, origin) {
  const root = path.resolve(dir);
  const robotsFile = path.join(root, "robots.txt");
  const disallows = parseRobots(fs.existsSync(robotsFile) ? fs.readFileSync(robotsFile, "utf8") : "");

  const pages = walk(root, root).sort().map((rel) => {
    const html = fs.readFileSync(path.join(root, rel), "utf8");
    const served = servedPath(rel);
    const page = analyse(rel, html, served, origin);
    page.file = path.join(root, rel);
    page.indexable = !isDisallowed(disallows, served, "/" + rel.split(path.sep).join("/"));
    return page;
  });

  let sitemap = null;
  const sitemapFile = path.join(root, "sitemap.xml");
  if (fs.existsSync(sitemapFile)) sitemap = parseSitemap(fs.readFileSync(sitemapFile, "utf8"));

  return { root, origin, pages, sitemap, disallows, mode: "dir" };
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
      page.indexable = !isDisallowed(disallows, served, served);
      pages.push(page);
    } catch (err) {
      pages.push({ id: url, url, served: url, error: err.message, indexable: true, jsonLd: [], subresources: [], links: [], scripts: [] });
    }
  }
  return { root: null, origin: base, pages, sitemap, disallows, mode: "origin" };
}

module.exports = {
  fromDir, fromOrigin, parseSitemap, parseRobots, servedPath,
  hostOf, scriptHosts, decodeEntities, walk, analyse,
};
