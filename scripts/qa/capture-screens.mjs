// Drives the Phase 4 QA walk-through and saves screenshots.
//
// Usage (needs `puppeteer-core` and a Chrome install):
//   node capture-screens.mjs <draftRunId> <outDir> [chromePath]
//
// Make a fresh DRAFT run first:  pnpm qa:draft-run   (prints the run id)
// The dev server must be on http://localhost:3000 with the demo data seeded.
import puppeteer from "puppeteer-core";

const [, , runId, outDir, chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"] = process.argv;
if (!runId || !outDir) {
  console.log("usage: node capture-screens.mjs <draftRunId> <outDir> [chromePath]");
  process.exit(1);
}

const BASE = "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const join = (name) => `${outDir.replace(/[\\/]$/, "")}${outDir.includes("\\") ? "\\" : "/"}${name}`;

const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type())) console.log("[console]", m.type(), m.text().slice(0, 200));
});
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 300)));

async function clickByText(selector, text, { exact = false } = {}) {
  const handles = await page.$$(selector);
  for (const handle of handles) {
    const label = (await handle.evaluate((el) => (el.textContent ?? "").trim())) || "";
    const disabled = await handle.evaluate((el) => el.disabled === true);
    const isMatch = exact ? label === text : label.toLowerCase().includes(text.toLowerCase());
    if (isMatch && !disabled) {
      await handle.click();
      return true;
    }
  }
  return false;
}

async function waitForText(text, timeout = 60000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
}

async function shot(name, { full = true } = {}) {
  await sleep(700);
  await page.screenshot({ path: join(name), fullPage: full });
  console.log("saved", name);
}

async function go(path, persona) {
  await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 60000 });
  if (persona) {
    await clickByText("button", persona);
    await sleep(2500);
  }
  await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(1500);
}

/** Click the payee cell of the first grid row whose text contains every part. */
async function clickRow(...parts) {
  const rows = await page.$$(".ag-row");
  for (const row of rows) {
    const content = await row.evaluate((el) => el.textContent ?? "");
    if (parts.every((part) => content.includes(part))) {
      const cell = await row.$("[col-id=payee]");
      await (cell ?? row).click();
      return true;
    }
  }
  return false;
}

/** Decide one flag through the evidence panel buttons, typing the reason into the dialog. */
async function decideWithButton(parts, buttonText, reason) {
  const found = await clickRow(...parts);
  console.log(buttonText, parts.join(" / "), "-> row found:", found);
  await sleep(500);
  await clickByText("section[aria-label=Decision] button", buttonText);
  await sleep(500);
  await page.keyboard.type(reason);
  await page.keyboard.press("Enter");
  await sleep(3500);
}

/** Same thing, but only the keyboard once the row is focused: X opens the exclude dialog. */
async function excludeWithKeyboard(parts, reason) {
  const found = await clickRow(...parts);
  console.log("keyboard exclude", parts.join(" / "), "-> row found:", found);
  await sleep(500);
  await page.keyboard.press("x");
  await sleep(500);
  await page.keyboard.type(reason);
  await page.keyboard.press("Enter");
  await sleep(3500);
}

// --- home + new run -------------------------------------------------------
await go("/", "maya");
await shot("00-home.png");
await go("/runs/new", "maya");
await shot("00-new-run.png");

// --- draft -> planning -> flagged (as Maya) --------------------------------
await go(`/runs/${runId}`, "maya");
await shot("01-draft-maya.png", { full: false });
const didStart = await clickByText("button", "Start planning");
console.log("start planning clicked:", didStart);
await sleep(1200);
await shot("02-planning.png", { full: false });
await waitForText("Decide every flag", 120000);
await shot("03-flagged-maya.png");

// --- evidence for the entity match ----------------------------------------
console.log("entity row clicked:", await clickRow("Possible same person"));
await sleep(800);
await shot("04-evidence-entity-match.png");

console.log("velocity row clicked:", await clickRow("Payout velocity"));
await sleep(1500);
await shot("05-evidence-velocity.png");

// scroll the evidence panel down so the velocity chart is in the shot
await page.evaluate(() => {
  const panel = document.querySelector("aside[aria-label=Evidence] > div:last-child");
  if (panel) panel.scrollTop = panel.scrollHeight;
});
await sleep(800);
await shot("05b-evidence-velocity-chart.png", { full: false });

// --- dispositions from BRIEF section 8 ---------------------------------------
await clickRow("Possible same person", "Jon Doe");
await sleep(500);
await clickByText("section[aria-label=Decision] button", "Exclude line");
await sleep(800);
await shot("06-exclude-dialog.png", { full: false });
await page.keyboard.type("Lookalike of John Doe - not paying twice");
await page.keyboard.press("Enter");
await sleep(4000);
await shot("07-after-exclude-s1.png");

await excludeWithKeyboard(["Destination changed", "Priya Nair"], "Destination swapped two days before the cycle");
await decideWithButton(["Unusual amount", "Carlos Mendes"], "Exclude line", "Fat-finger: 10x the usual amount");
await decideWithButton(["Duplicate in batch", "Aiko Tanaka"], "Exclude line", "Duplicate row");
await decideWithButton(["Shared destination", "Northwind"], "Accept with reason", "Lena owns Northwind - verified");
await decideWithButton(["Shared destination", "Lena Fischer"], "Accept with reason", "Lena owns Northwind - verified");
await decideWithButton(["New payee", "Orbit Labs"], "Accept with reason", "New vendor, contract on file");
await shot("08-blocking-resolved.png");

await clickByText("button", "warnings");
await sleep(600);
// the bulk button is the toolbar one ("Accept N warnings"); the dialog is prefilled, so Enter submits
await page.keyboard.press("Enter");
await sleep(4000);
await shot("09-ready-maya.png");

// --- Daniel: approve, apply stub, revoke -------------------------------------
await clickByText("button", "Daniel");
await sleep(3000);
await page.goto(`${BASE}/runs/${runId}`, { waitUntil: "networkidle2", timeout: 60000 });
await sleep(2000);
await shot("10-ready-daniel.png");

const approveWord = await page.$eval("#approve-confirm", (el) => el.getAttribute("placeholder"));
console.log("approve word:", approveWord);
await page.type("#approve-confirm", approveWord);
await sleep(300);
await clickByText("button", "Approve plan");
await sleep(3500);
await shot("11-approved-daniel.png");

const applyWord = await page.$eval("#apply-confirm", (el) => el.getAttribute("placeholder")).catch(() => null);
if (applyWord) {
  await page.type("#apply-confirm", applyWord);
  await clickByText("button", "Apply to PayPal sandbox");
  await sleep(1500);
  await shot("12-apply-stub.png", { full: false });
}

// --- other pages ------------------------------------------------------------------
await clickByText("button", "Explore with AG Studio");
await sleep(6000);
await shot("13-ag-studio-explore.png");

await page.goto(`${BASE}/runs/${runId}/audit`, { waitUntil: "networkidle2", timeout: 60000 });
await shot("14-audit.png");

await browser.close();
