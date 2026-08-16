# marketing — working notes

Growth tooling for two separate products. Plain Node, no dependencies, no
bundler, no paid services. Keep it that way: `git clone && node bin/…` is the
point.

## Read this before adding a "growth" feature

**These two products do not share an audience, and the second one does not
share an audience with itself.** The `segments` array in `sites.js` is the unit
every tool works in. Anything that collapses segments into a single "our users"
will produce advice that is wrong for at least one of them.

The `bereaved` segment of Order of Service Maker is marked `solicit: false`.
That is deliberate and enforced in `bin/find-mentions.js`, not just documented:

- Do **not** add community monitoring, retargeting, urgency copy, abandoned-cart
  email, or any other prospecting mechanic aimed at it.
- Do **not** "just check" whether grief subreddits contain leads. The
  `blockedSubreddits` list exists so a future config edit cannot quietly undo
  this.
- The channels for that segment are search and partnerships. If a task seems to
  need something else, the task is wrong.

## No auto-posting, ever

`bin/find-mentions.js` finds threads. A human writes every reply, in the
thread's own context, disclosing they built the product. Do not add a posting
step, a reply generator, or a "suggested comment" field — the shortlist is an
inbox, not a queue.

## Paid ads don't work here, so don't plan around them

Quillbill Pro is $29 once against incumbents carrying $276–516/year of LTV.
They will outbid a one-time product on every shared keyword. This is arithmetic,
not budget preference — see the README. Funeral keywords are worse, and carry
reputational risk on top.

## The audit encodes Quillbill's promises

`bin/audit-seo.js` is not only an SEO linter. Three of its checks exist because
the corresponding claim is load-bearing marketing:

1. `/app` must make **zero** third-party requests. It checks subresources and
   the JS the page loads, and deliberately does not count `<a href>` or
   `rel="canonical"` — those are destinations, not requests. Quillbill's
   `CLAUDE.md` is the authority on why; this repo just enforces it.
2. The analytics beacon must be on the marketing pages and **absent** from
   `/app`. Checked both ways, because Cloudflare's automatic setup reinstates it
   everywhere if switched on.
3. Canonical URLs must match Cloudflare Pages' extensionless serving. That bug
   has shipped once already.

If a check starts failing, fix the site — do not relax the check without
understanding which promise it was guarding.

## Conventions

- Node 22, CommonJS, zero dependencies. Global `fetch` is fine; a package is
  not.
- Free and unauthenticated APIs only. They are entitled to rate-limit us:
  back off, set a real User-Agent, and let a failed source degrade to a note
  in the output rather than killing the run.
- Prefer one request with a scoped query over N requests in a loop.
- `sites.js` is the only file that should need editing for routine changes.
