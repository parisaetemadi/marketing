#!/usr/bin/env node
/* Weekly: which pages got read, and what got sold.
 *
 * Reads Cloudflare Web Analytics for traffic and Stripe for sales, and puts
 * them side by side per product.
 *
 * READ THIS BEFORE TRUSTING A NUMBER IN THE OUTPUT
 *
 * This does not attribute sales to pages, and cannot. Cloudflare Web Analytics
 * is deliberately cookieless — there is no visitor id, so there is no way to
 * follow the person who read the funeral cost guide on Tuesday to the purchase
 * they made on Thursday. Anyone claiming otherwise from this data is guessing.
 *
 * What it gives you is two honest halves: which pages people actually read,
 * and how much money arrived. Over enough weeks that correlation is worth
 * something. It is not causation and the report says so.
 *
 * To get real attribution, put a marker on the links from the guides into the
 * studio — /app.html?from=hymns — and the studio's pageview path will carry it.
 * That is a small change to the sites and it is the honest way to close this
 * gap. See the note the report prints.
 *
 * Needs, as repo secrets:
 *   CF_API_TOKEN     Cloudflare API token. It must include an ACCOUNT-scoped
 *                    permission — Account Analytics: Read — not just the
 *                    zone-scoped Zone Analytics, and its Account Resources
 *                    must include the account. Web Analytics is account-level.
 *   STRIPE_API_KEY   Stripe restricted key, read on Charges
 *   EXCLUDE_EMAILS   Optional, comma-separated. Your own addresses, so test
 *                    purchases are not reported back to you as revenue.
 *
 * Usage:
 *   node bin/revenue-report.js --days 7
 *   node bin/revenue-report.js --out report.md
 */

const fs = require("fs");
const SITES = require("../sites");

const CF_ACCOUNT = process.env.CF_ACCOUNT_ID || "40d8b65ad328759ca76c4480ee080b11";
const CF_TOKEN = process.env.CF_API_TOKEN;
const STRIPE_KEY = process.env.STRIPE_API_KEY;

function parseArgs(argv) {
  const args = { days: 7, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--days") args.days = Number(argv[++i]);
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  return args;
}

function money(cents, currency) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: (currency || "usd").toUpperCase() });
}

/* --- Cloudflare ---------------------------------------------------------- */

/* Web Analytics lives in the RUM dataset. siteTag is the same token that sits
   in the data-cf-beacon attribute on the pages. */
async function cloudflarePages(siteTag, sinceIso, untilIso) {
  const query = `
    query PageViews($account: String!, $siteTag: String!, $since: Time!, $until: Time!) {
      viewer {
        accounts(filter: { accountTag: $account }) {
          rumPageloadEventsAdaptiveGroups(
            filter: { siteTag: $siteTag, datetime_geq: $since, datetime_leq: $until }
            limit: 100
            orderBy: [count_DESC]
          ) {
            count
            dimensions { requestPath }
          }
        }
      }
    }`;

  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + CF_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { account: CF_ACCOUNT, siteTag, since: sinceIso, until: untilIso },
    }),
  });

  if (!res.ok) throw new Error(`Cloudflare HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  if (body.errors && body.errors.length) {
    const message = body.errors.map((e) => e.message).join("; ");
    /* The most likely misconfiguration, and the message alone does not say so.
       Web Analytics is an account-level dataset, but the obvious token
       template ("Read analytics and logs") only grants zone-level scopes, so a
       token made that way authenticates fine and then cannot see anything. */
    if (/not authorized for that account|Authentication error/i.test(message)) {
      throw new Error(message + " — the token needs Account → Account Analytics → Read. " +
        "The 'Read analytics and logs' template is zone-scoped and does not include it.");
    }
    throw new Error("Cloudflare GraphQL: " + message);
  }
  const account = body.data && body.data.viewer && body.data.viewer.accounts && body.data.viewer.accounts[0];
  if (!account) throw new Error("Cloudflare returned no account — check CF_ACCOUNT_ID and the token's scope");

  return (account.rumPageloadEventsAdaptiveGroups || []).map((g) => ({
    path: g.dimensions.requestPath,
    views: g.count,
  }));
}

/* --- Stripe -------------------------------------------------------------- */

/* Charges rather than checkout sessions, because a restricted key scoped to
   read Charges is the smallest thing that answers the question. Products are
   told apart by amount, which works here only because the three price points
   are distinct — see `stripeAmounts` in sites.js. */
async function stripeCharges(sinceTs) {
  const url = `https://api.stripe.com/v1/charges?limit=100&created[gte]=${sinceTs}`;
  const res = await fetch(url, { headers: { Authorization: "Bearer " + STRIPE_KEY } });
  if (!res.ok) throw new Error(`Stripe HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();

  const paid = (body.data || []).filter((c) => c.paid && c.status === "succeeded");

  /* Your own test purchases are real charges on a real card, so nothing in the
     Stripe data distinguishes them from a customer. Left in, they are reported
     as revenue — which is worse than reporting nothing, because a founder
     checking their own numbers is exactly the person who will believe them.
     Set EXCLUDE_EMAILS (comma-separated) as a repo secret; it stays out of
     this repo, which is public. */
  const excluded = (process.env.EXCLUDE_EMAILS || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

  const kept = paid.filter((c) => {
    const email = ((c.billing_details && c.billing_details.email) || c.receipt_email || "").toLowerCase();
    return !(email && excluded.includes(email));
  });

  /* Refunded charges are not sales either — a test you refunded is a round
     trip, not revenue. */
  const real = kept.filter((c) => !c.refunded);

  return { all: paid, real, excludedCount: paid.length - kept.length, refundedCount: kept.length - real.length };
}

/* --- report -------------------------------------------------------------- */

function render(sections, args, notes) {
  const lines = [
    `# Traffic and sales — last ${args.days} days`,
    "",
    "> **These two halves are not linked.** Cloudflare Web Analytics is cookieless,",
    "> so there is no way to follow a reader from a guide to a purchase. Read this as",
    "> two facts side by side, not as attribution.",
    "",
  ];

  for (const s of sections) {
    lines.push(`## ${s.name}`, "");

    if (s.error) {
      lines.push(`Could not read traffic: ${s.error}`, "");
    } else if (!s.pages.length) {
      lines.push("No pageviews recorded in this window.", "");
    } else {
      lines.push("| Page | Views |", "| --- | --- |");
      for (const p of s.pages.slice(0, 15)) lines.push(`| \`${p.path}\` | ${p.views} |`);
      lines.push("", `**${s.totalViews} pageviews** across ${s.pages.length} paths.`, "");
    }

    if (s.salesError) {
      lines.push(`Could not read sales: ${s.salesError}`, "");
    } else {
      lines.push(s.sales.count
        ? `**${s.sales.count} sale(s), ${money(s.sales.gross, s.sales.currency)}.**`
        : "**No sales in this window.**", "");
    }
  }

  if (notes.length) {
    lines.push("---", "", "### Notes", "", ...notes.map((n) => `- ${n}`), "");
  }

  lines.push("---", "",
    "### Making this attribution real",
    "",
    "Right now the two halves cannot be joined. The fix is small: tag the links that",
    "go from a guide into the studio, e.g. `/app.html?from=hymns`, and the studio's",
    "own pageview path will then carry which guide sent it. One line per guide, and",
    "this report starts answering *which page earns the money* rather than *what",
    "happened this week*.");
  return lines.join("\n");
}

/* --- main ---------------------------------------------------------------- */

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const notes = [];

  if (!CF_TOKEN) notes.push("CF_API_TOKEN is not set — traffic skipped.");
  if (!STRIPE_KEY) notes.push("STRIPE_API_KEY is not set — sales skipped.");

  const until = new Date();
  const since = new Date(until.getTime() - args.days * 86400000);
  const sinceIso = since.toISOString().replace(/\.\d+Z$/, "Z");
  const untilIso = until.toISOString().replace(/\.\d+Z$/, "Z");

  let charges = null, chargesError = null;
  if (STRIPE_KEY) {
    try {
      const result = await stripeCharges(Math.floor(since.getTime() / 1000));
      charges = result.real;
      console.error(`stripe: ${result.all.length} succeeded, ${charges.length} counted as sales`);
      if (result.excludedCount) {
        notes.push(`${result.excludedCount} charge(s) excluded as your own (EXCLUDE_EMAILS).`);
      }
      if (result.refundedCount) {
        notes.push(`${result.refundedCount} refunded charge(s) not counted.`);
      }
      /* Only worth saying when something is actually being counted. Refunds
         are already excluded, so a founder who refunds their own tests never
         needs this — nagging them weekly about it is how a report stops being
         read. */
      if (!process.env.EXCLUDE_EMAILS && charges.length) {
        notes.push(`${charges.length} charge(s) counted as sales. If any are your own ` +
          "and were not refunded, set EXCLUDE_EMAILS as a repo secret to filter them.");
      }
    } catch (err) {
      chargesError = err.message;
      console.error("stripe FAILED: " + err.message);
    }
  }

  const sections = [];
  for (const [key, config] of Object.entries(SITES)) {
    const section = { name: config.name, pages: [], totalViews: 0, sales: { count: 0, gross: 0 } };

    const siteTag = config.analyticsSiteTag;
    if (!CF_TOKEN) section.error = "no CF_API_TOKEN";
    else if (!siteTag) section.error = "no analyticsSiteTag in sites.js";
    else {
      try {
        section.pages = await cloudflarePages(siteTag, sinceIso, untilIso);
        section.totalViews = section.pages.reduce((n, p) => n + p.views, 0);
        console.error(`${config.name}: ${section.totalViews} pageview(s)`);
      } catch (err) {
        section.error = err.message;
        console.error(`${config.name} traffic FAILED: ${err.message}`);
      }
    }

    if (chargesError) section.salesError = chargesError;
    else if (charges) {
      const amounts = new Set(config.stripeAmounts || []);
      const mine = charges.filter((c) => amounts.has(c.amount));
      section.sales = {
        count: mine.length,
        gross: mine.reduce((n, c) => n + c.amount, 0),
        currency: mine[0] ? mine[0].currency : "usd",
      };
    } else if (!STRIPE_KEY) section.salesError = "no STRIPE_API_KEY";

    sections.push(section);
  }

  if (charges) {
    const known = new Set(Object.values(SITES).flatMap((c) => c.stripeAmounts || []));
    const stray = charges.filter((c) => !known.has(c.amount));
    if (stray.length) {
      notes.push(`${stray.length} charge(s) did not match any product's price ` +
        `(${[...new Set(stray.map((c) => money(c.amount, c.currency)))].join(", ")}) — ` +
        "add the amount to `stripeAmounts` in sites.js if it is one of yours.");
    }
  }

  const markdown = render(sections, args, notes);
  if (args.out) { fs.writeFileSync(args.out, markdown); console.error(`wrote ${args.out}`); }
  else { console.log(markdown); }
})();
