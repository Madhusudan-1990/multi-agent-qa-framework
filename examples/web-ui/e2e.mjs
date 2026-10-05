// Manual end-to-end check for the web UI: opens the page, loads the Books
// demo spec, runs the FULL 5-stage pipeline in a real browser, asserts all
// stages complete, and saves a screenshot for README/VALIDATION.
//
//   1. node examples/web-ui/server.js        (in one terminal)
//   2. node examples/web-ui/e2e.mjs          (in another; needs the
//        playwright install from ../playwright-suite)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("../playwright-suite/node_modules/playwright");

const BASE = process.env.UI_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(BASE);
await page.waitForSelector(".card", { timeout: 10000 });
console.log("cards rendered:", await page.locator(".card").count());

// Screenshot-only mode: capture the UI without running any agent
// (SCREENSHOT_ONLY=1 node examples/web-ui/e2e.mjs)
if (process.env.SCREENSHOT_ONLY) {
  await page.click("#loadBooks");
  await page.screenshot({
    path: fileURLToPath(new URL("./demo-screenshot.png", import.meta.url)),
    fullPage: true,
  });
  await browser.close();
  console.log("screenshot saved (idle state)");
  process.exit(0);
}

await page.click("#loadBooks");
console.log("spec chars:", (await page.inputValue("#spec")).length);
await page.click("#runPipeline");
console.log("pipeline started…");

let timedOut = false;
await page
  .waitForFunction(
    () => {
      const s = document.querySelector("#status").textContent;
      if (/pipeline complete/i.test(s)) return true;
      if (/pipeline error|failed:/i.test(s)) return true;
      if (document.querySelector(".card.error")) return true;
      return false;
    },
    null,
    { timeout: 1_800_000 }
  )
  .catch((e) => { timedOut = true; console.error("wait failed:", e.message.split("\n")[0]); });

const result = await page.evaluate(() => ({
  status: document.querySelector("#status").textContent.trim(),
  cards: [...document.querySelectorAll(".card")].map((c) => ({
    title: c.querySelector(".title").textContent,
    cls: c.className,
    pill: c.querySelector(".pill").textContent,
    meta: c.querySelector(".meta").textContent,
    outLen: (c.querySelector("[data-out]").textContent || "").length,
    inputLen: (c.querySelector("[data-in]").value || "").length,
  })),
  coverage: document.querySelector("#covBadge").textContent,
  coverageVisible: getComputedStyle(document.querySelector("#covBadge")).display !== "none",
}));
console.log(JSON.stringify(result, null, 2));

await page.screenshot({
  path: fileURLToPath(new URL("./demo-screenshot.png", import.meta.url)),
  fullPage: true,
});
await browser.close();

const ok =
  !timedOut &&
  /pipeline complete/i.test(result.status) &&
  result.cards.every((c) => /done/.test(c.cls)) &&
  result.cards.every((c) => c.inputLen > 0 && c.outLen > 100) &&
  result.coverageVisible;

console.log(ok ? "E2E PASS" : "E2E FAIL");
process.exit(ok ? 0 : 1);
