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
 *   2. node bin/pinterest-auth.js
 *   3. Give it the app id and secret when it asks. The secret is not echoed.
 *   4. Approve in the browser it opens.
 *
 * It asks rather than reading the environment because getting a secret into an
 * environment variable is, empirically, the hardest step here: `export` leaves
 * it in shell history, and `read -rs` prints no prompt and eats the newline of
 * anything pasted after it, so it silently returns empty. PINTEREST_APP_ID and
 * PINTEREST_APP_SECRET are still honoured if they are already set.
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
const readline = require("readline");
const { execFile } = require("child_process");
const { send } = require("../lib/fetch");

const LIVE = "https://api.pinterest.com/v5";
const SANDBOX = "https://api-sandbox.pinterest.com/v5";
const AUTHORIZE = "https://www.pinterest.com/oauth/";

/* Everything post-pins.js needs, and nothing beyond it.

   Pinterest splits every write in two: `boards:write` covers public boards and
   `boards:write_secret` covers secret ones, and the same for pins. That is not
   a detail to skip, because --verify-write does its whole test on a secret
   board — creating one, pinning to it, deleting both — precisely so that
   nothing is ever published. Without the _secret pair, the safe test is the
   one thing the token cannot do, and re-running this flow is not something
   anyone wants to do twice.

     boards:read           list boards, to turn a board name into an id
     boards:write          create a missing board with --create-boards
     boards:write_secret   the throwaway board --verify-write uses
     pins:read             read back a pin after creating it
     pins:write            the actual job
     pins:write_secret     the throwaway pin --verify-write uses

   Deliberately absent: ads, billing, catalogs, user_accounts. Nothing here
   touches any of them. */
const SCOPES = [
  "boards:read", "boards:write", "boards:write_secret",
  "pins:read", "pins:write", "pins:write_secret",
];

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

/* Ask for a value on the terminal, optionally without echoing it.

   This exists because getting a secret into an environment variable turns out
   to be the hardest step of the whole setup. `export FOO=…` puts it in shell
   history; `read -rs` shows no prompt and swallows the newline of whatever was
   pasted after it, so it returns empty and looks like it worked. Neither
   failure announces itself, and both leave you staring at an authentication
   error much later.

   Asking here sidesteps all of it: nothing reaches the shell, nothing reaches
   history, and an empty answer is caught immediately. */
function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin, output: process.stderr, terminal: true,
    });
    if (hidden) {
      /* readline writes each keystroke back to the output; replace that with
         writing nothing but the prompt itself. */
      rl._writeToOutput = (chunk) => {
        if (chunk.includes(question)) rl.output.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stderr.write("\n");
      resolve(String(answer).trim());
    });
  });
}

/* The app id and secret, from the environment or from the person running this.

   Prompting needs a terminal. On CI there isn't one, and a prompt would hang
   a job until it timed out — so there it stays an error with instructions. */
async function appCredentials() {
  let id = cred("PINTEREST_APP_ID");
  let secret = cred("PINTEREST_APP_SECRET");
  if (id && secret) return { id, secret };

  if (!process.stdin.isTTY) {
    throw new Error(
      "PINTEREST_APP_ID and PINTEREST_APP_SECRET are needed to do this, and\n" +
      "  there is no terminal here to ask on. Both are on the app's page at\n" +
      "  developers.pinterest.com."
    );
  }

  console.error("Both of these are on the app's page at developers.pinterest.com.");
  console.error("Nothing typed here is stored, echoed, or written to disk.\n");
  if (!id) id = await ask("App id: ", false);
  if (!secret) secret = await ask("App secret (hidden): ", true);

  if (!id || !secret) throw new Error("both an app id and an app secret are needed.");
  return { id, secret };
}

/* Trade the authorisation code for tokens. Same endpoint the poster uses to
   refresh, different grant. */
async function exchange(args, code, app) {
  const base = args.sandbox ? SANDBOX : LIVE;
  const res = await send(base + "/oauth/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${app.id}:${app.secret}`).toString("base64"),
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
function waitForCode(args, state, app) {
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
        client_id: app.id,
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
  const app = await appCredentials();

  /* The manual path, for when Pinterest will not register a localhost URI. */
  if (args.code) {
    report(await exchange(args, args.code, app));
    return;
  }

  if (!/^https?:\/\//.test(args.redirect)) {
    console.error(`--redirect must be a full URL, got "${args.redirect}"`);
    process.exit(2);
  }

  console.error(`Redirect URI: ${args.redirect}`);
  console.error("This must already be registered on the app, character for character.\n");

  const state = crypto.randomBytes(16).toString("hex");
  const code = await waitForCode(args, state, app);
  console.error("\nGot the code. Trading it in …");
  report(await exchange(args, code, app));
})().catch((err) => {
  console.error("\n" + err.message);
  process.exit(1);
});
