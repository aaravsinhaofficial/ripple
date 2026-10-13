import { test, expect } from '@playwright/test';
import { SAMPLE_PLAN } from '../../src/lib/data';

test('repair, inspect, apply, export, and undo a delayed speaker', async ({ page }) => {
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Keep a good day going.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Demo mode' })).toBeVisible();
  await page.screenshot({path:'artifacts/ripple-workspace.png', fullPage:true, animations:'disabled'});
  await page.getByRole('button', { name: 'A speaker is running late' }).click();
  await page.getByRole('button', { name: 'Find a way forward' }).click();
  await expect(page.getByRole('button', { name: 'Make this the plan' })).toBeVisible();
  await expect(page.locator('.repair-option')).toHaveCount(2);
  await expect(page.locator('.timeline-row.changed')).toHaveCount(2);
  await page.screenshot({path:'artifacts/ripple-repair.png', fullPage:true, animations:'disabled'});
  await page.getByRole('button', { name: /All \d+ guardrails checked/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.check-row')).toHaveCount(11);
  await expect(page.locator('.check-failed')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Make this the plan' }).click();
  await expect(page.getByRole('heading', { name: 'That’s the new plan.' })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download the handoff', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toContain('handoff.txt');
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  const contents = await readFile(path!, 'utf8');
  expect(contents).toContain('DEMO MODE');
  expect(contents).toContain('nothing has been sent');
  await page.getByRole('button', { name: /Change log/ }).click();
  await expect(page.locator('.history-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo the latest change' }).click();
  await page.getByRole('button', { name: 'The live plan' }).click();
  await expect(page.locator('.timeline-row.changed')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ripple-plan-v1')!).sessions.find((s: {id:string})=>s.id==='keynote').start)).toBe(570);
});

test('an impossible disruption stays blocked and does not change the event', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Describe the change to your event').fill('Maya is 8 hours late');
  await page.getByRole('button', { name: 'Find a way forward' }).click();
  await expect(page.getByRole('button', { name: 'Adjust the change' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make this the plan' })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ripple-plan-v1')!).sessions.find((s: {id:string})=>s.id==='keynote').start)).toBe(570);
});

test('an imported event and accepted room repair survive reload', async ({ page }) => {
  await page.goto('/');
  const plan = {...SAMPLE_PLAN, id:'custom-event', name:'Our neighborhood makers day'};
  await page.locator('input[type=file]').setInputFiles({ name:'our-event.json', mimeType:'application/json', buffer: Buffer.from(JSON.stringify(plan)) });
  await expect(page.locator('.page-heading')).toContainText(plan.name);
  await page.getByRole('button', { name: 'We lost a room' }).click();
  await page.getByRole('button', { name: 'Find a way forward' }).click();
  await page.getByRole('button', { name: 'Make this the plan' }).click();
  await page.reload();
  await expect(page.locator('.page-heading')).toContainText(plan.name);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ripple-plan-v1')!).sessions.some((s: {roomId:string})=>s.roomId==='studio'))).toBe(false);
});

test('mobile layout fits and the repair flow works', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/ripple-mobile.png', fullPage:true, animations:'disabled'});
  await page.getByRole('button', { name: 'A session needs more time' }).click();
  await page.getByRole('button', { name: 'Find a way forward' }).click();
  await expect(page.getByRole('button', { name:'Make this the plan' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('later room closures preserve earlier activities', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Repair from time; earlier activities stay fixed').fill('13:10');
  await page.getByRole('button', { name:'We lost a room' }).click();
  await page.getByRole('button', { name:'Find a way forward' }).click();
  await expect(page.locator('.timeline-row.changed')).toHaveCount(1);
  await page.getByRole('button', { name:'Make this the plan' }).click();
  const sessions = await page.evaluate(() => JSON.parse(localStorage.getItem('ripple-plan-v1')!).sessions);
  expect(sessions.find((s: {id:string}) => s.id==='workshop').roomId).toBe('studio');
  expect(sessions.find((s: {id:string}) => s.id==='build').roomId).toBe('hall');
});

test('keyboard dialog closes and returns focus', async ({ page }) => {
  await page.goto('/');
  const opener = page.getByRole('button', {name:'Demo mode'});
  await opener.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('the actual local API completes an asynchronous repair with honest demo provenance', async ({ page, request }) => {
  const health = await (await request.get('http://127.0.0.1:8000/health')).json();
  expect(health.mode, 'Integration test requires a demo API; no live credits should be used').toBe('demo');
  await page.goto('/');
  await page.getByRole('button', {name:'Demo mode'}).click();
  await page.getByLabel('Ripple backend URL').fill('http://127.0.0.1:8000');
  await page.getByRole('button', {name:'Check', exact:true}).click();
  await page.getByRole('button', {name:'Use this service'}).click();
  await expect(page.getByRole('button', {name:'Service demo'})).toBeVisible();
  await page.getByRole('button', {name:'A speaker is running late'}).click();
  await page.getByRole('button', {name:'Find a way forward'}).click();
  await expect(page.getByRole('button', {name:'Make this the plan'})).toBeVisible({timeout:15000});
  await expect(page.locator('.demo-disclosure')).toContainText('demo mode');
  await page.getByRole('button', {name:'Make this the plan'}).click();
  await expect(page.getByRole('heading', {name:'That’s the new plan.'})).toBeVisible();
});

test('provider errors stay visible and organizer credentials never enter browser storage', async ({ page }) => {
  let observedAuthorization = '';
  await page.route('https://ripple-test.invalid/**', async route => {
    if (route.request().url().endsWith('/health')) return route.fulfill({json:{status:'ok',mode:'live',requiresAuth:true,configured:{nebius:true,tavily:false}}});
    observedAuthorization = route.request().headers()['authorization'];
    return route.fulfill({status:503,json:{error:{code:'provider_limit',message:'Token Factory credits exhausted. No demo result was substituted.'}}});
  });
  await page.goto('/');
  await page.getByRole('button', {name:'Demo mode'}).click();
  await page.getByLabel('Ripple backend URL').fill('https://ripple-test.invalid');
  await page.getByLabel('Organizer access token').fill('test-only-organizer-token');
  await page.getByRole('button', {name:'Check', exact:true}).click();
  await page.getByRole('button', {name:'Use this service'}).click();
  await page.getByRole('button', {name:'A speaker is running late'}).click();
  await page.getByRole('button', {name:'Find a way forward'}).click();
  await expect(page.getByRole('alert')).toContainText('Token Factory credits exhausted');
  expect(observedAuthorization).toBe('Bearer test-only-organizer-token');
  expect(await page.evaluate(() => JSON.stringify({...localStorage, ...sessionStorage}))).not.toContain('test-only-organizer-token');
  await expect(page.getByRole('button', {name:'Make this the plan'})).toHaveCount(0);
});
