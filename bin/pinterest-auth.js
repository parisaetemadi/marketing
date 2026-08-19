#!/usr/bin/env node
/* Gets a Pinterest refresh token, once, so nothing else ever has to ask.
 *
 * The developer console at developers.pinterest.com has a "Generate token"
 * button, and it is a trap for this purpose: it hands out a short-lived test
 * access token with a fixed, mostly read-only set of scopes. There is no
 * button anywhere on that site that gives you a refresh token. The only way to
 * get one is the OAuth authorisation-code flow — send a person to Pinterest,
 * have them approve the app, catch the code Pinterest sends back, and trade it
 * in. That is three moving parts and an HTTP listener, which is why this file
 * exists rather than a paragraph of instructions.
 *
 * It runs on your own machine, once. Nothing here goes near CI.
 *
 *   1. Register a redirect URI on the app at developers.pinterest.com.
 *      Try http://localhost:8385/callback first — if Pinterest refuses it,
 *      see --code below.
 *   2. export PINTEREST_APP_ID=… PINTEREST_APP_SECRET=…
 *   3. node bin/pinterest-auth.js
 *   4. Approve in the browser it opens.
 *
 * It prints the refresh token to your terminal and stops. It writes nothing to
 * disk: the only copy that should outlive the run is the one you paste into the
 * PINTEREST_REFRESH_TOKEN repository secret.
 *
 * If Pinterest will not accept a localhost redirect URI — some accounts are
 * restricted to https — register an https URL you control instead, approve in
 * the browser, and copy the `code` parameter out of the address bar you land
 * on. Then:
 *
 *   node bin/pinterest-auth.js --code <code> --redirect https://your.url/here
 *
 * The redirect URI has to match what you registered, exactly, both times.
 */

const http = require("http");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { send } = require("../lib/fetch");

const LIVE = "https://api.pinterest.com/v5";
const SANDBOX = "https://api-sandbox.pinterest.com/v5";
const AUTHORIZE = "https://www.pinterest.com/oauth/";

/* Everything post-pins.js needs and nothing else. boards:write is here so the
   poster can create a missing board with --create-boards; drop it from this
   list if you would rather create every board by hand. */
const SCOPES = ["boards:read", "boards:write", "pins:read", "pins:write"];

const DEFAULT_PORT = 8385;
const DEFAULT_REDIRECT = `http://localhost:${DEFAULT_PORT}/callback`;

function parseArgs(argv) {
  const args = { redirect: null, code: null, sandbox: false, port: DEFAULT_PORT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--code") args.code = argv[++i];
    else if (a === "--redirect") args.redirect = argv[++i];
    else if (a === "--sandbox") args.sandbox = true;
    else if (a === "--port") args.port = Number(argv[++i]) || DEFAULT_PORT;
  }
  if (!args.redirect) args.redirect = `http://localhost:${args.port}/callback`;
  return args;
}

function cred(name) {
  return (process.env[name] || "").trim();
}

/* Trade the authorisation code for tokens. Same endpoint the poster uses to
   refresh, different grant. */
async function exchange(args, code) {
  const base = args.sandbox ? SANDBOX : LIVE;
  const res = await send(base + "/oauth/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(
        `${cred("PINTEREST_APP_ID")}:${cred("PINTEREST_APP_SECRET")}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: args.redirect,
    }).toString(),
  });

  if (!res.ok || !res.json || !res.json.refresh_token) {
    const detail = res.json && res.json.message ? res.json.message : res.body.slice(0, 300);
    throw new Error(
      `Pinterest refused the code (${res.status}): ${detail}\n\n` +
      "  The usual causes:\n" +
      "    1. The redirect URI here is not character-for-character the one\n" +
      "       registered on the app. Pinterest compares them exactly.\n" +
      "    2. The code was already used. They are single-use — start again.\n" +
      "    3. The code expired. They last minutes, not hours.\n" +
      "    4. The app id or secret belongs to a different app."
    );
  }
  return res.json;
}

function report(tokens) {
  const granted = (tokens.scope || "").split(/[\s,]+/).filter(Boolean);
  const missing = SCOPES.filter((s) => !granted.includes(s));

  console.error("\n────────────────────────────────────────────────────────────");
  console.error("Refresh token (put this in the PINTEREST_REFRESH_TOKEN secret):\n");
  console.error("  " + tokens.refresh_token);
  console.error("\nAccess token, if you want to post today without waiting:\n");
  console.error("  " + tokens.access_token);
  console.error("────────────────────────────────────────────────────────────");

  if (granted.length) console.error(`\nScopes granted: ${granted.join(", ")}`);
  if (missing.length) {
    console.error(`\n⚠ Missing: ${missing.join(", ")}`);
    console.error("  Posting needs pins:write. Add the scopes to the app at");
    console.error("  developers.pinterest.com and run this again — an approval only");
    console.error("  grants what the app asked for at the time.");
  }

  console.error("\nThese are credentials. They belong in GitHub → Settings → Secrets and");
  console.error("variables → Actions, and nowhere else — not a file, not a commit, not a");
  console.error("chat window. Nothing has been written to disk.");
  console.error("\nThen: Actions → Post a pin → Run workflow → verify.");
}

/* The listener that catches Pinterest's redirect.

   Bound to 127.0.0.1 rather than every interface: for the ninety seconds this
   is up it is holding an authorisation code, and there is no reason for anyone
   else on the network to be able to reach it. */
function waitForCode(args, state) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${args.port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("not here");
        return;
      }

      const code = url.searchParams.get("code");
      const returned = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      const page = (title, body) => `<!doctype html><meta charset="utf-8">` +
        `<title>${title}</title><style>body{font:17px/1.6 -apple-system,system-ui,` +
        `sans-serif;max-width:34em;margin:18vh auto;padding:0 24px;color:#2b2724;` +
        `background:#f7f4ef}h1{font:400 32px Georgia,serif;margin:0 0 12px}</style>` +
        `<h1>${title}</h1><p>${body}</p>`;

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" })
          .end(page("Not authorised", "Pinterest returned: " + error +
            ". You can close this tab."));
        server.close();
        reject(new Error(`Pinterest returned "${error}"`));
        return;
      }
      /* The state check is what stops someone else's redirect being accepted
         as if it were the one this run asked for. */
      if (!code || returned !== state) {
        res.writeHead(400, { "Content-Type": "text/html" })
          .end(page("Something is off", "That response did not match this request. " +
            "Close this tab and run the command again."));
        server.close();
        reject(new Error("the redirect did not match this request (state mismatch)"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" })
        .end(page("Done", "You can close this tab and go back to the terminal."));
      server.close();
      resolve(code);
    });

    server.on("error", (err) => {
      reject(err.code === "EADDRINUSE"
        ? new Error(`something is already listening on port ${args.port}. ` +
            "Close it, or pass --port with a different number (and register that " +
            "redirect URI on the app).")
        : err);
    });

    server.listen(args.port, "127.0.0.1", () => {
      const url = AUTHORIZE + "?" + new URLSearchParams({
        client_id: cred("PINTEREST_APP_ID"),
        redirect_uri: args.redirect,
        response_type: "code",
        scope: SCOPES.join(","),
        state,
      }).toString();

      console.error("Open this and approve the app:\n");
      console.error("  " + url + "\n");
      console.error(`Waiting for Pinterest to come back to ${args.redirect} …`);
      console.error("(Ctrl-C to give up.)");

      /* Best effort. If there is no `open`, the URL is already printed. */
      execFile("open", [url], () => {});
    });

    setTimeout(() => {
      server.close();
      reject(new Error("nothing came back within five minutes; giving up"));
    }, 5 * 60 * 1000).unref();
  });
}

(async () => {
  const args = parseArgs(process.argv.slice(2));

  if (!cred("PINTEREST_APP_ID") || !cred("PINTEREST_APP_SECRET")) {
    console.error(
      "PINTEREST_APP_ID and PINTEREST_APP_SECRET are needed to do this.\n" +
      "  Both are on the app's page at developers.pinterest.com. Export them in\n" +
      "  this terminal rather than putting them in a file:\n\n" +
      "    export PINTEREST_APP_ID=…\n" +
      "    export PINTEREST_APP_SECRET=…"
    );
    process.exit(2);
  }

  /* The manual path, for when Pinterest will not register a localhost URI. */
  if (args.code) {
    report(await exchange(args, args.code));
    return;
  }

  if (!/^https?:\/\//.test(args.redirect)) {
    console.error(`--redirect must be a full URL, got "${args.redirect}"`);
    process.exit(2);
  }

  console.error(`Redirect URI: ${args.redirect}`);
  console.error("This must already be registered on the app, character for character.\n");

  const state = crypto.randomBytes(16).toString("hex");
  const code = await waitForCode(args, state);
  console.error("\nGot the code. Trading it in …");
  report(await exchange(args, code));
})().catch((err) => {
  console.error("\n" + err.message);
  process.exit(1);
});
