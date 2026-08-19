#!/usr/bin/env node
/* Posts the pins that bin/make-pins.js already built and checked.
 *
 * Split from the generator on purpose. Making pins is safe, repeatable and
 * needs no account; publishing them is none of those things. Keeping the two
 * apart means you can regenerate the whole queue at any time without any risk
 * of something going out, and it means this file — the one that can actually
 * publish — stays small enough to read in one sitting.
 *
 * It does nothing by default. Without --post it prints what it would do and
 * exits, which is the mode to use while setting up.
 *
 * How it decides what to post:
 *
 *   - only pins whose scheduled date has arrived,
 *   - minus anything already in the ledger,
 *   - capped at --max per run.
 *
 * That combination is what makes it safe to run unattended: a run that fires
 * twice posts nothing the second time, a run that is missed catches up at the
 * cap rather than dumping a fortnight of pins in one afternoon, and losing the
 * ledger cannot post more than --max duplicates.
 *
 * What you need before this works — see README.md for the walkthrough:
 *
 *   1. A Pinterest business account (free, and convertible from a personal one).
 *   2. An app at developers.pinterest.com with the scopes boards:read,
 *      boards:write, pins:read and pins:write.
 *   3. Credentials, one of two ways:
 *
 *      PINTEREST_ACCESS_TOKEN                       — simplest, and it expires
 *                                                     after about 30 days.
 *      PINTEREST_APP_ID + PINTEREST_APP_SECRET
 *        + PINTEREST_REFRESH_TOKEN                  — for anything unattended.
 *
 * The second form is the one a scheduled job wants. Pinterest's access tokens
 * are short-lived by design, so a workflow holding one quietly stops working a
 * month after it is set up — which is the worst possible failure for something
 * nobody is watching. A refresh token lasts about a year and is exchanged for
 * a fresh access token at the start of each run.
 *
 * A new app starts on trial access, which can post to your own account and is
 * all this needs. --sandbox talks to Pinterest's sandbox instead, where pins
 * are created and thrown away, so the whole path can be proven before anything
 * appears in public.
 *
 * Usage:
 *   node bin/post-pins.js                      # dry run: what is due
 *   node bin/post-pins.js --verify             # check the credentials, post nothing
 *   node bin/post-pins.js --verify-write       # …and prove it can create a pin
 *   node bin/post-pins.js --sandbox --post     # prove it end to end
 *   node bin/post-pins.js --post               # publish what is due
 *   node bin/post-pins.js --post --max 1 --ignore-dates
 */

const fs = require("fs");
const path = require("path");
const { send, sleep } = require("../lib/fetch");

const LIVE = "https://api.pinterest.com/v5";
const SANDBOX = "https://api-sandbox.pinterest.com/v5";

function parseArgs(argv) {
  const args = {
    manifest: "out/pins/pins.json", ledger: null, post: false,
    max: 3, sandbox: false, createBoards: false, today: null, ignoreDates: false,
    verify: false, verifyWrite: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--post") args.post = true;
    else if (a === "--sandbox") args.sandbox = true;
    else if (a === "--create-boards") args.createBoards = true;
    else if (a === "--ignore-dates") args.ignoreDates = true;
    else if (a === "--verify") args.verify = true;
    else if (a === "--verify-write") { args.verify = true; args.verifyWrite = true; }
    else if (a === "--manifest") args.manifest = argv[++i];
    else if (a === "--ledger") args.ledger = argv[++i];
    else if (a === "--max") args.max = Math.max(1, Number(argv[++i]) || 3);
    else if (a === "--today") args.today = argv[++i];      /* for testing */
  }
  if (!args.ledger) args.ledger = path.join(path.dirname(args.manifest), "posted.json");
  return args;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (err) {
    if (err.code === "ENOENT" && fallback !== undefined) return fallback;
    throw err;
  }
}

/* A credential from the environment, with the whitespace taken off.

   Tokens get copied out of a web page and pasted into a secrets box, and a
   trailing newline survives that journey more often than anyone expects. The
   API's answer to a token with a newline on the end is indistinguishable from
   its answer to a wrong token, so trim first and rule it out. */
function cred(name) {
  return (process.env[name] || "").trim();
}

let accessToken = null;

/* Trade the long-lived refresh token for a short-lived access token.

   Deliberately not cached anywhere: the access token lives in memory for the
   length of one run and is never written to disk, which means the only thing
   that has to be kept secret over time is the refresh token, and that only
   ever exists as a secret in the environment. */
async function refreshAccessToken(args) {
  const id = cred("PINTEREST_APP_ID");
  const secret = cred("PINTEREST_APP_SECRET");
  const refresh = cred("PINTEREST_REFRESH_TOKEN");
  const base = args.sandbox ? SANDBOX : LIVE;

  /* Pinterest hands you two tokens on the same screen and they look alike.
     Sending the access token where the refresh token belongs is rejected as
     "The authorization grant is invalid", which describes the protocol rather
     than the mistake. The prefixes tell them apart, so say so plainly. */
  if (/^pina_/.test(refresh)) {
    throw new Error(
      "PINTEREST_REFRESH_TOKEN holds an access token, not a refresh token.\n" +
      "  Pinterest shows both on the same screen. The refresh token is the longer\n" +
      "  one beginning pinr_; the one beginning pina_ is the access token.\n" +
      "  Either put the pinr_ value in PINTEREST_REFRESH_TOKEN, or — to get going\n" +
      "  today — put the pina_ value in PINTEREST_ACCESS_TOKEN instead and sort the\n" +
      "  refresh token out before it expires in about thirty days."
    );
  }

  const res = await send(base + "/oauth/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }).toString(),
  });
  if (!res.ok || !res.json || !res.json.access_token) {
    const detail = res.json && res.json.message ? res.json.message : res.body.slice(0, 300);
    throw new Error(`could not refresh the Pinterest token (${res.status}): ${detail}\n\n` +
      "  Pinterest says the same thing for every cause, so here they are, likeliest first:\n" +
      "    1. The value is an access token rather than a refresh token. The refresh one\n" +
      "       begins pinr_, the access one pina_.\n" +
      "    2. The app id or secret belongs to a different app than the token does.\n" +
      "    3. The token was issued in the sandbox and used against the live API, or the\n" +
      "       reverse. --sandbox picks which one this run talks to.\n" +
      "    4. The token was truncated or picked up a stray character when pasted.\n" +
      "    5. It genuinely expired. Refresh tokens last about a year; generate a new one\n" +
      "       at developers.pinterest.com and replace the secret.\n\n" +
      "  To get posting today without solving this: put the access token in\n" +
      "  PINTEREST_ACCESS_TOKEN. It works for about thirty days and takes priority.");
  }
  return res.json.access_token;
}

/* Whichever credential is present, resolved once per run. */
async function authorise(args) {
  if (cred("PINTEREST_ACCESS_TOKEN")) {
    accessToken = cred("PINTEREST_ACCESS_TOKEN");
    return "access token";
  }
  if (cred("PINTEREST_APP_ID") && cred("PINTEREST_APP_SECRET") &&
      cred("PINTEREST_REFRESH_TOKEN")) {
    accessToken = await refreshAccessToken(args);
    return "refresh token";
  }
  throw new Error(
    "no Pinterest credentials.\n" +
    "  Set PINTEREST_ACCESS_TOKEN, or — better for anything scheduled —\n" +
    "  PINTEREST_APP_ID, PINTEREST_APP_SECRET and PINTEREST_REFRESH_TOKEN.\n" +
    "  See README.md. Never paste any of them into a file or a chat window."
  );
}

async function api(args, method, endpoint, body) {
  const base = args.sandbox ? SANDBOX : LIVE;
  const res = await send(base + endpoint, {
    method,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = res.json && res.json.message ? res.json.message : res.body.slice(0, 300);
    const err = new Error(`Pinterest ${method} ${endpoint} → ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return res.json;
}

/* Every board on the account, by lowercased name. One listing per run, so a
   name mismatch is one clear error before anything is posted rather than a
   failure three pins in. */
async function listBoards(args) {
  const all = new Map();
  let bookmark = null;
  do {
    const q = bookmark ? `?page_size=100&bookmark=${encodeURIComponent(bookmark)}` : "?page_size=100";
    const page = await api(args, "GET", "/boards" + q);
    for (const board of page.items || []) {
      if (board.name) all.set(board.name.toLowerCase(), board.id);
    }
    bookmark = page.bookmark || null;
  } while (bookmark);
  return all;
}

/* Board names in the config are human names; the API wants ids. */
async function resolveBoards(args, names) {
  const wanted = new Set(names);
  const all = await listBoards(args);
  const found = new Map();
  for (const name of wanted) {
    const id = all.get(name.toLowerCase());
    if (id) found.set(name, id);
  }

  const missing = [...wanted].filter((n) => !found.has(n));
  if (missing.length && !args.createBoards) {
    throw new Error(
      `no board named ${missing.map((m) => `"${m}"`).join(", ")} on this account.\n` +
      "  Either create it in Pinterest with exactly that name, rename the board in\n" +
      "  sites.js to match one you have, or re-run with --create-boards."
    );
  }
  for (const name of missing) {
    const board = await api(args, "POST", "/boards", {
      name, description: "", privacy: "PUBLIC",
    });
    console.error(`  created board "${name}" (${board.id})`);
    found.set(name, board.id);
  }
  return found;
}

async function postPin(args, row, boardId) {
  const image = fs.readFileSync(row.file);
  return api(args, "POST", "/pins", {
    board_id: boardId,
    title: row.title,
    description: row.description,
    alt_text: row.alt,
    link: row.link,
    media_source: {
      source_type: "image_base64",
      content_type: "image/png",
      data: image.toString("base64"),
    },
  });
}

/* Prove the token can actually create a pin, without publishing one.

   Read access and write access look identical until the moment you need the
   second one. Listing boards succeeds with a read-only token, so a green
   verify says nothing about whether the first scheduled post will work — and
   finding out at 10:00 on a Monday, from a failed workflow, is the whole thing
   this tool exists to avoid.

   So: make a SECRET board, put a real pin on it, then delete both. Secret
   boards are not visible to anyone but the account holder, so nothing is
   published even for the second the pin exists. It exercises the exact calls
   the poster makes — same endpoint, same base64 image upload, same fields —
   rather than a proxy for them.

   Cleanup runs even when the middle fails, and whatever it could not remove is
   named in the output. A leftover on a secret board is invisible, but it
   should not be a mystery. */
async function verifyWrite(args, manifest) {
  const sample = manifest[0];
  if (!sample) throw new Error("no pins in the manifest to test with.");
  if (!fs.existsSync(sample.file)) {
    throw new Error(`no image at ${sample.file} — run bin/make-pins.js first.`);
  }

  let boardId = null;
  let pinId = null;
  try {
    const board = await api(args, "POST", "/boards", {
      name: `Setup check ${new Date().toISOString().slice(0, 16)}`,
      description: "Created by bin/post-pins.js --verify-write. Deleted straight away.",
      privacy: "SECRET",
    });
    boardId = board.id;
    console.error(`✓ created a secret board (${boardId})`);

    const pin = await postPin(args, sample, boardId);
    pinId = pin.id;
    console.error(`✓ created a pin on it (${pinId})`);
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      throw new Error(
        `${err.message}\n\n` +
        "  That is a permissions answer, not a broken token.\n\n" +
        "  Note which scope it names. The secret-board test needs\n" +
        "  boards:write_secret and pins:write_secret, which Pinterest treats as\n" +
        "  separate from the plain boards:write and pins:write — a token with only\n" +
        "  the plain pair can post for real but cannot run this test.\n" +
        "    1. Add those scopes to the app at developers.pinterest.com.\n" +
        "    2. Run bin/pinterest-auth.js again — an approval only grants what\n" +
        "       the app asked for at the time, so an existing token does not\n" +
        "       gain a scope added afterwards.\n" +
        "    3. Replace the secret and run this again."
      );
    }
    throw err;
  } finally {
    /* Best effort, loudest possible failure. */
    if (pinId) {
      try {
        await api(args, "DELETE", `/pins/${pinId}`);
        console.error("✓ deleted the pin");
      } catch (err) {
        console.error(`⚠ could not delete the test pin ${pinId}: ${err.message}`);
        console.error("  It is on a secret board, so nobody can see it — but delete it by hand.");
      }
    }
    if (boardId) {
      try {
        await api(args, "DELETE", `/boards/${boardId}`);
        console.error("✓ deleted the secret board");
      } catch (err) {
        console.error(`⚠ could not delete the test board ${boardId}: ${err.message}`);
        console.error("  Delete it by hand; it is secret, so it is not visible to anyone else.");
      }
    }
  }
}

/* Prove the whole chain works without publishing anything.

   Credentials, a token exchange, the account they belong to, and every board
   the queue needs — checked in that order, because that is the order they
   fail in. A dry run proves none of this: it stops before authorising, which
   is exactly the part that is wrong when someone has just finished setting up.

   Nothing here creates or posts. It is safe to run at any time, and worth
   running whenever a credential is rotated. */
async function verify(args, manifest) {
  let via;
  try {
    via = await authorise(args);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  console.error(`✓ credentials accepted (via ${via})`);

  const me = await api(args, "GET", "/user_account");
  console.error(`✓ account: ${me.username || "(no username returned)"}` +
    (me.account_type ? ` — ${me.account_type}` : ""));

  const wanted = [...new Set(manifest.map((row) => row.board))];
  const all = await listBoards(args);
  let missing = 0;
  for (const name of wanted) {
    const id = all.get(name.toLowerCase());
    if (id) console.error(`✓ board "${name}" (${id})`);
    else { console.error(`✗ board "${name}" — not on this account`); missing++; }
  }

  if (missing) {
    console.error(`\n${missing} board(s) missing. Create them in Pinterest with exactly those\n` +
      "names, or rename the board in sites.js to match one you have. Names are\n" +
      "matched without regard to case, but not to spelling.");
    if (all.size) {
      console.error("\nBoards this account does have:");
      for (const name of all.keys()) console.error(`  ${name}`);
    }
    process.exit(1);
  }

  if (args.verifyWrite) {
    console.error("\nTesting write access on a secret board …");
    await verifyWrite(args, manifest);
    console.error("\n✓ write access confirmed — the token can create pins.");
  }

  console.error(`\nAll clear. ${manifest.length} pin(s) in the queue; nothing has been ` +
    (args.verifyWrite ? "published." : "posted, and write access is untested — " +
      "--verify-write proves it without publishing anything."));
  process.exit(0);
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const today = args.today || new Date().toISOString().slice(0, 10);

  const manifest = readJson(args.manifest, null);
  if (!manifest) {
    console.error(`no manifest at ${args.manifest} — run bin/make-pins.js first.`);
    process.exit(2);
  }
  /* Before anything about scheduling: whether the credentials work at all is
     independent of whether a pin is due, and "nothing due" is a useless answer
     to someone who has just finished adding secrets. */
  if (args.verify) return verify(args, manifest);

  const ledger = readJson(args.ledger, {});

  /* Two ways to decide what is due, for the two ways this gets run.

     By date, for posting from a laptop: the queue carries its own calendar, so
     a session on Sunday can catch up on the week without posting the whole
     month.

     By position, for a scheduled job: --ignore-dates takes the next unposted
     pins in queue order and lets the cron schedule be the calendar. That way
     regenerating the queue — which restamps every date — cannot make a
     workflow suddenly think a fortnight is overdue. */
  const due = manifest
    .filter((row) => args.ignoreDates || row.date <= today)
    .filter((row) => !ledger[row.file]);

  if (!due.length) {
    const next = manifest.filter((row) => !ledger[row.file])[0];
    console.error(next
      ? `nothing due. Next is "${next.title}" on ${next.date}.`
      : "the whole queue has been posted. Time to write more pins in sites.js.");
    process.exit(0);
  }

  const batch = due.slice(0, args.max);
  console.error(`${due.length} pin(s) due; posting ${batch.length} this run` +
    (args.sandbox ? " (sandbox)" : "") + (args.post ? "" : " — DRY RUN, nothing will be posted") + ".");

  for (const row of batch) {
    console.error(`  ${row.date}  ${row.board}  ${row.title}`);
    console.error(`            ${row.file} → ${row.link}`);
    if (!fs.existsSync(row.file)) {
      console.error(`✗ missing image ${row.file} — re-run bin/make-pins.js`);
      process.exit(1);
    }
  }

  if (!args.post) {
    console.error("\nAdd --post to publish these. Add --sandbox --post to rehearse first.");
    process.exit(0);
  }

  let via;
  try {
    via = await authorise(args);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  const me = await api(args, "GET", "/user_account");
  console.error(`\nposting as ${me.username || "(unknown account)"} (via ${via})`);

  const boards = await resolveBoards(args, [...new Set(batch.map((r) => r.board))]);

  let posted = 0;
  for (const row of batch) {
    try {
      const pin = await postPin(args, row, boards.get(row.board));
      /* Written after each pin, not at the end: a crash halfway through a
         batch must not re-post what already went out. */
      ledger[row.file] = { pinId: pin.id, at: new Date().toISOString(), board: row.board };
      fs.writeFileSync(args.ledger, JSON.stringify(ledger, null, 2) + "\n");
      posted++;
      console.error(`  ✓ ${row.title} → pin ${pin.id}`);
    } catch (err) {
      console.error(`  ✗ ${row.title}: ${err.message}`);
      if (err.status === 401 || err.status === 403) {
        console.error("    The token is rejected. If the app is still on trial access it can " +
          "only post to the account that created it.");
      }
      process.exit(1);
    }
    /* Pinterest's write limits are generous but not infinite, and there is no
       hurry — the whole point of the queue is that it is not in a hurry. */
    await sleep(3000);
  }

  console.error(`\n${posted} posted. Ledger: ${args.ledger}`);
})().catch((err) => {
  /* Anything that reaches here is an API or network failure. The message
     already says what failed and why; a stack trace through three async
     frames adds nothing for someone who has just wired up credentials. */
  console.error(err.message);
  process.exit(1);
});
