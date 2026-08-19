/* The look of a pin.

   A Pinterest pin is 1000×1500 and is first seen about 230px wide, in a column
   of forty other things. That is the whole design brief: one idea, set large
   enough to read at thumbnail size, in the visual language of the site it
   links to — someone who clicks should recognise the page they land on.

   So the palettes below are lifted from the sites' own CSS custom properties
   rather than invented here. If a site's tokens change, these should change
   with them; they are the same brand, and a pin that looks like a stock
   template is a pin nobody trusts.

   Three layouts, because three is what the content actually is:

     statement  one sentence, set big. Works for any page.
     numbers    a headline and a short table. This is the format that wins on
                Pinterest, because "how many should I print" is a question with
                an answer and the pin can just be the answer.
     checklist  a headline and a list of steps.

   Rendering the same page in more than one layout is deliberate. Pinterest
   rewards several distinct pins pointing at one URL over months, and punishes
   the same image posted repeatedly, so the layouts are how one guide becomes a
   posting queue instead of a single post. */

const THEMES = {
  /* Quillbill: ink, paper and money green, bold sans display, mono labels —
     the landing page's own vocabulary. */
  quillbill: {
    bg: "#faf9f5",
    card: "#ffffff",
    ink: "#16241f",
    inkSoft: "#33453d",
    muted: "#5c6b64",
    line: "#e4e2da",
    accent: "#0e6b54",
    accentDeep: "#0a5241",
    tint: "#e7f2ee",
    display: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Liberation Sans", "DejaVu Sans", sans-serif',
    body: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Liberation Sans", "DejaVu Sans", sans-serif',
    label: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
    displayWeight: 700,
    tracking: "-0.02em",
    radius: 18,
  },

  /* Order of Service Maker: warm paper, sage, Georgia. Quiet by intent —
     people arrive here in the worst week of their year, and a pin is the first
     thing they see of it. */
  orderofservicemaker: {
    bg: "#f7f4ef",
    card: "#fffdf9",
    ink: "#2b2724",
    inkSoft: "#635a52",
    muted: "#8d837a",
    line: "#ddd6cc",
    accent: "#5f7460",
    accentDeep: "#46583f",
    tint: "#f1ece4",
    display: 'Georgia, "Iowan Old Style", Charter, "Bitstream Charter", "Liberation Serif", "Times New Roman", serif',
    body: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Liberation Sans", "DejaVu Sans", sans-serif',
    label: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Liberation Sans", "DejaVu Sans", sans-serif',
    displayWeight: 400,
    tracking: "-0.005em",
    radius: 10,
  },
};

const WIDTH = 1000;
const HEIGHT = 1500;

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* Headline size, from length. Chrome will not shrink text to fit, and a
   headline that overflows the canvas is silently cropped rather than reported,
   so the size is chosen up front and the layouts leave room to be wrong. */
function headlineSize(text, biggest, smallest) {
  const n = String(text).length;
  if (n <= 24) return biggest;
  if (n <= 40) return Math.round(biggest * 0.82);
  if (n <= 60) return Math.round(biggest * 0.68);
  return smallest;
}

function shell(theme, inner, extraCss) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden;
    background: ${theme.bg}; color: ${theme.ink};
    font-family: ${theme.body};
    -webkit-font-smoothing: antialiased;
  }
  .pin {
    width: 100%; height: 100%;
    display: flex; flex-direction: column;
    padding: 72px 76px 64px;
  }
  .kicker {
    font-family: ${theme.label};
    font-size: 21px; letter-spacing: .14em; text-transform: uppercase;
    color: ${theme.accentDeep};
  }
  .rule { height: 3px; background: ${theme.accent}; width: 96px; margin: 22px 0 0; }
  .body { flex: 1; display: flex; flex-direction: column; justify-content: center; }
  h1 {
    font-family: ${theme.display};
    font-weight: ${theme.displayWeight};
    letter-spacing: ${theme.tracking};
    line-height: 1.1;
    margin: 0;
    text-wrap: balance;
  }
  .support {
    font-size: 33px; line-height: 1.5; color: ${theme.inkSoft};
    margin: 34px 0 0; max-width: 780px;
  }
  .foot {
    display: flex; align-items: baseline; gap: 14px;
    border-top: 2px solid ${theme.line}; padding-top: 26px;
  }
  .foot .domain { font-family: ${theme.label}; font-size: 25px; color: ${theme.ink}; }
  .foot .tag { font-size: 22px; color: ${theme.muted}; margin-left: auto; }
${extraCss || ""}
</style></head><body><div class="pin">${inner}</div></body></html>`;
}

function foot(pin, theme) {
  return `<div class="foot">
    <span class="domain">${esc(pin.domain)}</span>
    <span class="tag">${esc(pin.footNote || "")}</span>
  </div>`;
}

/* ------------------------------------------------------------- layouts */

function statement(pin, theme) {
  const size = headlineSize(pin.headline, 92, 62);
  return shell(theme, `
  <div class="kicker">${esc(pin.kicker)}</div>
  <div class="rule"></div>
  <div class="body">
    <h1 style="font-size:${size}px">${esc(pin.headline)}</h1>
    ${pin.support ? `<p class="support">${esc(pin.support)}</p>` : ""}
  </div>
  ${foot(pin, theme)}`, `
  /* Nudged up: a block centred by arithmetic reads as sitting low. */
  .body { padding-bottom: 90px; }`);
}

function numbers(pin, theme) {
  const size = headlineSize(pin.headline, 82, 56);
  const rows = (pin.rows || []).map((r) => `
      <div class="row">
        <span class="row-label">${esc(r.label)}</span>
        <span class="row-value">${esc(r.value)}</span>
      </div>`).join("");
  return shell(theme, `
  <div class="kicker">${esc(pin.kicker)}</div>
  <div class="rule"></div>
  <div class="body">
    <h1 style="font-size:${size}px">${esc(pin.headline)}</h1>
    <div class="card">${rows}</div>
    ${pin.support ? `<p class="support small">${esc(pin.support)}</p>` : ""}
  </div>
  ${foot(pin, theme)}`, `
  .card {
    background: ${theme.card}; border: 2px solid ${theme.line};
    border-radius: ${theme.radius}px; margin: 48px 0 0; padding: 10px 40px;
  }
  .row {
    display: flex; align-items: baseline; gap: 20px;
    padding: 34px 0; border-bottom: 2px solid ${theme.line};
  }
  .row:last-child { border-bottom: 0; }
  .row-label { font-size: 34px; color: ${theme.inkSoft}; }
  .row-value {
    margin-left: auto; text-align: right;
    font-family: ${theme.display}; font-weight: ${theme.displayWeight};
    font-size: 44px; color: ${theme.accentDeep}; letter-spacing: ${theme.tracking};
  }
  .support.small { font-size: 29px; margin-top: 38px; }
  .body { padding-bottom: 60px; }`);
}

function checklist(pin, theme) {
  const size = headlineSize(pin.headline, 82, 56);
  const items = (pin.items || []).map((t) => `<li>${esc(t)}</li>`).join("");
  return shell(theme, `
  <div class="kicker">${esc(pin.kicker)}</div>
  <div class="rule"></div>
  <div class="body">
    <h1 style="font-size:${size}px">${esc(pin.headline)}</h1>
    <ul class="list">${items}</ul>
  </div>
  ${foot(pin, theme)}`, `
  .list { margin: 48px 0 0; padding: 0; list-style: none; }
  .list li {
    font-size: 34px; line-height: 1.45; color: ${theme.inkSoft};
    padding: 0 0 34px 52px; position: relative;
  }
  .list li:last-child { padding-bottom: 0; }
  /* A rule, not a tick or a bullet character: ticks read as a checkout page
     and emoji do not belong on a funeral pin. */
  .list li::before {
    content: ""; position: absolute; left: 0; top: 23px;
    width: 30px; height: 3px; background: ${theme.accent};
  }
  .body { padding-bottom: 60px; }`);
}

const LAYOUTS = { statement, numbers, checklist };

/* Which layouts a pin can be rendered in, given what it actually carries. */
function layoutsFor(pin) {
  const out = ["statement"];
  if (pin.rows && pin.rows.length) out.push("numbers");
  if (pin.items && pin.items.length) out.push("checklist");
  return out;
}

function render(pin, layout, siteKey) {
  const theme = THEMES[siteKey];
  if (!theme) throw new Error(`no pin theme for site "${siteKey}"`);
  const fn = LAYOUTS[layout];
  if (!fn) throw new Error(`no such pin layout: ${layout}`);
  return fn(pin, theme);
}

module.exports = { render, layoutsFor, THEMES, WIDTH, HEIGHT, esc };
