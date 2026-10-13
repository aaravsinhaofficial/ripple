import { test, expect } from "@playwright/test";

test("unavailable browser storage stays visible while repairs and downloads still work", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException(
        "Storage unavailable in this browser",
        "QuotaExceededError",
      );
    };
  });
  await page.goto("./");
  await expect(page.getByRole("alert")).toContainText("could not save");
  await page
    .getByLabel("Choose a change", { exact: true })
    .selectOption("delay");
  await page
    .getByLabel("Activity to change", { exact: true })
    .selectOption("keynote");
  await page.getByLabel("Minutes later").fill("40");
  await page.getByRole("button", { name: "Find a way forward" }).click();
  await page.getByRole("button", { name: "Make this the plan" }).click();
  await expect(
    page.getByRole("heading", { name: "That’s the new plan." }),
  ).toBeVisible();
  const pendingDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download schedule", exact: true })
    .click();
  expect((await pendingDownload).suggestedFilename()).toContain("schedule.txt");
  await expect(page.getByRole("alert")).toContainText(
    "before closing this tab",
  );
  expect(errors).toEqual([]);
});
