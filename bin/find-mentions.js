#!/usr/bin/env node
/* Finds public threads where someone is actively looking for what one of
   these products does, and hands you a ranked shortlist to answer by hand.

   What this tool does NOT do, by design: post anything. The automation is in
   the finding. Every reply is written by a person, in the thread's own
   context, disclosing that they built the thing. Auto-posting is how a small
   brand gets banned from the three communities that were going to be its
   first hundred customers — and the reply that works is the one that answers
   the actual question, which is not a job for a template.

   It also refuses to prospect segments marked `solicit: false` in sites.js.
   That is not squeamishness: see the `bereaved` segment for why.

   Usage:
     node bin/find-mentions.js                          # every soliciting segment, last 7 days
     node bin/find-mentions.js quillbill --days 14
     node bin/find-mentions.js --out digest.md */

const fs = require("fs");
const { getJson, sleep } = require("../lib/fetch");
const SITES = require("../sites");

function parseArgs(argv) {
  const args = { keys: [], days: 7, out: null, limit: 12 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") args.days = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (!a.startsWith("-")) args.keys.push(a);
  }
  if (!args.keys.length) args.keys = Object.keys(SITES);
  return args;
}

/* How much a thread looks like a buying question rather than chatter. Kept
   deliberately simple and legible — you are going to read every hit anyway,
   so the score only has to sort them, not judge them. */
function score(text, intentWords) {
  const haystack = String(text || "").toLowerCase();
  let n = 0;
  for (const word of intentWords) if (haystack.includes(word)) n += 1;
  if (/\?/.test(haystack)) n += 1;
  return n;
}

function truncate(s, n) {
  const clean = String(s || "").replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n - 1) + "…" : clean;
}

/* --- sources ------------------------------------------------------------ */

/* Hacker News via the Algolia API: free, no key, no rate limit worth worrying
   about. Comments matter as much as stories — "what do you use for invoicing"
   usually shows up buried in an Ask HN thread. */
async function searchHn(query, sinceTs) {
  const url = "https://hn.algolia.com/api/v1/search_by_date" +
    `?query=${encodeURIComponent(query)}` +
    "&tags=(story,comment)" +
    `&numericFilters=created_at_i>${sinceTs}` +
    "&hitsPerPage=30";
  const data = await getJson(url);
  return (data.hits || []).map((hit) => ({
    source: "HN",
    title: hit.title || hit.story_title || "(comment)",
    text: [hit.title, hit.story_title, hit.comment_text, hit.story_text].filter(Boolean).join(" "),
    url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    author: hit.author,
    created: hit.created_at,
    engagement: hit.points || hit.num_comments || 0,
  }));
}

/* Reddit's public search JSON needs no key, but it rate-limits hard and often
   refuses datacenter IPs outright. A failure here is expected rather than
   exceptional, so it degrades to a note in the digest.

   One request per query term, with the subreddits folded into the query via
   Reddit's own `subreddit:` operator, rather than one request per
   subreddit-times-term. Eight subreddits and nine terms is 72 requests done
   naively and 9 done this way — the difference between a run that gets
   throttled halfway and one that finishes. */
async function searchReddit(subreddits, query, days) {
  const t = days <= 7 ? "week" : days <= 31 ? "month" : "year";
  const scope = subreddits.map((s) => `subreddit:${s}`).join(" OR ");
  const q = `${query} (${scope})`;
  const url = "https://www.reddit.com/search.json" +
    `?q=${encodeURIComponent(q)}&sort=new&t=${t}&limit=50`;
  const data = await getJson(url, { attempts: 2 });
  return (data.data && data.data.children || []).map((child) => {
    const post = child.data;
    return {
      source: `r/${post.subreddit}`,
      title: post.title,
      text: [post.title, post.selftext].filter(Boolean).join(" "),
      url: `https://www.reddit.com${post.permalink}`,
      author: post.author,
      created: new Date(post.created_utc * 1000).toISOString(),
      engagement: post.num_comments || 0,
    };
  });
}

/* --- gathering ---------------------------------------------------------- */

async function gatherSegment(config, segment, args, notes) {
  const sinceTs = Math.floor(Date.now() / 1000) - args.days * 86400;
  const blocked = new Set((config.blockedSubreddits || []).map((s) => s.toLowerCase()));
  const hits = [];

  for (const query of segment.hn || []) {
    try {
      hits.push(...await searchHn(query, sinceTs));
    } catch (err) {
      notes.push(`HN search for ${JSON.stringify(query)} failed: ${err.message}`);
    }
    await sleep(300);
  }

  /* Defence in depth: a blocked community stays blocked even if a segment
     lists it by mistake. */
  const reddit = segment.reddit || {};
  const subreddits = (reddit.subreddits || []).filter((s) => {
    if (!blocked.has(s.toLowerCase())) return true;
    notes.push(`skipped r/${s} — on this product's blocked list`);
    return false;
  });

  if (subreddits.length) {
    for (const query of reddit.queries || []) {
      try {
        const found = await searchReddit(subreddits, query, args.days);
        /* Reddit's boolean scoping is best-effort, so drop anything that came
           back from outside the segment's own communities. */
        const allowed = new Set(subreddits.map((s) => s.toLowerCase()));
        hits.push(...found.filter((h) => allowed.has(h.source.slice(2).toLowerCase())));
      } catch (err) {
        notes.push(`Reddit search for ${JSON.stringify(query)} failed: ${err.message}`);
      }
      await sleep(1200); /* Reddit is strict about unauthenticated bursts. */
    }
  }

  const seen = new Set();
  return hits
    .filter((hit) => { if (seen.has(hit.url)) return false; seen.add(hit.url); return true; })
    .map((hit) => Object.assign(hit, { score: score(hit.text, config.intentWords || []) }))
    .sort((a, b) => (b.score - a.score) || (b.engagement - a.engagement))
    .slice(0, args.limit);
}

/* --- output ------------------------------------------------------------- */

function render(results, args) {
  const lines = [
    `# Outreach shortlist — last ${args.days} days`,
    "",
    "Threads where someone appears to be looking for one of these products.",
    "**Reply as yourself, in the thread's own terms, and say you built it.**",
    "Skip anything where the honest answer is a competitor.",
    "",
  ];

  for (const entry of results) {
    lines.push(`## ${entry.site}`, "");

    for (const skipped of entry.skipped) {
      lines.push(`### ${skipped.label} — not prospected`, "",
        `\`solicit: false\` in sites.js. ${skipped.reason}`,
        `Channels for this segment: ${(skipped.channels || []).join(", ")}.`, "");
    }

    for (const seg of entry.segments) {
      lines.push(`### ${seg.label}`, "");
      lines.push(`*${seg.tone}*`, "");
      if (!seg.hits.length) {
        lines.push("Nothing this week.", "");
      } else {
        lines.push("| Score | Where | Thread | Comments |", "| --- | --- | --- | --- |");
        for (const hit of seg.hits) {
          lines.push(`| ${hit.score} | ${hit.source} | [${truncate(hit.title, 80).replace(/\|/g, "\\|")}](${hit.url}) | ${hit.engagement} |`);
        }
        lines.push("");
      }
      if (seg.notes.length) {
        lines.push("<details><summary>Source notes</summary>", "",
          ...seg.notes.map((n) => `- ${n}`), "", "</details>", "");
      }
    }
  }
  return lines.join("\n");
}

/* --- main --------------------------------------------------------------- */

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const results = [];

  for (const key of args.keys) {
    const config = SITES[key];
    if (!config) { console.error(`unknown site: ${key}`); process.exit(2); }

    const entry = { site: config.name, segments: [], skipped: [] };

    for (const segment of config.segments || []) {
      if (!segment.solicit) {
        entry.skipped.push({
          label: segment.label,
          reason: segment.soliciteReason || "Marked as not to be prospected.",
          channels: segment.channels,
        });
        console.error(`skip  ${config.name} / ${segment.label} — solicit: false`);
        continue;
      }
      console.error(`scan  ${config.name} / ${segment.label}`);
      const notes = [];
      const hits = await gatherSegment(config, segment, args, notes);
      entry.segments.push({ label: segment.label, tone: segment.tone, hits, notes });
      console.error(`      ${hits.length} candidate(s), ${notes.length} source note(s)`);
    }
    results.push(entry);
  }

  const markdown = render(results, args);
  if (args.out) { fs.writeFileSync(args.out, markdown); console.error(`wrote ${args.out}`); }
  else { console.log(markdown); }
})();
