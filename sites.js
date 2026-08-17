/* The two products, the audiences each one serves, and the rules their sites
   have to keep.

   This is the only file you should need to edit when something changes.
   Everything in bin/ reads from here.

   The important idea in this file is `segments`. These two startups do not
   share an audience, and the second one does not even share an audience with
   itself: someone arranging a funeral this week and someone planning a wedding
   next summer are looking for the same artifact in completely different
   states of mind. Anything that treats them as one market — one tone, one set
   of keywords, one channel — will be wrong for at least one of them. So a
   segment, not a site, is the unit the tools work in. */

module.exports = {
  quillbill: {
    name: "Quillbill",
    origin: "https://quillbill.app",
    repo: "parisaetemadi/Quillbill",

    /* Where a checkout lives when running the tools with --dir, relative to
       this repo's root. */
    localPath: "../Quillbill",

    pitch: "A full invoice studio that runs entirely in your browser. " +
      "No account, no servers, no monthly fee.",
    price: "Free tier, Pro $29 once, Studio $79 once",

    /* Pages that must make zero third-party requests. This is the product's
       central marketing claim, so it is a checked rule, not a convention. */
    purity: {
      pages: ["/app"],
      /* Hosts these pages may legitimately reference, and why. Being listed
         here does not mean the page loads it — Stripe is navigated to on
         click, which costs the visitor nothing. */
      allowedHosts: {
        "quillbill-licenses.quillbill.workers.dev": "license activation, fired by an explicit click",
        "buy.stripe.com": "checkout, navigated to on click, never a subresource",
        "www.w3.org": "SVG XML namespace, not a network request",
        "schema.org": "JSON-LD vocabulary, not a network request",
      },
    },

    analytics: {
      /* Cloudflare Web Analytics, hand-placed. Automatic setup must stay off
         in the Cloudflare dashboard or the beacon lands on /app too. */
      requiredOn: ["/", "/guides/"],
      forbiddenOn: ["/app"],
    },

    /* The Web Analytics site TOKEN — the value in the data-cf-beacon attribute
       on the pages. Note this is not the site_tag the GraphQL API filters on;
       revenue-report.js resolves one to the other, because assuming they were
       the same silently returned zero traffic for a site doing hundreds of
       views a month. */
    analyticsSiteToken: "4d332798ff3e4668b369ee228a028824",

    /* Prices in cents, used to tell this product's Stripe charges from the
       other one's. Works only because the price points are distinct; if the
       two products ever share a price this needs replacing with payment-link
       or product-id matching. */
    stripeAmounts: [2900, 7900],

    /* Cloudflare Pages publishes the whole directory, so these are served at
       the live domain unless .assetsignore excludes them. A private repo does
       not make a public deploy private. */
    neverPublish: ["README.md", "CLAUDE.md", "scripts/", "worker/", ".github/"],

    /* Every price the guides quote, and where it came from.
       bin/check-prices.js reads this: the guides rank because they carry real
       numbers, which means a number going stale quietly damages them. Update
       `value` if it moved and set `verified` to today when you have looked. */
    priceClaims: [
      { label: "FreshBooks Lite", value: "$23", source: "https://www.freshbooks.com/pricing",
        page: "/guides/invoice-software-pricing-comparison", verified: "2026-08-15" },
      { label: "QuickBooks Simple Start", value: "$35", match: ["$35", "$38"],
        source: "https://quickbooks.intuit.com/pricing/",
        page: "/guides/invoice-software-pricing-comparison", verified: "2026-08-15" },
      { label: "HoneyBook Starter", value: "$29", match: ["$29", "$36"],
        source: "https://www.honeybook.com/pricing",
        page: "/guides/invoice-software-pricing-comparison", verified: "2026-08-15" },
      { label: "Bonsai Essentials", value: "$19", match: ["$19", "$25"],
        source: "https://www.hellobonsai.com/pricing",
        page: "/guides/invoice-software-pricing-comparison", verified: "2026-08-15" },
      { label: "Wave Pro", value: "$19", source: "https://www.waveapps.com/pricing",
        page: "/guides/invoice-software-pricing-comparison", verified: "2026-08-15" },
      { label: "Stripe standard processing", value: "2.9%", match: ["2.9%"],
        source: "https://stripe.com/pricing",
        page: "/guides/stripe-invoicing-fees-explained", verified: "2026-08-15" },
      { label: "Stripe Invoicing Plus", value: "0.5%", match: ["0.5%"],
        source: "https://stripe.com/invoicing/pricing",
        page: "/guides/stripe-invoicing-fees-explained", verified: "2026-08-15" },
    ],

    segments: [
      {
        id: "freelancers",
        label: "Freelancers and solo operators",
        /* Rational, repeat-exposure-tolerant, and extremely vocal about
           software pricing in public. The pitch is arithmetic: $29 once
           against $23–43 every month. */
        state: "shopping — comparing tools, usually annoyed about a renewal",
        /* The thread has to actually be about this before intent words mean
           anything. Without it, "best" and "which" float general news to the
           top of the list. */
        mustMatch: /invoic|billing|freshbooks|quickbooks|freelance.{0,20}(admin|paperwork|account)|bookkeep|get paid/i,
        tone: "direct, numeric, faintly anti-subscription; peer to peer",
        solicit: true,
        channels: ["search", "community", "directories", "comparison-pages"],
        hn: [
          "invoice generator", "invoicing software", "freelance invoicing",
          "invoice subscription", "local-first app",
        ],
        reddit: {
          subreddits: [
            "freelance", "smallbusiness", "Entrepreneur", "selfhosted",
            "webdev", "graphic_design", "juststart", "SideProject",
          ],
          queries: [
            "invoice tool", "invoicing software", "free invoice", "invoice generator",
            "invoice app recommendation", "quickbooks alternative", "freshbooks alternative",
            "wave invoicing", "invoice without subscription",
          ],
        },
      },
      {
        id: "privacy-minded",
        label: "Local-first and privacy-minded users",
        /* A smaller segment but a loud one, and the only segment that cares
           about the actual architecture. This is the crowd that makes
           Show HN and r/selfhosted work. */
        state: "browsing — collects tools that do not phone home",
        mustMatch: /local.?first|offline.?first|no telemetry|works offline|self.?host|privacy.?first|in the browser/i,
        tone: "technical, specific, no marketing adjectives; show the receipts",
        solicit: true,
        channels: ["community", "directories", "show-hn"],
        hn: ["local-first", "no telemetry", "offline first", "browser only app"],
        reddit: {
          subreddits: ["selfhosted", "privacy", "degoogle", "opensource"],
          queries: ["local first", "offline invoice", "no telemetry", "works offline"],
        },
      },
    ],

    /* Words that mark a thread as someone actively shopping rather than
       mentioning the topic in passing. */
    intentWords: [
      "recommend", "recommendation", "suggestions", "looking for", "any good",
      "alternative", "best", "which", "what do you use", "anyone use",
      "tired of", "sick of", "too expensive", "cheaper", "worth it", "vs",
    ],
  },

  orderofservicemaker: {
    /* "Order of Service Maker" in public, "Quire" in the repo. */
    name: "Order of Service Maker",
    origin: "https://orderofservicemaker.help",
    repo: "parisaetemadi/Booklet",
    localPath: "../booklet",

    /* This site canonicalises WITH the .html extension, where Quillbill drops
       it. Cloudflare Pages serves both forms, so neither is wrong — but the
       tools have to be told which one each site chose, or every page on one of
       them reads as a canonical mismatch. */
    urlStyle: "explicit",

    pitch: "A print-ready order of service booklet in about twenty minutes, " +
      "made privately on your own computer.",
    price: "$30 once",
    /* The number the pitch turns on: a funeral printer is about $4.90 a booklet
       at a minimum order of fifty, so roughly $245 for one funeral. */
    competitorPrice: "~$245 per funeral from a printer",

    purity: {
      /* Same promise as Quillbill — "nothing leaves your computer" is in the
         meta description, so it is a checked rule here too. */
      pages: ["/app.html"],
      allowedHosts: {
        "oosm-licenses.quillbill.workers.dev": "license activation, fired by an explicit click",
        "buy.stripe.com": "checkout, navigated to on click, never a subresource",
        "www.w3.org": "SVG XML namespace, not a network request",
        "schema.org": "JSON-LD vocabulary, not a network request",
      },
    },

    analytics: {
      /* Same arrangement as Quillbill: the beacon is on the marketing pages
         and the post-purchase page, and never on the studio. Cloudflare's
         "automatic setup" must stay OFF in the dashboard — it injects the
         beacon into every proxied page, app.html included. */
      requiredOn: [
        "/", "/thanks.html", "/guides/",
        "/guides/funeral-order-of-service-cost.html",
        "/guides/wedding-order-of-service-cost.html",
        "/guides/order-of-service-cost-comparison.html",
        "/guides/order-of-service-wording-examples.html",
        "/guides/order-of-service-privacy.html",
        "/guides/funeral-hymns-and-readings.html",
        "/guides/how-many-orders-of-service-to-print.html",
        "/guides/printing-an-order-of-service-at-home.html",
      ],
      forbiddenOn: ["/app.html"],
    },

    analyticsSiteToken: "de55ac01e2db4343b8476843469716ff",
    stripeAmounts: [3000],

    /* Already excluded via .assetsignore — the check keeps it that way. */
    neverPublish: ["README.md", "CLAUDE.md", "scripts/", "worker/", ".github/"],

    /* The two numbers the whole pitch turns on. If a printer's per-booklet rate
       drifts, three guides and the homepage comparison go quietly wrong. */
    priceClaims: [
      { label: "Funeral printer, per booklet", value: "$4.90", source: null,
        page: "/guides/funeral-order-of-service-cost.html", verified: "2026-08-15" },
      { label: "Funeral printer, 50 booklets", value: "$245", source: null,
        page: "/", verified: "2026-08-15" },
    ],



    sitemapRules: [
      { match: /^\/$/, priority: "1.0", changefreq: "weekly" },
      { match: /^\/guides\/$/, priority: "0.7", changefreq: "monthly" },
      { match: /^\/guides\//, priority: "0.7", changefreq: "monthly" },
      { match: /.*/, priority: "0.5", changefreq: "monthly" },
    ],

    segments: [
      {
        id: "bereaved",
        label: "Families arranging a funeral or memorial",
        /* The hardest segment either product has, and the one most likely to
           be handled badly by automation.

           They arrive with a deadline of days, no interest in comparing
           options, and no capacity for a sales process. They will never buy
           twice and will not recommend the product at a dinner party. Every
           ordinary growth tactic — retargeting, urgency copy, "still thinking
           about it?" email, community seeding — is somewhere between useless
           and cruel here.

           What works is being findable at the exact moment of need and
           obviously trustworthy in the first five seconds: plain language, a
           real preview, an unmistakable price, no account. That is a search
           and craft problem, not an outreach problem. */
        state: "urgent — needs a printable file in 2–5 days, grieving, decision-fatigued",
        tone: "plain, calm, unhurried. No exclamation marks, no urgency copy, " +
          "no cheerfulness, no scarcity, no upsell. Say what it does and what it costs.",
        solicit: false,
        soliciteReason: "Prospecting in grief communities is intrusive, and it deserves not to work.",
        channels: ["search", "partnership"],
        /* Partnership is the durable channel here: the people who already have
           the family's trust hand over a link. One funeral director sends
           dozens of families a year and never churns. */
        partners: [
          "independent funeral directors", "humanist and civil celebrants",
          "hospice and bereavement coordinators", "local print shops",
          "churches and parish administrators",
        ],
        /* Search intent to earn with content, not to bid on. The site already
           covers cost and wording; the gaps are the practical questions that
           come up while actually making the thing. */
        searchIntent: [
          "funeral order of service template", "what to include in an order of service",
          "funeral hymns list", "memorial service programme", "order of service wording",
          "readings for a funeral", "how many orders of service to print",
          "order of service page count", "how to print an order of service at home",
        ],
      },
      {
        id: "weddings",
        label: "Couples and wedding planners",
        /* A different planet from the segment above, despite the identical
           output file. Months of lead time, active public research, strong DIY
           culture, and a genuine appetite for recommendations — answering a
           stationery question in a planning community is ordinary
           helpfulness here, not intrusion. */
        state: "planning — months of lead time, researching, comparing, DIY-inclined",
        /* This segment plans on Instagram, TikTok and Pinterest, and the
           product makes a physical, photographable object — the booklet is the
           content. Pinterest is likely the best of the three despite being the
           least fashionable: a pin keeps sending traffic for years where an
           Instagram post is finished in two days, and "wedding order of service
           template" is a Pinterest search, not a scroll.

           Social is right for THIS segment and wrong for the bereaved one —
           nobody arranging a funeral on Tuesday is scrolling for stationery.
           The exception is that funeral directors and celebrants are on
           Instagram themselves, so social can serve the partnership channel
           there without ever addressing a grieving family. */
        social: ["pinterest", "instagram", "tiktok"],
        mustMatch: /order of service|ceremony program|wedding program|ceremony booklet|order.?of.?service/i,
        tone: "warm and practical; templates, budgets and printing tips",
        solicit: true,
        channels: ["search", "community", "partnership", "directories"],
        hn: [],
        reddit: {
          subreddits: ["weddingplanning", "weddingsunder10k", "engaged", "DIYweddings"],
          queries: [
            "order of service", "ceremony programs", "wedding programs diy",
            "printable ceremony program", "ceremony booklet",
          ],
        },
        partners: ["wedding stationers", "celebrants", "venue coordinators"],
        searchIntent: [
          "wedding order of service template", "wedding ceremony programme wording",
          "order of service wording wedding", "how many wedding programs to print",
        ],
      },
    ],

    intentWords: [
      "recommend", "looking for", "any good", "template", "diy", "printable",
      "how do i make", "cheapest", "where did you get",
    ],

    /* Communities the mention finder must never query for this product,
       whatever else any segment configures. Enforced in bin/find-mentions.js,
       not merely documented here. */
    blockedSubreddits: [
      "funerals", "GriefSupport", "grief", "widowers", "widows", "Petloss",
      "SuicideBereavement", "cancer", "hospice", "MomForAMinute", "TrueOffMyChest",
    ],
  },
};
