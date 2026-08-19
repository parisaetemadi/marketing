/* A small HTTP helper: retries, a real User-Agent, and a polite delay between
   calls. Node 22's global fetch does the work; this only adds the manners.

   Every API these tools touch is free and unauthenticated, which means they
   are also entitled to rate-limit us. Backing off is the rent. */

const UA = process.env.MARKETING_UA ||
  "quillbill-marketing-tools/1.0 (+https://quillbill.app; contact ask@quillbill.app)";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function get(url, options) {
  const opts = options || {};
  const attempts = opts.attempts || 3;
  const headers = Object.assign({ "User-Agent": UA, "Accept": "*/*" }, opts.headers);

  let lastErr;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(Math.pow(2, i) * 1000);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeout || 20000);
      let res;
      try {
        res = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
      } finally {
        clearTimeout(timer);
      }

      /* 429 and 5xx are worth another go; 4xx means we asked wrongly. */
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} from ${url}`);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return { status: res.status, body: await res.text(), headers: res.headers };
    } catch (err) {
      lastErr = err;
      if (err.name === "AbortError") lastErr = new Error(`timed out fetching ${url}`);
    }
  }
  throw lastErr;
}

/* Like get(), but for talking to an API: any method, a body, and — the part
   that matters — a 4xx comes back as a value rather than an exception. An API
   that refuses a request explains why in the body, and throwing that away in
   favour of "HTTP 400" turns a one-line fix into an afternoon. */
async function send(url, options) {
  const opts = options || {};
  const attempts = opts.attempts || 3;
  const headers = Object.assign({ "User-Agent": UA, "Accept": "application/json" }, opts.headers);

  let lastErr;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(Math.pow(2, i) * 1000);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeout || 30000);
      let res;
      try {
        res = await fetch(url, {
          method: opts.method || "GET", headers, body: opts.body,
          signal: controller.signal, redirect: "follow",
        });
      } finally {
        clearTimeout(timer);
      }

      const text = await res.text();
      /* Retry only what is worth retrying. A 4xx will say the same thing
         three times. */
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`);
        continue;
      }
      let json = null;
      try { json = JSON.parse(text); } catch (_) { /* not JSON; keep the text */ }
      return { status: res.status, ok: res.ok, body: text, json, headers: res.headers };
    } catch (err) {
      lastErr = err;
      if (err.name === "AbortError") lastErr = new Error(`timed out calling ${url}`);
    }
  }
  throw lastErr;
}

async function getJson(url, options) {
  const res = await get(url, options);
  try {
    return JSON.parse(res.body);
  } catch (err) {
    throw new Error(`expected JSON from ${url}, got ${res.body.slice(0, 120)}…`);
  }
}

module.exports = { get, getJson, send, sleep, UA };
