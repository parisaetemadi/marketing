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

    segments: [
      {
        id: "freelancers",
        label: "Freelancers and solo operators",
        /* Rational, repeat-exposure-tolerant, and extremely vocal about
           software pricing in public. The pitch is arithmetic: $29 once
           against $23–43 every month. */
        state: "shopping — comparing tools, usually annoyed about a renewal",
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
    name: "Order of Service Maker",
    origin: "https://orderofservicemaker.help",

    /* TODO(parisa): fill these in — this repo was set up without access to
       that project. repo/localPath are needed for --dir runs and for the
       site audit; the rest only sharpens how the tools score things. */
    repo: null,
    localPath: null,

    pitch: "Build a printable order of service for a funeral, memorial or wedding.",
    price: null,

    purity: null,
    analytics: null,

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
        /* Search intent to earn with content, not to bid on. */
        searchIntent: [
          "funeral order of service template", "what to include in an order of service",
          "funeral hymns list", "memorial service programme", "order of service wording",
          "readings for a funeral", "how many orders of service to print",
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
