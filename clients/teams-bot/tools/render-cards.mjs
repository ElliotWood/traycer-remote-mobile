/**
 * Renders this bot's Adaptive Cards to real PNGs, so "does it look good" is
 * answerable with evidence instead of opinion.
 *
 * Pipeline: card JSON -> the official `adaptivecards` renderer (the same
 * library Teams/WebChat render with) inside real Chromium via Playwright ->
 * screenshot. No mockup, no hand-written HTML approximation.
 *
 * Renders each card at THREE widths, because the responsive behaviour is the
 * whole point and a desktop-only screenshot hides the failure that matters:
 *   - 320px  phone      (Elliot's primary surface)
 *   - 500px  Teams chat pane, the common desktop case
 *   - 800px  wide
 *
 * Requires three paths in the environment (see `requireEnvPath` below):
 * AC_DIST_DIR, MARKDOWN_IT_PATH, CHROMIUM_PATH.
 *
 * Usage:
 *   node tools/render-cards.mjs <outDir> [--dark]
 */
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const OUT = process.argv[2] ?? "card-shots";
const DARK = process.argv.includes("--dark");

/**
 * `adaptivecards` and `markdown-it` are NOT dependencies of this package —
 * they are the renderer, needed only by this dev tool, and pulling a DOM
 * card renderer into a bot's dependency tree to take screenshots would be a
 * poor trade. Install them wherever you like and point these at the result.
 */
function requireEnvPath(name, hint) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    console.error(
      `${name} is not set.\n  ${hint}\n` +
        `  e.g. npm i adaptivecards markdown-it in a scratch dir, then set\n` +
        `  ${name} to the path below.`,
    );
    process.exit(1);
  }
  return value;
}

const AC_DIR = requireEnvPath(
  "AC_DIST_DIR",
  "Path to adaptivecards/dist (contains adaptivecards.js and .css).",
);

/**
 * `adaptivecards` does NOT bundle a markdown processor — it exposes
 * `AdaptiveCard.onProcessMarkdown` and renders text VERBATIM if nothing is
 * registered. Without this, `**bold**`, lists and links all screenshot as
 * literal punctuation, which is not what Teams does, and every conclusion
 * drawn from those images about markdown would be wrong.
 *
 * markdown-it is the processor the Adaptive Cards samples themselves use.
 */
const MD_PATH = requireEnvPath(
  "MARKDOWN_IT_PATH",
  "Path to markdown-it's browser bundle (markdown-it.min.js).",
);

/**
 * markdown-it rules for the constructs Teams' Adaptive Card renderer does not
 * support. Source: "Format cards with Markdown" (Adaptive Cards column) —
 * headers, tables, images, preformatted/code text and blockquotes are all
 * listed as unsupported. `code`/`fence` are indented and fenced blocks;
 * `backticks` is inline code.
 */
const TEAMS_UNSUPPORTED_MARKDOWN = [
  "heading",
  "lheading",
  "table",
  "code",
  "fence",
  "blockquote",
  "image",
  "backticks",
];

const WIDTHS = [
  { name: "320-phone", px: 320 },
  { name: "500-chat", px: 500 },
  { name: "800-wide", px: 800 },
];

/**
 * Teams-like host config. Deliberately minimal: the point is to check OUR
 * card structure, not to pixel-match Teams chrome. Fonts and the light/dark
 * surface colour are set so contrast problems show up honestly.
 */
const HOST_CONFIG = {
  fontFamily:
    "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif",
  // Without a `monospace` entry the renderer silently falls back to the
  // default family, and `fontType: "monospace"` TextBlocks would screenshot
  // as ordinary proportional text — hiding whether the treatment works.
  fontTypes: {
    default: {
      fontFamily:
        "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif",
    },
    monospace: {
      fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
    },
  },
  spacing: {
    small: 4,
    default: 8,
    medium: 16,
    large: 20,
    extraLarge: 24,
    padding: 16,
  },
  separator: { lineThickness: 1, lineColor: DARK ? "#3B3A39" : "#E1DFDD" },
  containerStyles: {
    default: {
      backgroundColor: DARK ? "#1F1F1F" : "#FFFFFF",
      foregroundColors: {
        default: {
          default: DARK ? "#FFFFFF" : "#242424",
          subtle: DARK ? "#ADADAD" : "#616161",
        },
        good: { default: "#0E7A0B", subtle: "#0E7A0B" },
        warning: { default: "#C19C00", subtle: "#C19C00" },
        attention: { default: "#C4314B", subtle: "#C4314B" },
        accent: { default: "#5B5FC7", subtle: "#5B5FC7" },
      },
    },
    emphasis: {
      backgroundColor: DARK ? "#2D2C2C" : "#F5F5F5",
      foregroundColors: {
        default: {
          default: DARK ? "#FFFFFF" : "#242424",
          subtle: DARK ? "#ADADAD" : "#616161",
        },
        good: { default: "#0E7A0B", subtle: "#0E7A0B" },
        warning: { default: "#C19C00", subtle: "#C19C00" },
        attention: { default: "#C4314B", subtle: "#C4314B" },
        accent: { default: "#5B5FC7", subtle: "#5B5FC7" },
      },
    },
    good: {
      backgroundColor: DARK ? "#0F2E0F" : "#E7F6E7",
      foregroundColors: {
        default: {
          default: DARK ? "#FFFFFF" : "#242424",
          subtle: DARK ? "#ADADAD" : "#616161",
        },
        good: { default: "#0E7A0B", subtle: "#0E7A0B" },
        warning: { default: "#C19C00", subtle: "#C19C00" },
        attention: { default: "#C4314B", subtle: "#C4314B" },
        accent: { default: "#5B5FC7", subtle: "#5B5FC7" },
      },
    },
    attention: {
      backgroundColor: DARK ? "#3B1620" : "#FDE7E9",
      foregroundColors: {
        default: {
          default: DARK ? "#FFFFFF" : "#242424",
          subtle: DARK ? "#ADADAD" : "#616161",
        },
        good: { default: "#0E7A0B", subtle: "#0E7A0B" },
        warning: { default: "#C19C00", subtle: "#C19C00" },
        attention: { default: "#C4314B", subtle: "#C4314B" },
        accent: { default: "#5B5FC7", subtle: "#5B5FC7" },
      },
    },
    warning: {
      backgroundColor: DARK ? "#3D3218" : "#FFF4CE",
      foregroundColors: {
        default: {
          default: DARK ? "#FFFFFF" : "#242424",
          subtle: DARK ? "#ADADAD" : "#616161",
        },
        good: { default: "#0E7A0B", subtle: "#0E7A0B" },
        warning: { default: "#C19C00", subtle: "#C19C00" },
        attention: { default: "#C4314B", subtle: "#C4314B" },
        accent: { default: "#5B5FC7", subtle: "#5B5FC7" },
      },
    },
  },
};

export async function renderCards(cards, outDir) {
  mkdirSync(outDir, { recursive: true });
  const acJs = readFileSync(join(AC_DIR, "adaptivecards.js"), "utf8");
  const acCss = readFileSync(join(AC_DIR, "adaptivecards.css"), "utf8");
  const mdJs = readFileSync(MD_PATH, "utf8");

  // `playwright-core` ships no browser and doesn't resolve the cached
  // download itself, so point it at an installed Chromium explicitly.
  const executablePath = requireEnvPath(
    "CHROMIUM_PATH",
    "Path to a Chromium/Chrome executable (playwright-core bundles none).",
  );
  const browser = await chromium.launch({ executablePath });
  const results = [];
  try {
    for (const { name: widthName, px } of WIDTHS) {
      const page = await browser.newPage({
        viewport: { width: px, height: 900 },
        deviceScaleFactor: 2,
      });
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${acCss}
         body{margin:0;padding:12px;background:${DARK ? "#141414" : "#F0F0F0"};
              font-family:'Segoe UI',system-ui,sans-serif;}
         .wrap{background:${DARK ? "#1F1F1F" : "#FFFFFF"};border-radius:8px;
               overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.18);}
        </style></head><body><div id="host"></div></body></html>`,
      );
      await page.addScriptTag({ content: mdJs });
      await page.addScriptTag({ content: acJs });
      // Must run after both scripts load, and before the first render.
      await page.evaluate((disabled) => {
        // Stock markdown-it renders MORE than Teams does: tables, headings,
        // fenced code and blockquotes all come out beautifully here and are
        // stripped to bare text by Teams. Left as-is, these screenshots would
        // flatter the cards and hide exactly the failure worth seeing, so the
        // rules Teams does not support are switched off.
        //
        // The kept set is Teams' documented Adaptive Card text support: bold,
        // italic, strikethrough, ordered/unordered lists, and links.
        const md = new window.markdownit();
        md.disable(disabled, /* ignoreInvalid */ true);
        window.AdaptiveCards.AdaptiveCard.onProcessMarkdown = (
          text,
          result,
        ) => {
          result.outputHtml = md.render(text);
          result.didProcess = true;
        };
      }, TEAMS_UNSUPPORTED_MARKDOWN);

      for (const { name, card } of cards) {
        const errors = await page.evaluate(
          ({ card, hostConfig }) => {
            const host = document.getElementById("host");
            host.innerHTML = '<div class="wrap" id="w"></div>';
            const ac = new window.AdaptiveCards.AdaptiveCard();
            ac.hostConfig = new window.AdaptiveCards.HostConfig(hostConfig);
            const found = [];
            ac.onParseError = (e) => found.push(String(e));
            ac.parse(card);
            const el = ac.render();
            document.getElementById("w").appendChild(el);
            return found;
          },
          { card, hostConfig: HOST_CONFIG },
        );
        const file = join(outDir, `${name}--${widthName}.png`);
        const el = await page.$("#host");
        await el.screenshot({ path: file });
        results.push({ name, width: widthName, file, errors });
        if (errors.length > 0) {
          console.log(`  ⚠ ${name} @${widthName}: ${errors.join("; ")}`);
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  writeFileSync(
    join(outDir, "index.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(`rendered ${results.length} images -> ${resolve(outDir)}`);
  return results;
}
