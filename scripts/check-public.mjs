// Published daily-workflow smoke check. No live service or paid provider requests.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const url = process.argv[2] ?? "https://aaravsinhaofficial.github.io/ripple/";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto(url, { waitUntil: "networkidle" });
  assert.equal(response.status(), 200);
  await page.getByRole("heading", { name: "Make today workable." }).waitFor();
  const favicon = new URL(
    await page.locator('link[rel="icon"]').getAttribute("href"),
    url,
  );
  assert.equal((await page.request.get(favicon.href)).status(), 200);
  await page.getByRole("button", { name: "Try a sample day" }).click();
  await page.getByRole("button", { name: "Plan my day", exact: true }).click();
  await page.getByRole("button", { name: "Use this plan" }).waitFor();
  assert.equal(
    (await page.locator(".d-preview-blocks > div").count()) > 0,
    true,
  );
  await page.getByRole("button", { name: "Use this plan" }).click();
  await page.getByRole("heading", { name: "Your workable plan" }).waitFor();
  assert.equal((await page.locator(".d-timeline-row.task").count()) > 0, true);
  await page.reload();
  await page.getByRole("heading", { name: "Your workable plan" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.getByRole("button", { name: "Review this day" }).click();
  await page.getByRole("button", { name: "Use this plan" }).waitFor();
  assert.equal(
    await page
      .locator("dialog[open]")
      .evaluate((el) => el.getBoundingClientRect().right <= innerWidth),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    `Published daily MVP passed: HTTP, assets, checked preview, approval, persistence, mobile fit, no runtime errors. ${url}`,
  );
} finally {
  await browser.close();
}
