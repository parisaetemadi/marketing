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
node bin/make-pins.js --live                         # a month of Pinterest pins
node bin/post-pins.js                                # what would go out next
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

- **Publishing to a search index.** A pin is not a message to anyone. It sits
  in an index and is found by somebody typing a question. Writing the pins is
  human work; uploading one every other day for a month is not, and it is
  exactly the kind of thing that stops happening in a busy week.

Do not automate the parts where the value *is* the human:

- **Posting replies.** An auto-posted comment is how a small brand gets banned
  from the three communities that were going to be its first hundred
  customers. The reply that works answers the actual question asked.
- **Partnership outreach.** A funeral director says yes to a person, not a
  mail merge.
- **Writing the guides.** The existing Quillbill guides rank because they carry
  real numbers. Generated filler competes with them and loses.

The line between the two is who initiated it. A reply, a DM and a cold email
all arrive at someone who did not ask; a pin and a guide wait to be found. That
is why `bin/find-mentions.js` will never post and `bin/post-pins.js` will.

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

**Reddit currently returns nothing.** `search.json` is no longer served to
unauthenticated clients — verified from both a GitHub runner and a laptop on a
home connection, so it is not an IP-reputation problem. Reading it needs an app
token, and creating an app is gated behind Reddit's own API registration. The
client-credentials path is implemented and waiting on `REDDIT_CLIENT_ID` /
`REDDIT_CLIENT_SECRET`; without them the source degrades to one line in the
digest rather than killing the run.

In practice this makes the digest HN-only, which covers the local-first segment
well and the freelancer segment thinly.

### `bin/make-pins.js`

Turns the guides into Pinterest pins: 1000×1500 images, plus the title,
description, alt text and link to post with each one.

Pinterest is the one social platform in this repo, because it is barely a
social platform — it is a search engine with pictures. A pin is found by
someone typing *"how many orders of service to print"*, it keeps being found
for years, and nothing is pushed at anybody. That makes it usable for the
wedding segment, for the freelancer segment, and — carefully — for the
bereaved segment, whose `solicit: false` rule is about not approaching people,
not about being unfindable.

The images are rendered by the copy of Chrome already on the machine, in each
site's own colours and type, taken straight from the sites' CSS custom
properties. No design tool, no subscription, no fonts to download. Three
layouts — a statement, a small table of numbers, a checklist — so one guide
becomes several distinct pins instead of the same picture posted twice.

Rules it enforces rather than documents, verifiable with `--self-test`:

- a pin whose destination page does not exist fails the run;
- a pin quoting a figure the destination page does not quote fails the run;
- for `solicit: false` segments, exclamation marks, urgency vocabulary and a
  price in the headline all fail the run;
- emoji fail everywhere, in both brands.

The queue is ordered so that boards take turns and two images of the same
guide land about a month apart, which is the difference between a URL that
looks worth ranking and one that looks like spam.

```bash
node bin/make-pins.js --self-test                       # prove the rules fire
node bin/make-pins.js --dir quillbill=../Quillbill \
                      --dir orderofservicemaker=../booklet
node bin/make-pins.js --live                            # read pages from production
node bin/make-pins.js --check                           # validate, render nothing
```

Writes `out/pins/` — the images, `queue.md` to post from by hand, and
`pins.json` for the poster.

### `bin/post-pins.js`

Posts what `make-pins.js` built, through Pinterest's own API. Separate program
on purpose: making pins is safe and repeatable, publishing them is neither.

It does nothing without `--post`. With it, it posts only pins that are due,
minus anything in the ledger, capped at `--max` per run — so a run that fires
twice posts nothing the second time, and a missed run catches up at the cap
rather than dumping a fortnight of pins in one afternoon.

```bash
node bin/post-pins.js --verify               # credentials and boards, posting nothing
node bin/post-pins.js                        # dry run: what is due
node bin/post-pins.js --sandbox --post       # rehearse against Pinterest's sandbox
node bin/post-pins.js --post --max 1
```

`--verify` is the one to run after setting the secrets up. It exchanges the
token, names the account it belongs to, and checks every board the queue needs
actually exists — the plain dry run proves none of that, because it stops
before authorising.

Setup is [below](#pinterest-the-one-thing-that-needs-you).

### Workflows

| Workflow | When | What it does |
| --- | --- | --- |
| `outreach-digest.yml` | Mondays 08:00 UTC | Files the week's shortlist as an issue |
| `site-audit.yml` | Mondays 07:00 UTC | Audits both live sites, opens an issue only on failures |
| `price-check.yml` | 1st of the month | Re-checks every price the guides quote |
| `pins.yml` | 1st of the month | Renders a month of pins, uploads them as an artifact |
| `pins-post.yml` | Mon/Wed/Fri 10:00 UTC | Posts the next pin; a manual run verifies the setup instead |
| `audit-site.yml` | Called by a product repo | Gates that repo's PRs on the audit |

All of them run on `GITHUB_TOKEN`, already present on the runner. No third-party
actions, no spend. `pins-post.yml` is the only one that needs a secret, and
without it the run skips rather than fails.

---

## Wiring it into a product repo

A weekly audit of production tells you what already shipped. To stop it
shipping, the audit has to run on the pull request — which is the gap that let
a placeholder analytics token reach production and a red test suite sit unnoticed
for a day.

`audit-site.yml` is a reusable workflow. In the product repo, add
`.github/workflows/checks.yml`:

```yaml
name: Checks
on: [push, pull_request]

jobs:
  audit:
    uses: parisaetemadi/marketing/.github/workflows/audit-site.yml@main
    with:
      site: quillbill        # or: orderofservicemaker
```

That is the whole integration. **This repo is public and the product repos are
private, which is the useful direction** — a private repo can check this one out
with the token it already has, so no PAT and no secrets are involved.

What it catches on every PR, before merge:

- an analytics token that isn't 32 hex characters (placeholders, typos, half a paste)
- the beacon appearing on a page that must stay beacon-free
- a third-party subresource creeping into a page that promises none
- a canonical that doesn't match how Cloudflare Pages serves the file
- a new page missing from `sitemap.xml`, or a sitemap entry pointing at nothing
- an `og:image` that no social platform will render
- internal links that resolve to nothing
- working notes, tests or Worker source being publishable at the live domain

That last one is worth spelling out. **Cloudflare Pages publishes the whole
directory.** `README.md`, `CLAUDE.md`, `scripts/` and `worker/` are served at
the live domain unless `.assetsignore` excludes them — a private repo does not
make a public deploy private. The check verifies the file when auditing a
checkout, and fetches the URLs when auditing production, because the two
disagree until the next deploy.

---

## Pinterest: the one thing that needs you

Everything else in this repo runs on its own. This does too — once, at the
start, somebody has to hand it an account. About half an hour, and then it does
not need you again.

**Why bother at all.** Pinterest is where people search for *"funeral order of
service template"* and *"wedding programme wording"* and then keep the result.
A pin posted today is still being found in two years; a post on most platforms
is finished in two days. It is also free, it has a real API, and — unlike
Instagram or TikTok — nothing about it rewards being personally present every
day. That combination is rare, and it is the only reason a social platform
appears in this repo at all.

### What to do, in order

1. **Make a Pinterest account, then switch it to a business account.** Free,
   takes a minute, and it's the same account either way — Settings → Account
   management → Convert to business. The API only works on a business account.

2. **Create three boards.** The names have to match `sites.js` exactly:

   - `Funeral order of service`
   - `Wedding order of service`
   - `Freelance business admin`

   Or skip this and let the tool make them for you the first time, with
   `--create-boards`.

3. **Make an app.** Go to [developers.pinterest.com](https://developers.pinterest.com),
   sign in with that account, and create an app. When it asks which permissions
   it needs, tick `boards:read`, `boards:write`, `pins:read` and `pins:write`.

4. **Get a token.** The app page will let you generate one. You want the
   **refresh token**, not just the access token — access tokens stop working
   after about a month, which for something running by itself is a failure you
   would not notice until you wondered why nothing had been posted since
   September.

5. **Put the secrets in GitHub.** In this repo: Settings → Secrets and variables
   → Actions → New **repository** secret. Add three:

   | Name | What it is |
   | --- | --- |
   | `PINTEREST_APP_ID` | from the app page |
   | `PINTEREST_APP_SECRET` | from the app page |
   | `PINTEREST_REFRESH_TOKEN` | the refresh token from step 4 |

   **Secrets, not Variables.** They are two different tabs on that page. The
   workflow reads `secrets.PINTEREST_*`, so anything added as a variable is
   invisible to it — and a variable is not masked in logs, which is not where
   a token belongs.

   **Do not paste any of these into a chat, a file, or a commit.** They go in
   that form and nowhere else. This repo is public.

6. **Check it.** Actions → **Post a pin** → Run workflow, leaving the mode on
   `verify`. It proves the credentials work, names the account, and lists which
   boards it found — and posts nothing. A manual run defaults to verifying for
   exactly that reason; the schedule posts.

That is the whole setup. From then on, a pin goes out on Monday, Wednesday and
Friday morning, in the order `sites.js` lists them, and the workflow records
what it sent so nothing goes twice.

### If you would rather check it first

With the token exported in your own shell:

```bash
export PINTEREST_ACCESS_TOKEN=...          # in the terminal, not in a file
node bin/post-pins.js --sandbox --post      # posts to Pinterest's sandbox
```

The sandbox accepts real API calls and throws the pins away, so you can watch
the whole thing work without anything appearing in public.

### If you would rather not connect an account at all

Run the **Build pins** workflow from the Actions tab and download the artifact.
It contains every image and a `queue.md` listing which board each one goes on,
what to title it, what to write underneath and where it links. Posting one by
hand takes about a minute.

### When the queue runs out

It is about a month long. Adding more means adding entries to the `pinterest`
block of a segment in `sites.js` — a headline, a supporting sentence, and
either a short table of numbers or a list of steps, all of it taken from a page
that already exists. The checks will refuse anything that quotes a figure the
page does not.

---

## The parts no script can do

Roughly in order of expected return:

1. **Connect the Pinterest account.** [Half an hour, once](#pinterest-the-one-thing-that-needs-you),
   and then a month of pins posts itself. It is the only item on this list that
   stops being work after you do it.
2. **Ten partnership conversations for the funeral segment.** Independent
   funeral directors, humanist celebrants, hospice bereavement coordinators.
   Offer something worth having — a printing guide, a co-branded template — not
   an affiliate link. One director refers dozens of families a year and never
   churns; ten of those relationships is a better business than any ad account.
3. **Request indexing for the new guides.** Order of Service Maker is a
   week-old domain with no inbound links, so Google has crawled the homepage
   and little else. Search Console → URL inspection → Request indexing, for
   `/guides/` and each guide. It is a nudge, not a fix; the fix is the
   backlinks that partnerships and pins produce.
4. **Split Quire's entry paths by ceremony.** Funeral and wedding currently
   share one landing page and one voice. They need separate pages, separate
   tone, and separate search targeting; right now they compete with each other
   for every query.
5. **Programmatic-but-real pages for Quillbill.** `/vs/freshbooks`, `/vs/wave`,
   `/invoice-template/<trade>`, `/invoice/<country>` for VAT and Rechnung
   formats. Comparison intent converts because the visitor has already decided
   to switch. Each page needs real numbers, not a template fill.
6. **Cross-link the two products' footers.** Free, permanent, and the audiences
   overlap more than you'd think — celebrants and stationers invoice too.
7. **A launch pass on the directories.** AlternativeTo, SaaSHub, Show HN,
   Indie Hackers. Once each, written by hand, no bulk submission.

---

## A note on URL styles

The two sites canonicalise differently: Quillbill drops the `.html` extension,
Quire keeps it. Cloudflare Pages serves both forms, so neither is wrong — but
the tools have to be told which, via `urlStyle` in `sites.js`, or every page on
one site reads as a canonical mismatch. If a third site shows up, set this
first.
