# marketing

Growth tooling for [Quillbill](https://quillbill.app) and
[Order of Service Maker](https://orderofservicemaker.help). Plain Node scripts,
no dependencies, no paid services. Everything here runs on free GitHub Actions
minutes or on your laptop.

```bash
node bin/audit-seo.js quillbill --dir ../Quillbill   # before you push
node bin/audit-seo.js --all --live                   # against production
node bin/build-sitemap.js quillbill --dir ../Quillbill
node bin/find-mentions.js --days 7                   # this week's shortlist
```

---

## The constraint that decides everything

Paid acquisition is not available to these products, and that would still be
true with a budget.

Quillbill Pro is **$29 once**. The incumbents it competes with — FreshBooks,
Bonsai, Harlow — collect **$276–516 a year, every year**. On the keywords that
matter (`invoice software`, `invoicing app`), those companies are bidding
against a lifetime value in the hundreds; clicks price accordingly. A $29
one-time product cannot outbid a subscription business for the same click. Even
at a generous 5% landing-to-purchase rate, a $1 click is a $20 acquisition cost
against $29 of revenue before Stripe's cut. That is not a growth engine, it is
a slow way to buy customers at cost.

The funeral keywords are worse: the funeral industry bids heavily, and ads
against grief searches are a reputational risk that no conversion rate
justifies.

So the channels are the ones that compound instead of the ones you rent:
**search, partnerships, and — for exactly one audience — community.** The job
of this repo is to make those cheap to run consistently.

---

## Two products, three audiences

They do not share a market, and the second product does not share one with
itself. This is modelled explicitly as `segments` in [`sites.js`](sites.js),
because a tool that flattens these into "our users" will be wrong for at least
one of them.

| Segment | State of mind | What actually works | Solicit? |
| --- | --- | --- | --- |
| **Quillbill — freelancers** | Shopping, annoyed about a renewal | Comparison content, community answers, directories | Yes |
| **Quillbill — local-first crowd** | Browsing, collects tools that don't phone home | Show HN, r/selfhosted, technical specifics | Yes |
| **OoSM — weddings** | Planning months ahead, DIY-inclined, researching in public | Templates, wording guides, planning communities | Yes |
| **OoSM — bereaved families** | Needs a printable file in days. Grieving. Not shopping. | Being findable at the moment of need; funeral directors and celebrants | **No** |

That last row is the one to get right. Someone arranging a funeral this week
will never buy twice, will not compare five options, and will not recommend the
product at a dinner party. Every standard growth tactic — retargeting, urgency
copy, abandoned-cart email, seeding a community — is somewhere between useless
and cruel. `bin/find-mentions.js` refuses to prospect that segment, and the
refusal is enforced in code rather than left to good intentions.

What serves that audience is craft and placement: plain language, a visible
price, a real preview, no account — and a link handed over by the funeral
director they already trust. One independent funeral director refers dozens of
families a year and never churns. Ten of those relationships is a better
business than any ad account.

**The tone cannot be shared either.** A cheerful "make it beautiful in five
minutes!" is wrong for a funeral; a hushed, careful tone is wrong for a
wedding. If the site currently uses one voice for both, splitting the entry
paths is likely worth more than anything in this repo.

---

## What is worth automating, and what isn't

Automate the parts that are mechanical and get skipped when you're busy:

- **Catching regressions.** Not writing content — noticing when a page loses
  its canonical tag, drops out of the sitemap, or picks up a tracking script it
  shouldn't have.
- **Finding the threads.** Searching eight communities every week is a chore
  you will stop doing by week three.
- **Keeping the sitemap true.** A missing entry costs you a page's traffic and
  produces no error anywhere.

Do not automate the parts where the value *is* the human:

- **Posting replies.** An auto-posted comment is how a small brand gets banned
  from the three communities that were going to be its first hundred
  customers. The reply that works answers the actual question asked.
- **Partnership outreach.** A funeral director says yes to a person, not a
  mail merge.
- **Writing the guides.** The existing Quillbill guides rank because they carry
  real numbers. Generated filler competes with them and loses.

---

## The tools

### `bin/audit-seo.js`

Checks the things that quietly cost search traffic, plus the per-product rules
in `sites.js` that are too important to leave as prose in a README.

Standard SEO checks: title and description presence and length, canonical
correctness, Open Graph and Twitter tags, exactly one `<h1>`, JSON-LD that
parses, duplicate titles across pages, internal links that resolve, and
sitemap/robots.txt agreement in both directions.

The Quillbill-specific rules matter more:

- **`/app` must make zero third-party requests.** The privacy claim on the
  landing page is load-bearing marketing, so it is verified rather than
  trusted. The check inspects subresources *and* the JS the page loads, and
  distinguishes a subresource from a link — `/app` linking to Stripe is fine,
  loading anything from Stripe is not.
- **The analytics beacon belongs on the marketing pages and nowhere else.**
  Checked in both directions, because Cloudflare's "automatic setup" silently
  reinstates it everywhere if anyone switches it on.
- **Canonical tags must match Cloudflare Pages' extensionless URLs.** This bug
  has already shipped once.

Pages disallowed in `robots.txt` are exempt from snippet checks — `/thanks`
carries an order id and is meant to stay unindexed.

```bash
node bin/audit-seo.js quillbill --dir ../Quillbill    # a checkout
node bin/audit-seo.js quillbill --live                # production
node bin/audit-seo.js --all --live --markdown out.md
```

Exits non-zero on failures, so it can gate a workflow. Warnings never fail.

### `bin/build-sitemap.js`

Regenerates `sitemap.xml` from the pages that exist, with `lastmod` taken from
the file's last commit rather than today's date. Respects `robots.txt`.

```bash
node bin/build-sitemap.js quillbill --dir ../Quillbill
node bin/build-sitemap.js quillbill --dir ../Quillbill --check   # CI mode
```

### `bin/find-mentions.js`

Searches Hacker News (Algolia's free API) and Reddit for people actively
looking for what these products do, scores them by buying intent, and prints a
ranked shortlist to answer **by hand**.

Skips segments marked `solicit: false`, and drops any subreddit on a product's
`blockedSubreddits` list even if a segment lists it by mistake.

```bash
node bin/find-mentions.js --days 7
node bin/find-mentions.js quillbill --days 14 --out digest.md
```

Reddit rate-limits unauthenticated search and often refuses datacenter IPs; a
failed source degrades to a note in the digest rather than killing the run.

### Workflows

| Workflow | When | What it does |
| --- | --- | --- |
| `outreach-digest.yml` | Mondays 08:00 UTC | Files the week's shortlist as an issue |
| `site-audit.yml` | Mondays 07:00 UTC | Audits both live sites, opens an issue only on failures |

Both use `gh` and `GITHUB_TOKEN`, already present on the runner. No secrets, no
third-party actions, no spend.

---

## The parts no script can do

Roughly in order of expected return:

1. **Programmatic-but-real pages for Quillbill.** `/vs/freshbooks`,
   `/vs/wave`, `/invoice-template/<trade>`, `/invoice/<country>` for VAT and
   Rechnung formats. Comparison intent converts because the visitor has already
   decided to switch. The existing guides prove the format works — each new one
   should carry real numbers, not a template fill.
2. **Ten partnership conversations for the funeral segment.** Independent
   funeral directors, humanist celebrants, hospice bereavement coordinators.
   Offer something worth having — a co-branded template, a printing guide — not
   an affiliate link.
3. **Split the Order of Service entry paths.** Separate landing pages, separate
   tone, separate search targeting for funeral and wedding. Currently these
   almost certainly compete with each other for the same page.
4. **Wording and hymn guides.** "What to include in an order of service",
   "funeral hymns list", "how many to print". High-intent, low-competition, and
   genuinely useful to someone having a bad week.
5. **Cross-link the two products' footers.** Free, permanent, and the audiences
   overlap more than you'd think — celebrants and stationers invoice too.
6. **A launch pass on the directories.** AlternativeTo, SaaSHub, Show HN,
   Indie Hackers. Once each, written by hand, no bulk submission.

---

## Adding the second site

`sites.js` has `repo` and `localPath` set to `null` for Order of Service Maker.
Fill those in and `--dir` mode and the live audit's per-product rules start
working for it too. Its segments, tone and channels are already configured.
