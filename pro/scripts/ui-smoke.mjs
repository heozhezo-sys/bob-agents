#!/usr/bin/env node
/**
 * Browser smoke test for the CUTROOM UI using the locally installed Edge.
 * Covers sign-in, project creation, a real upload from the file picker,
 * timeline selection/seeking, inline rename, persistence, source deletion and
 * the mobile drawer layout.
 *
 * Requires the Vite dev server on http://127.0.0.1:5180 and the API on 4320.
 * Run: node scripts/ui-smoke.mjs
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.UI_BASE ?? "http://127.0.0.1:5180";
const API = process.env.API_BASE ?? "http://127.0.0.1:4320";
const PASSWORD = process.env.APP_PASSWORD ?? "cutroom-dev";
const ROOT = path.resolve(import.meta.dirname, "..");
const SHOTS = path.join(ROOT, "test-results", "ui");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const IGNORED_ERRORS = [/status of 401/i, /\/api\/auth\/me/i];

function attachDiagnostics(page, sink) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (IGNORED_ERRORS.some((pattern) => pattern.test(text))) return;
    sink.push(`console: ${text}`);
  });
  page.on("pageerror", (error) => sink.push(`pageerror: ${error.message}`));
}

async function login(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="password"]').waitFor({ timeout: 15_000 });
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.getByRole("heading", { name: /edit bay, at a glance/i }).waitFor({
    timeout: 15_000,
  });
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const errors = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      baseURL: BASE,
    });
    const page = await context.newPage();
  page.on("console", (msg) => console.log(`[browser ${msg.type()}] ${msg.text()}`));
  page.on("request", (req) => {
    if (req.url().includes("/clips")) console.log(`[request] ${req.method()} ${req.url()}`);
  });
  page.on("response", (res) => {
    if (res.url().includes("/clips")) console.log(`[response] ${res.status()} ${res.url()}`);
  });
    attachDiagnostics(page, errors);

    console.log("Desktop flow");
    await login(page);
    await page.screenshot({ path: path.join(SHOTS, "dashboard.png") });

    const name = `UI upload ${new Date().toISOString().slice(0, 19)}`;
    await page.getByRole("button", { name: "New project" }).first().click();
    const dialog = page.locator("dialog[open]");
    await dialog.waitFor({ timeout: 5000 });
    await dialog.locator("input.input").first().fill(name);
    await dialog.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const projectId = page.url().split("/").pop();
    console.log(`Created ${projectId}`);
    await page.locator(".media-panel").waitFor({ timeout: 15_000 });

    const uploadResponses = [];
    page.on("response", (response) => {
      if (response.request().method() === "POST" && /\/assets$/.test(response.url())) {
        uploadResponses.push(response.status());
      }
    });

    await page.locator('input[type="file"]').setInputFiles([
      path.join(ROOT, "test-fixtures", "fixture-b.mp4"),
      path.join(ROOT, "test-fixtures", "frame.png"),
    ]);
    await page.locator(".clip").nth(1).waitFor({ timeout: 90_000 });
    check("two uploads returned 201", uploadResponses.length === 2 && uploadResponses.every((status) => status === 201), JSON.stringify(uploadResponses));
    check("two sources listed", (await page.locator(".asset-row").count()) === 2);
    check("two clips drawn", (await page.locator(".clip").count()) === 2);

    const totalText = await page.locator(".timeline-toolbar-left").innerText();
    check("timeline total is 9 seconds", /0:09/.test(totalText), totalText.replace(/\n/g, " "));

    await page.screenshot({ path: path.join(SHOTS, "editor-desktop.png") });

    await page.locator(".clip").first().click();
    await page.locator(".inspector").getByText("Timeline clip", { exact: true }).waitFor({
      timeout: 5000,
    });
    check("clip selection opens clip details", true);
    check("preview switches to the clip video", (await page.locator(".video-frame video").count()) === 1);

    const media = await page.evaluate(async () => {
      const video = document.querySelector(".video-frame video");
      if (!video) return { error: "no video element" };
      if (video.readyState < 1) {
        await new Promise((resolve) => {
          video.addEventListener("loadedmetadata", resolve, { once: true });
          window.setTimeout(resolve, 5000);
        });
      }
      video.currentTime = Math.min(1, Number.isFinite(video.duration) ? video.duration / 2 : 1);
      await new Promise((resolve) => {
        video.addEventListener("seeked", resolve, { once: true });
        window.setTimeout(resolve, 3000);
      });
      return {
        duration: video.duration,
        currentTime: video.currentTime,
        readyState: video.readyState,
        error: video.error ? video.error.code : null,
      };
    });
    check("browser decodes the uploaded MP4", !media.error && media.duration > 3.5, JSON.stringify(media));

    await page.locator(".ruler").scrollIntoViewIfNeeded();
    const rulerBox = await page.locator(".ruler").boundingBox();
    if (rulerBox) {
      await page.mouse.click(rulerBox.x + 64, rulerBox.y + rulerBox.height / 2);
      await page.waitForTimeout(500);
      const timecode = await page.locator(".preview-tc").innerText();
      check("clicking the ruler moves the playhead", timecode.startsWith("00:00:01"), timecode);
    } else {
      check("ruler is measurable", false);
    }

    await page.locator(".editor-title-input").fill(`${name} renamed`);
    await page.locator(".editor-title-input").press("Enter");
    await page.locator(".save-state", { hasText: "saved" }).waitFor({ timeout: 10_000 });
    check("inline rename saves", true);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".media-panel").waitFor({ timeout: 15_000 });
    const titleValue = await page.locator(".editor-title-input").inputValue();
    check("rename persists after reload", titleValue === `${name} renamed`, titleValue);
    check("clips persist after reload", (await page.locator(".clip").count()) === 2);

    await page
      .locator(".asset-row", { hasText: "frame.png" })
      .locator(".asset-delete")
      .click();
    const deleteDialog = page.locator("dialog[open]");
    await deleteDialog.getByRole("button", { name: "Delete source" }).click();
    await page.locator(".clip").nth(0).waitFor({ timeout: 15_000 });
    await page.waitForFunction(() => document.querySelectorAll(".clip").length === 1, null, {
      timeout: 15_000,
    });
    check("deleting a source removes its clip", (await page.locator(".asset-row").count()) === 1);
    check("deleted still leaves the video clip", (await page.locator(".clip").count()) === 1);

    console.log("Timeline editing");
    const waitForClipPatch = () =>
      page.waitForResponse(
        (response) =>
          /\/api\/projects\/[0-9a-f-]+\/clips\/[0-9a-f-]+$/.test(response.url()) &&
          response.request().method() === "PATCH",
        { timeout: 15_000 },
      );
    const waitForClipCount = (count) =>
      page.waitForFunction(
        (expected) => document.querySelectorAll(".clip").length === expected,
        count,
        { timeout: 15_000 },
      );

    const clip = page.locator(".clip").first();
    await clip.scrollIntoViewIfNeeded();
    const clipBox = await clip.boundingBox();
    console.log("CLIPBOX", JSON.stringify(clipBox));
    if (!clipBox) throw new Error("Clip is not measurable");
    const clipResponse = waitForClipPatch();
    await page.mouse.move(clipBox.x + clipBox.width / 2, clipBox.y + clipBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await page.mouse.move(
      clipBox.x + clipBox.width / 2 + 64,
      clipBox.y + clipBox.height / 2,
      { steps: 6 },
    );
    await page.mouse.up();
    const movedResponse = await clipResponse;
    check("dragging a clip persists a new start", movedResponse.status() === 200, String(movedResponse.status()));
    await page.waitForFunction(
      () => document.querySelector(".clip")?.style.left === "64px",
      null,
      { timeout: 10_000 },
    );
    check("dragged clip is drawn one second later", true);

    await clip.click();
    const trimHandle = page.locator(".clip.selected .clip-trim-end");
    await trimHandle.scrollIntoViewIfNeeded();
    const trimBox = await trimHandle.boundingBox();
    if (!trimBox) throw new Error("Trim handle is not measurable");
    const trimResponse = waitForClipPatch();
    await page.mouse.move(trimBox.x + 3, trimBox.y + trimBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(trimBox.x + 3 - 64, trimBox.y + trimBox.height / 2, { steps: 6 });
    await page.mouse.up();
    const trimmedResponse = await trimResponse;
    check("dragging the trim handle persists a new length", trimmedResponse.status() === 200, String(trimmedResponse.status()));
    await page.locator(".clip.selected").click();
    const lengthValue = await page.locator('.clip-field input[aria-label="Clip length in seconds"]').inputValue();
    check("trimmed clip is three seconds long", lengthValue === "3.00", lengthValue);

    await page.locator(".ruler").scrollIntoViewIfNeeded();
    const ruler = await page.locator(".ruler").boundingBox();
    if (!ruler) throw new Error("Ruler is not measurable");
    await page.mouse.click(ruler.x + 2.5 * 64, ruler.y + ruler.height / 2);
    await page.waitForTimeout(300);
    await page.keyboard.press("s");
    await waitForClipCount(2);
    check("pressing S splits the selected clip", (await page.locator(".clip").count()) === 2);
    check("split selects the new right-hand clip", await page.locator(".clip.selected").count() === 1);

    await page.keyboard.press("Delete");
    await waitForClipCount(1);
    check("pressing Delete removes the selected clip", (await page.locator(".clip").count()) === 1);

    const addButton = page.getByRole("button", { name: "Add to timeline" });
    await addButton.waitFor({ timeout: 10_000 });
    const addResponse = page.waitForResponse(
      (response) =>
        /\/api\/projects\/[0-9a-f-]+\/clips$/.test(response.url()) &&
        response.request().method() === "POST",
      { timeout: 15_000 },
    );
    await addButton.click();
    check("adding the source back returns 201", (await addResponse).status() === 201);
    await waitForClipCount(2);

    await page.locator(".clip.selected").waitFor({ timeout: 5000 });
    const startInput = page.locator('.clip-field input[aria-label="Clip start in seconds"]');
    await startInput.fill("7");
    const numericPatch = waitForClipPatch();
    await startInput.press("Enter");
    check("editing the start field persists", (await numericPatch).status() === 200);
    await page.waitForFunction(
      () =>
        document.querySelector('.clip-field input[aria-label="Clip start in seconds"]')
          ?.value === "7.00",
      null,
      { timeout: 10_000 },
    );
    check("start field shows seven seconds", true);

  console.log("Export");
  await page.getByRole("button", { name: "Export" }).click();
  const startExport = page.getByRole("button", { name: "Start export" });
  await startExport.waitFor({ timeout: 10_000 });
  await startExport.click();
  const downloadLink = page.getByRole("link", { name: "Download MP4" });
  await downloadLink.waitFor({ timeout: 180_000 });
  check("export produces a downloadable MP4", (await downloadLink.count()) === 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

    console.log("\nMobile flow");
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      deviceScaleFactor: 2,
      baseURL: BASE,
    });
    const mobilePage = await mobile.newPage();
    attachDiagnostics(mobilePage, errors);
    await login(mobilePage);
    await mobilePage.goto(`${BASE}/projects/${projectId}`, { waitUntil: "domcontentloaded" });
    await mobilePage.locator(".timeline").waitFor({ timeout: 15_000 });
    await mobilePage.screenshot({ path: path.join(SHOTS, "editor-mobile.png") });

    const mediaToggle = mobilePage.locator(".editor-header").getByRole("button", { name: "Media" });
    await mediaToggle.click();
    await mobilePage.locator(".media-drawer.drawer-open").waitFor({ timeout: 5000 });
    check("mobile media drawer opens", true);
    await mobilePage.screenshot({ path: path.join(SHOTS, "editor-mobile-media.png") });
    await mobilePage.keyboard.press("Escape");

    const inspectToggle = mobilePage.locator(".editor-header").getByRole("button", { name: "Inspect" });
    await inspectToggle.click();
    await mobilePage.locator(".inspector-drawer.drawer-open").waitFor({ timeout: 5000 });
    check("mobile inspector drawer opens", true);
    await mobilePage.screenshot({ path: path.join(SHOTS, "editor-mobile-inspector.png") });

    const overflow = await mobilePage.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    check("no horizontal page overflow on mobile", overflow <= 1, `${overflow}px`);

    await mobile.close();

    const health = await fetch(`${API}/api/health`).then((response) => response.json());
    check("API health is green", health.ok === true && health.ffmpeg === true, JSON.stringify(health));

    check("no unexpected browser errors", errors.length === 0, errors.join(" | "));
  } finally {
    await browser.close();
  }

  console.log(`\nScreenshots: ${SHOTS}`);
  if (failures > 0) {
    console.error(`${failures} UI check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("All UI checks passed.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
