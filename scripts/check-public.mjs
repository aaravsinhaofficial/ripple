// Fresh-browser smoke check for the published, account-free demo.
// Never connects a live service or sends a provider request.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'https://aaravsinhaofficial.github.io/ripple/';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto(url, { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200, 'Published app must return HTTP 200');
  await page.getByRole('heading', { name: 'Keep a good day going.' }).waitFor();
  await page.getByRole('button', { name: 'Demo mode' }).waitFor();
  const favicon = new URL(await page.locator('link[rel="icon"]').getAttribute('href'), url);
  assert.equal((await page.request.get(favicon.href)).status(), 200, 'Favicon must resolve under the repository path');
  await page.getByRole('button', { name: 'A speaker is running late' }).click();
  await page.getByRole('button', { name: 'Find a way forward' }).click();
  await page.getByRole('button', { name: 'Make this the plan' }).waitFor();
  assert.equal(await page.locator('.repair-option').count(), 2);
  await page.getByRole('button', { name: /All \d+ guardrails checked/ }).click();
  assert.equal(await page.locator('.check-row').count(), 11);
  assert.equal(await page.locator('.check-failed').count(), 0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Make this the plan' }).click();
  await page.getByRole('heading', { name: 'That’s the new plan.' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log(`Published demo passed: HTTP, assets, repair, 11 checks, approval, mobile width, no runtime errors. ${url}`);
} finally {
  await browser.close();
}
