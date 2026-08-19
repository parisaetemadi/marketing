/* HTML → PNG, using a Chrome that is already on the machine.

   Every "render an image from HTML" recipe reaches for Puppeteer or
   Playwright, which is a browser download and a large dependency tree. Chrome
   has had `--headless --screenshot` built in for years, and it is enough: give
   it a file, a window size and an output path, and it writes a PNG. So this
   repo stays at zero dependencies, and the tool runs wherever a browser is
   already installed — a laptop, a CI runner, this container.

   Two things then need doing properly, and the rest of this file is them:

   1. Finding the binary. "Chrome" lives somewhere different on every machine.

   2. Getting the size right. --window-size sets the size of the *window*, and
      modern headless Chrome is a real window with a toolbar, so the page is
      laid out in roughly ninety fewer pixels than you asked for while the
      screenshot still comes out at the full size. The bottom of the design is
      simply not drawn. Nothing reports this — the file exists, the dimensions
      are exactly what Pinterest wants, and the footer is missing.

      So the renderer measures the gap once per run against whatever browser it
      found, asks for a window that much larger, and crops back. On a browser
      with no window furniture (chrome-headless-shell) the gap measures zero
      and the crop is a no-op. */

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync: run } = require("child_process");

/* --- finding a browser --------------------------------------------------- */

/* Checked in order. CHROME_BIN wins so a machine with an unusual install can
   say so without editing this list. */
function candidates() {
  const out = [];
  if (process.env.CHROME_BIN) out.push(process.env.CHROME_BIN);

  /* Playwright's browser cache, if something else on the machine installed it.
     Its headless shell is preferred over its full browser: no window
     furniture, so no crop. The version number changes, so glob. */
  const pwRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  const pw = [];
  try {
    for (const entry of fs.readdirSync(pwRoot)) {
      const dir = path.join(pwRoot, entry);
      if (entry.startsWith("chromium_headless_shell-")) {
        pw.unshift(path.join(dir, "chrome-linux", "headless_shell"));
      } else if (entry.startsWith("chromium-")) {
        pw.push(path.join(dir, "chrome-linux", "chrome"));
        pw.push(path.join(dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"));
      }
    }
  } catch (_) { /* no such directory; fine */ }
  out.push(...pw);

  out.push(
    /* macOS */
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    /* Linux, including GitHub Actions runners */
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    /* Windows, for completeness */
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  );
  return out;
}

let chromeCache = null;

function findChrome() {
  if (chromeCache) return chromeCache;
  for (const c of candidates()) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      chromeCache = c;
      return chromeCache;
    } catch (_) { /* next */ }
  }
  throw new Error(
    "no Chrome or Chromium found.\n" +
    "  Install Google Chrome, or point CHROME_BIN at a browser binary:\n" +
    "    CHROME_BIN=\"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\" node bin/make-pins.js"
  );
}

/* --- just enough PNG ----------------------------------------------------- */

/* Chrome writes 8-bit RGB or RGBA, so that is all this handles. It is here to
   crop a screenshot and to measure a calibration frame — not to be a general
   image library. */

function chunks(buf) {
  const out = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    out.push({ type: buf.toString("ascii", pos + 4, pos + 8), data: buf.slice(pos + 8, pos + 8 + len) });
    pos += 12 + len;
  }
  return out;
}

function decodePng(buf) {
  if (buf.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("not a PNG");
  let width, height, channels;
  const idat = [];
  for (const c of chunks(buf)) {
    if (c.type === "IHDR") {
      width = c.data.readUInt32BE(0);
      height = c.data.readUInt32BE(4);
      const depth = c.data[8], colorType = c.data[9];
      if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth}`);
      if (colorType === 2) channels = 3;
      else if (colorType === 6) channels = 4;
      else throw new Error(`unsupported PNG colour type ${colorType}`);
    } else if (c.type === "IDAT") idat.push(c.data);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);

  /* Undo the per-row filters. Straight out of the PNG spec; the only subtlety
     is that "the pixel to the left" is zero at the start of a row. */
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = src;
    src += stride;
    const to = y * stride;
    const up = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[row + x];
      const a = x >= channels ? pixels[to + x - channels] : 0;
      const b = y > 0 ? pixels[up + x] : 0;
      const c = (x >= channels && y > 0) ? pixels[up + x - channels] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        add = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      pixels[to + x] = (value + add) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(zlib.crc32(out.slice(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(img) {
  const { width, height, channels, pixels } = img;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                       /* filter: none */
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crop(img, width, height) {
  if (img.width === width && img.height === height) return img;
  const stride = width * img.channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    img.pixels.copy(pixels, y * stride, y * img.width * img.channels,
      y * img.width * img.channels + stride);
  }
  return { width, height, channels: img.channels, pixels };
}

/* --- driving the browser ------------------------------------------------- */

function screenshot(chrome, html, width, height, out) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
  const page = path.join(tmp, "page.html");
  fs.writeFileSync(page, html);

  const args = [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-sandbox",              /* required when running as root in a container */
    "--disable-dev-shm-usage",
    "--force-device-scale-factor=1",
    `--window-size=${width},${height}`,
    /* No images, no webfonts, no script, so layout is already settled — but a
       small budget makes the result the same every run. */
    "--virtual-time-budget=1500",
    `--screenshot=${out}`,
    `file://${page}`,
  ];

  try {
    /* Chrome is chatty on stderr about dbus and GPU sockets in containers.
       None of it affects the screenshot, so it is swallowed unless the run
       actually fails. */
    run(chrome, args, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    const detail = err.stderr ? String(err.stderr).trim().split("\n").slice(-3).join("\n") : "";
    throw new Error(`Chrome failed to render ${path.basename(out)}\n${detail}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (!fs.existsSync(out)) throw new Error(`Chrome wrote no file for ${out}`);
}

/* How much smaller than the window the page area actually is.

   Measured, not assumed: paint the whole viewport black, screenshot it, and
   see where the black stops. A browser with no window furniture returns
   {dx: 0, dy: 0} and everything downstream becomes a no-op. */
let offsetCache = null;

function viewportOffset(chrome) {
  if (offsetCache) return offsetCache;
  const W = 400, H = 600;
  const html = '<!doctype html><meta charset="utf-8">' +
    '<style>html,body{margin:0;padding:0}' +
    '#v{position:fixed;inset:0;background:#000}</style><div id="v"></div>';

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "calib-"));
  const file = path.join(tmp, "calibration.png");
  try {
    screenshot(chrome, html, W, H, file);
    const img = decodePng(fs.readFileSync(file));
    let lastX = -1, lastY = -1;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (img.pixels[y * img.width * img.channels + x * img.channels] < 64) {
          if (x > lastX) lastX = x;
          if (y > lastY) lastY = y;
        }
      }
    }
    if (lastX < 0 || lastY < 0) throw new Error("calibration frame came back blank");
    offsetCache = { dx: W - (lastX + 1), dy: H - (lastY + 1) };
    /* A sane gap is a toolbar's worth. Anything else means the assumption
       behind this whole dance is wrong, and guessing would be worse. */
    if (offsetCache.dx < 0 || offsetCache.dy < 0 || offsetCache.dx > 200 || offsetCache.dy > 400) {
      throw new Error(`browser viewport measured ${lastX + 1}×${lastY + 1} in a ${W}×${H} window; ` +
        "that is not a window-furniture offset and the crop would be wrong");
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return offsetCache;
}

/* Render an HTML string to a PNG of exactly width × height.

   The page must not scroll — the caller's CSS fixes the body to the canvas
   size. --force-device-scale-factor=1 keeps the output pixel-exact on a HiDPI
   machine, where the default would quietly produce a 2000×3000 image. */
function renderToPng(html, opts) {
  const { width, height, out } = opts;
  const chrome = findChrome();
  const off = viewportOffset(chrome);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  screenshot(chrome, html, width + off.dx, height + off.dy, out);

  if (off.dx || off.dy) {
    const img = decodePng(fs.readFileSync(out));
    fs.writeFileSync(out, encodePng(crop(img, width, height)));
  }
  return out;
}

/* PNG dimensions, read from the IHDR chunk. Used to prove the output really is
   the size Pinterest wants rather than trusting the flag. */
function pngSize(file) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(24);
  fs.readSync(fd, buf, 0, 24, 0);
  fs.closeSync(fd);
  if (buf.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

module.exports = { renderToPng, findChrome, pngSize, viewportOffset, decodePng, encodePng };
