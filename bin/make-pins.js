#!/usr/bin/env node
/* Builds a queue of Pinterest pins from the guides, as images plus the text
 * to post with them.
 *
 * Why Pinterest and nothing else: it is a search engine wearing a social
 * network's clothes. Nothing here is pushed at anybody — a pin sits in an
 * index and is found by someone typing "how many orders of service to print",
 * which is the same act as a Google search and carries the same consent. It
 * is also the only free channel where a single post keeps returning traffic
 * for years instead of dying in two days, which matters a great deal when the
 * person doing the marketing has about an hour a week for it.
 *
 * The blocker was always the images: a pin is 1000×1500 and text-only pins do
 * not work. So the images are rendered here from the guides' own content, in
 * each site's own colours and type, by the copy of Chrome already on the
 * machine. No design tool, no subscription, no credentials.
 *
 * What this tool does NOT do is post. That is bin/post-pins.js, and it is a
 * separate program on purpose: this one is safe to run at any time, produces
 * nothing but files, and needs no account. Run it, look at the PNGs, and
 * either upload them by hand or hand the manifest to the poster.
 *
 * Rules it enforces rather than documents:
 *
 *   - A pin whose destination page does not exist fails. Pinterest keeps
 *     dead pins alive for years.
 *   - A pin quoting a price the destination page does not quote fails. The
 *     guides rank on being specific and correct; a pin that promises $43 and
 *     lands on a page saying $65 is worse than no pin.
 *   - For a segment marked solicit: false — the families arranging a funeral —
 *     exclamation marks, urgency vocabulary and prices in the headline fail.
 *     That segment's tone rule is not a style preference, and a comment in a
 *     config file is not enforcement.
 *
 * Usage:
 *   node bin/make-pins.js                       # both sites, local checkouts
 *   node bin/make-pins.js orderofservicemaker
 *   node bin/make-pins.js --live                # read pages from production
 *   node bin/make-pins.js --check               # validate only, render nothing
 *   node bin/make-pins.js --start 2026-09-01 --per-week 3
 */

const fs = require("fs");
const path = require("path");
const site = require("../lib/site");
const art = require("../lib/pin-art");
const { renderToPng, pngSize } = require("../lib/render");
const SITES = require("../sites");

const OUT = "out/pins";

function parseArgs(argv) {
  const args = {
    keys: [], live: false, dirs: {}, dir: null, out: OUT, check: false,
    selfTest: false, start: null, perWeek: 3,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") args.live = true;
    else if (a === "--dir") {
      /* Either a bare path, or key=path when the two checkouts are not
         siblings — which they are not on every machine. */
      const v = argv[++i];
      const eq = v.indexOf("=");
      if (eq > 0) args.dirs[v.slice(0, eq)] = v.slice(eq + 1);
      else args.dir = v;
    }
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--check") args.check = true;
    else if (a === "--self-test") args.selfTest = true;
    else if (a === "--start") args.start = argv[++i];
    else if (a === "--per-week") args.perWeek = Math.max(1, Number(argv[++i]) || 3);
    else if (!a.startsWith("-")) args.keys.push(a);
  }
  if (!args.keys.length) args.keys = Object.keys(SITES);
  return args;
}

/* --- linting ------------------------------------------------------------ */

/* Language that sells urgency. Banned outright for the bereaved segment, where
   it is not merely off-brand — the whole premise of that segment is that they
   already have a deadline and do not need one manufactured. */
const URGENCY = [
  "hurry", "act now", "don't miss", "dont miss", "last chance", "limited time",
  "only today", "while you can", "deal", "discount", "sale", "bargain",
  "cheap", "cheapest", "best price", "must-have", "must have", "amazing",
  "stunning", "gorgeous", "perfect for", "ultimate", "you won't believe",
  "grab", "snap up", "hot", "trending",
];

/* Matched on word boundaries, not as substrings: "hot" inside "photograph"
   flagged a paragraph about paper weight, which is exactly the kind of false
   positive that teaches you to ignore a checker. */
const URGENCY_RE = URGENCY.map((w) =>
  new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i"));

const EMOJI = /\p{Extended_Pictographic}/u;

function pinText(pin) {
  const parts = [pin.kicker, pin.headline, pin.support, pin.title, pin.description];
  for (const r of pin.rows || []) parts.push(r.label, r.value);
  for (const i of pin.items || []) parts.push(i);
  return parts.filter(Boolean);
}

/* Every dollar figure in a string, normalised so "≈$245" and "$245" match. */
function dollars(text) {
  return (String(text).match(/\$\s?[0-9][0-9,]*(?:\.[0-9]+)?/g) || [])
    .map((s) => s.replace(/\s/g, ""));
}

function visibleText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

function lint(pin, segment, page) {
  const problems = [];
  const strict = segment.solicit === false;
  const texts = pinText(pin);

  for (const t of texts) {
    if (EMOJI.test(t)) problems.push(`emoji in "${t.slice(0, 40)}…" — neither brand uses them`);
    const shouty = String(t).match(/\b[A-Z]{4,}\b/g);
    if (shouty) problems.push(`shouting: ${shouty.join(", ")}`);
  }

  if (strict) {
    for (const t of texts) {
      if (t.includes("!")) {
        problems.push(`exclamation mark in "${t.slice(0, 40)}…" — ${segment.id} is solicit: false`);
      }
      for (let i = 0; i < URGENCY_RE.length; i++) {
        if (URGENCY_RE[i].test(t)) {
          problems.push(`urgency word "${URGENCY[i]}" in "${t.slice(0, 40)}…"`);
        }
      }
    }
    if (/\$/.test(pin.headline)) {
      problems.push("price in the headline — a cost guide may quote figures in the body, " +
        "but a headline led by a price is a sales pin");
    }
  }

  /* Every figure on the pin has to be a figure on the page it links to. */
  const onPage = new Set(dollars(visibleText(page && page.html)));
  for (const t of texts) {
    for (const amount of dollars(t)) {
      if (!onPage.has(amount)) {
        problems.push(`${amount} is on the pin but not on ${pin.page}`);
      }
    }
  }

  /* Pinterest's own limits. Exceeding them truncates silently mid-sentence. */
  if (pin.title && pin.title.length > 100) problems.push(`title is ${pin.title.length} chars (max 100)`);
  if (pin.description && pin.description.length > 500) {
    problems.push(`description is ${pin.description.length} chars (max 500)`);
  }
  return problems;
}

/* --- proving the rules fire --------------------------------------------- */

/* The tone rules are the reason this tool is allowed to exist for a segment
   marked solicit: false, so "they are in the code" is not enough — they have
   to be shown working, including the case where a well-behaved pin passes.
   A rule that flags everything gets switched off within a month.

   node bin/make-pins.js --self-test */
function selfTest() {
  const page = { html: "<p>Fifty booklets from a printer is about $245.</p>" };
  const funeral = { id: "bereaved", solicit: false };
  const wedding = { id: "weddings", solicit: true };
  const base = { page: "/x", kicker: "k", headline: "How many to print", support: "s" };

  const cases = [
    ["exclamation mark, funeral", funeral,
      Object.assign({}, base, { support: "Order yours today!" }), /exclamation/],
    ["urgency word, funeral", funeral,
      Object.assign({}, base, { support: "The cheapest booklets anywhere." }), /urgency word/],
    ["price in the headline, funeral", funeral,
      Object.assign({}, base, { headline: "Booklets from $43" }), /price in the headline/],
    ["figure not on the page", wedding,
      Object.assign({}, base, { support: "Only $999." }), /\$999 is on the pin/],
    ["emoji, either segment", wedding,
      Object.assign({}, base, { headline: "Lovely booklets 🎉" }), /emoji/],
    ["a clean funeral pin", funeral,
      Object.assign({}, base, { support: "Fifty booklets is about $245 from a printer." }), null],
  ];

  let bad = 0;
  for (const [name, segment, pin, expect] of cases) {
    const problems = lint(pin, segment, page);
    const hit = problems.some((p) => expect && expect.test(p));
    if (expect && !hit) { console.error(`✗ not caught: ${name} — got ${JSON.stringify(problems)}`); bad++; }
    else if (!expect && problems.length) { console.error(`✗ false positive: ${name} — ${problems.join("; ")}`); bad++; }
    else console.error(`✓ ${name}`);
  }
  process.exit(bad ? 1 : 0);
}

/* --- assembly ----------------------------------------------------------- */

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function altText(pin) {
  const bits = [pin.headline];
  if (pin.rows) bits.push(pin.rows.map((r) => `${r.label}: ${r.value}`).join("; "));
  if (pin.items) bits.push(pin.items.join("; "));
  if (pin.support) bits.push(pin.support);
  return ("Text card. " + bits.filter(Boolean).join(". ")).slice(0, 480);
}

function collect(key, config, model) {
  const byPath = new Map();
  for (const page of model.pages) byPath.set(page.served, page);

  const groups = [];
  for (const segment of config.segments || []) {
    if (!segment.pinterest || !segment.pinterest.pins) continue;
    const seen = new Map();
    const pins = [];

    for (const raw of segment.pinterest.pins) {
      const page = byPath.get(raw.page);
      const pin = Object.assign({}, raw);
      pin.domain = config.origin.replace(/^https?:\/\//, "");
      pin.footNote = segment.id === "weddings" ? "Wedding order of service"
        : segment.id === "bereaved" ? "Order of service booklets"
        : "Invoicing without a subscription";
      pin.title = pin.title || pin.headline;
      pin.description = pin.description || (page && page.description) || pin.support || "";
      pin.alt = pin.alt || altText(pin);
      pin.link = page ? (page.canonical || page.url) : null;

      const problems = page ? lint(pin, segment, page)
        : [`no such page: ${raw.page} — the pin would link to a 404`];

      let slug = slugify(pin.title);
      const n = (seen.get(slug) || 0) + 1;
      seen.set(slug, n);
      if (n > 1) slug = `${slug}-${n}`;
      pin.slug = `${segment.id}-${slug}`;

      pins.push({ pin, problems, layouts: art.layoutsFor(pin) });
    }

    groups.push({
      siteKey: key, siteName: config.name, segment: segment.id,
      label: segment.label, board: segment.pinterest.board, pins,
    });
  }
  return groups;
}

/* Round-robin across boards rather than emptying one board at a time.

   Pinterest rewards a board that gains a pin every few days over one that
   gains twenty in an afternoon and then nothing, and the boards belong to
   different audiences anyway — six funeral pins in a row is a bad week for
   the wedding board. */
function schedule(items, startISO, perWeek) {
  const start = startISO ? new Date(startISO + "T12:00:00Z") : new Date(Date.now() + 86400000);
  const everyDays = Math.max(1, Math.round(7 / perWeek));
  return items.map((item, i) => {
    const d = new Date(start.getTime() + i * everyDays * 86400000);
    return Object.assign({ date: d.toISOString().slice(0, 10) }, item);
  });
}

/* The order the images get posted in, which is doing two jobs at once.

   Across boards: round-robin, because Pinterest rewards a board that gains a
   pin every few days over one that gains twenty in an afternoon, and the
   boards belong to different audiences anyway — six funeral pins in a row is
   a bad week for the wedding board.

   Across layouts: every pin's first image goes out before any pin's second
   one. Two images of the same guide are near-duplicates to Pinterest, and
   posting them in the same week is how a URL gets treated as spam rather than
   as a page worth ranking. This spacing puts about a month between them
   without anyone having to remember to do it. */
function order(groups) {
  const depth = Math.max(...groups.map((g) =>
    Math.max(0, ...g.pins.map((p) => p.layouts.length))));
  const widest = Math.max(...groups.map((g) => g.pins.length));

  const out = [];
  for (let layer = 0; layer < depth; layer++) {
    for (let i = 0; i < widest; i++) {
      for (const group of groups) {
        const entry = group.pins[i];
        if (!entry || !entry.layouts[layer]) continue;
        out.push({ group, entry, layout: entry.layouts[layer] });
      }
    }
  }
  return out;
}

function queueMarkdown(rows, args) {
  const lines = [
    "# Pin queue",
    "",
    `Generated ${new Date().toISOString().slice(0, 10)} · ${rows.length} pins · ` +
    `about ${args.perWeek} a week.`,
    "",
    "Post them in this order. The dates are a suggestion, not a deadline — the",
    "only thing that matters is that each board keeps gaining pins steadily",
    "rather than in one burst. Copy the title and description as they are; both",
    "are indexed, and both were checked against the page they link to.",
    "",
  ];

  lines.push("| Date | Board | Image | Title | Link |", "| --- | --- | --- | --- | --- |");
  for (const r of rows) {
    lines.push(`| ${r.date} | ${r.board} | \`${r.file}\` | ${r.title} | ${r.link} |`);
  }
  lines.push("");

  lines.push("## The text for each one", "");
  for (const r of rows) {
    lines.push(`### ${r.date} — ${r.title}`, "",
      `- **Board:** ${r.board}`,
      `- **Image:** \`${r.file}\``,
      `- **Link:** ${r.link}`,
      `- **Description:** ${r.description}`,
      `- **Alt text:** ${r.alt}`,
      "");
  }
  return lines.join("\n");
}

/* --- main --------------------------------------------------------------- */

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();

  const groups = [];

  for (const key of args.keys) {
    const config = SITES[key];
    if (!config) { console.error(`unknown site: ${key}`); process.exit(2); }

    let model;
    if (args.live) {
      model = await site.fromOrigin(config.origin);
    } else {
      const dir = path.resolve(process.cwd(), args.dirs[key] || args.dir || config.localPath);
      if (!fs.existsSync(dir)) {
        console.error(`no checkout of ${config.name} at ${dir}\n` +
          `  point at it with --dir ${key}=/path/to/checkout, or use --live to read ` +
          `the pages from ${config.origin}.`);
        process.exit(2);
      }
      model = site.fromDir(dir, config.origin, config.urlStyle);
    }

    groups.push(...collect(key, config, model));
  }

  if (!groups.length) {
    console.error("no segments have a pinterest block in sites.js — nothing to make.");
    process.exit(0);
  }

  /* Lint everything before rendering anything, so a bad figure is one message
     at the top rather than a surprise after thirty screenshots. */
  let failed = 0;
  for (const g of groups) {
    for (const { pin, problems } of g.pins) {
      for (const p of problems) {
        console.error(`✗ ${g.siteKey}/${g.segment} · ${pin.title}: ${p}`);
        failed++;
      }
    }
  }
  if (failed) {
    console.error(`\n${failed} problem(s). Nothing rendered — fix sites.js and run again.`);
    process.exit(1);
  }

  const rows = [];
  for (const { group, entry, layout } of order(groups)) {
    const file = path.join(args.out, group.siteKey, `${entry.pin.slug}--${layout}.png`);
    if (!args.check) {
      renderToPng(art.render(entry.pin, layout, group.siteKey), {
        width: art.WIDTH, height: art.HEIGHT, out: file,
      });
      /* Trust the file, not the flag: a screenshot that came out the wrong
         size is a pin Pinterest crops for you, and it crops the bottom. */
      const size = pngSize(file);
      if (!size || size.width !== art.WIDTH || size.height !== art.HEIGHT) {
        console.error(`✗ ${file} came out ${size ? size.width + "×" + size.height : "unreadable"}, ` +
          `not ${art.WIDTH}×${art.HEIGHT}`);
        process.exit(1);
      }
    }
    rows.push({
      site: group.siteKey, segment: group.segment, board: group.board,
      layout, file, title: entry.pin.title, description: entry.pin.description,
      alt: entry.pin.alt, link: entry.pin.link,
    });
  }

  const dated = schedule(rows, args.start, args.perWeek);

  if (args.check) {
    console.error(`✓ ${groups.reduce((n, g) => n + g.pins.length, 0)} pins check out ` +
      `(${dated.length} images would be written to ${args.out}/).`);
    process.exit(0);
  }

  fs.mkdirSync(args.out, { recursive: true });
  fs.writeFileSync(path.join(args.out, "pins.json"), JSON.stringify(dated, null, 2) + "\n");
  fs.writeFileSync(path.join(args.out, "queue.md"), queueMarkdown(dated, args));

  const boards = [...new Set(dated.map((r) => r.board))];
  console.error(`✓ ${dated.length} pins across ${boards.length} boards → ${args.out}/`);
  for (const b of boards) {
    console.error(`    ${b}: ${dated.filter((r) => r.board === b).length}`);
  }
  console.error(`  ${args.out}/queue.md is the posting list.`);
  console.error(`  Last one lands ${dated[dated.length - 1].date} at ${args.perWeek} a week.`);
})();
