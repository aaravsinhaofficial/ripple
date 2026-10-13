import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { EventPlan } from '../../src/lib/types';

const EVENT_NAME = 'Neighborhood Skills Exchange';
const EVENT_DATE = '2026-11-14';
const VENUE = 'Civic Studio';
const ROOM = 'Garden room';
const OWNER = 'Jordan Lee';

async function savedPlan(page: Page): Promise<EventPlan> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('ripple-plan-v1')!));
}

async function expectEditorToFit(page: Page, dialog: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const layout = await dialog.evaluate(panel => {
    const bounds = panel.getBoundingClientRect();
    const overflow = Array.from(panel.querySelectorAll('input, select, textarea, button'))
      .filter(control => control.getClientRects().length > 0)
      .map(control => ({ label: control.getAttribute('aria-label') || control.textContent || control.tagName, bounds: control.getBoundingClientRect() }))
      .filter(control => control.bounds.left < bounds.left - 1 || control.bounds.right > bounds.right + 1)
      .map(control => control.label);
    return { scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth, overflow };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(layout.overflow, 'Every visible editor control should fit inside the dialog').toEqual([]);
}

async function createCustomEvent(page: Page, checkMobileLayout = false) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Create event', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Make the day your own.' })).toBeVisible();
  await expect(dialog.getByLabel('Event name', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Event name', { exact: true }).fill(EVENT_NAME);
  await dialog.getByLabel('Date', { exact: true }).fill(EVENT_DATE);
  await dialog.getByLabel('Venue', { exact: true }).fill(VENUE);
  await dialog.getByLabel('Time zone', { exact: true }).fill('America/Chicago');
  await dialog.getByLabel('Day starts', { exact: true }).fill('09:00');
  await dialog.getByLabel('Day ends', { exact: true }).fill('12:00');
  await dialog.getByLabel('Main space', { exact: true }).fill(ROOM);
  await dialog.getByLabel('Capacity', { exact: true }).fill('30');
  if (checkMobileLayout) await expectEditorToFit(page, dialog);
  await dialog.screenshot({ path: `artifacts/ripple-editor-details-${checkMobileLayout ? 'mobile' : 'desktop'}.png`, animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Build the agenda', exact: true }).click();

  const first = dialog.getByRole('group', { name: 'Activity 1', exact: true });
  await first.getByLabel('Title', { exact: true }).fill('Opening circle');
  await first.getByLabel('Start time', { exact: true }).fill('09:10');
  await first.getByLabel('Duration (minutes)', { exact: true }).fill('30');
  await first.getByLabel('Owner', { exact: true }).fill(OWNER);
  await first.getByLabel('Space', { exact: true }).fill(ROOM);
  await first.getByLabel('Attendees', { exact: true }).fill('20');
  await dialog.getByRole('button', { name: /^Add activity\b/ }).click();

  const second = dialog.getByRole('group', { name: 'Activity 2', exact: true });
  await second.getByLabel('Title', { exact: true }).fill('Closing circle');
  await second.getByLabel('Start time', { exact: true }).fill('10:00');
  await second.getByLabel('Duration (minutes)', { exact: true }).fill('30');
  await second.getByLabel('Owner', { exact: true }).fill(OWNER);
  await second.getByLabel('Space', { exact: true }).fill(ROOM);
  await second.getByLabel('Attendees', { exact: true }).fill('20');
  if (checkMobileLayout) await expectEditorToFit(page, dialog);
  await dialog.screenshot({ path: `artifacts/ripple-editor-agenda-${checkMobileLayout ? 'mobile' : 'desktop'}.png`, animations: 'disabled' });

  await dialog.getByRole('button', { name: 'Save event', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.page-heading')).toContainText(EVENT_NAME);
  await expect.poll(async () => (await savedPlan(page)).name).toBe(EVENT_NAME);
}

test('a blank custom event can be repaired by exact activity, handed off, and reopened', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await createCustomEvent(page);
  const before = await savedPlan(page);
  expect(before.sessions).toHaveLength(2);
  const opening = before.sessions.find(session => session.title === 'Opening circle')!;
  const closing = before.sessions.find(session => session.title === 'Closing circle')!;
  expect(opening.ownerId).toBe(closing.ownerId);
  expect(before.people.find(person => person.id === closing.ownerId)?.name).toBe(OWNER);

  await page.getByLabel('Choose a change', { exact: true }).selectOption('delay');
  await page.getByLabel('Activity to change', { exact: true }).selectOption(closing.id);
  await page.getByLabel('Minutes later', { exact: true }).fill('20');
  await page.screenshot({ path: 'artifacts/ripple-guided-custom-workspace.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Find a way forward', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Make this the plan', exact: true })).toBeVisible();
  expect(await savedPlan(page), 'A preview must not modify the saved event').toEqual(before);
  await page.getByRole('button', { name: 'Make this the plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'That’s the new plan.' })).toBeVisible();

  const approved = await savedPlan(page);
  expect(approved.sessions.find(session => session.id === opening.id)).toEqual(opening);
  expect(approved.sessions.find(session => session.id === closing.id)?.start).toBe(620);
  expect(approved.sessions.find(session => session.id === closing.id)?.duration).toBe(30);
  await expect(page.locator('.handoff-card')).toHaveCount(1);
  for (const context of [EVENT_NAME, EVENT_DATE, VENUE, 'America/Chicago', 'Closing circle']) {
    await expect(page.locator('.handoff-card')).toContainText(context);
  }

  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download the handoff', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toContain('handoff.txt');
  const contents = await readFile((await download.path())!, 'utf8');
  for (const context of ['APPROVED LOCALLY', 'RULE-BASED PLAN', EVENT_NAME, EVENT_DATE, VENUE, 'America/Chicago', 'Closing circle', '10:20 am', 'nothing has been sent']) {
    expect(contents).toContain(context);
  }
  expect(contents).not.toContain('Fieldnotes');
  expect(contents).not.toContain('undefined');

  await page.reload();
  await expect(page.locator('.page-heading')).toContainText(EVENT_NAME);
  expect(await savedPlan(page)).toEqual(approved);

  const scheduleDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download schedule', exact: true }).click();
  const schedule = await readFile((await (await scheduleDownload).path())!, 'utf8');
  expect(schedule).toContain('CURRENT RUN OF SHOW');
  expect(schedule).toContain('10:20 am');
  expect(schedule).toContain(EVENT_NAME);

  const calendarDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Add to calendar', exact: true }).click();
  const calendarFile = await calendarDownload;
  expect(calendarFile.suggestedFilename()).toMatch(/\.ics$/);
  const calendar = await readFile((await calendarFile.path())!, 'utf8');
  expect(calendar.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  expect(calendar).toContain('SUMMARY:Closing circle');
  expect(calendar).toContain('DTSTART:20261114T162000Z');
  expect(calendar).not.toContain('ATTENDEE:');

  await page.getByRole('button', { name: /Change log/ }).click();
  await expect(page.locator('.history-card')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.workspace-picker').click();
  await page.getByRole('dialog').getByRole('button', { name: /Fieldnotes Community Day/ }).click();
  await expect(page.locator('.page-heading')).toContainText('Fieldnotes Community Day');
  await page.locator('.workspace-picker').click();
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(EVENT_NAME) }).click();
  await expect(page.locator('.page-heading')).toContainText(EVENT_NAME);
  expect(await savedPlan(page)).toEqual(approved);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: /Change log/ }).click();
  await expect(page.locator('.history-card')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('an invalid edit explains the conflict and cannot replace the saved event', async ({ page }) => {
  await createCustomEvent(page);
  const before = await savedPlan(page);
  await page.getByRole('button', { name: 'Edit event', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Agenda$/ }).click();
  await dialog.getByRole('group', { name: 'Activity 2', exact: true }).getByLabel('Start time', { exact: true }).fill('09:20');
  await dialog.getByRole('button', { name: 'Save event', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText(/Opening circle|Closing circle/);
  expect(await savedPlan(page)).toEqual(before);
  await dialog.getByRole('button', { name: 'Close event editor', exact: true }).click();
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.page-heading')).toContainText(EVENT_NAME);
  expect(await savedPlan(page)).toEqual(before);
});

test('both steps of the native editor fit a phone and can save a real event', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createCustomEvent(page, true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await savedPlan(page)).sessions.map(session => session.title)).toEqual(['Opening circle', 'Closing circle']);
});

test('an ongoing extension protects fixed lunch and accepts a smaller feasible change', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Repair from time; earlier activities stay fixed').fill('09:40');
  const before = await savedPlan(page);
  const keynote = before.sessions.find(session => session.id === 'keynote')!;
  await page.getByLabel('Choose a change', { exact: true }).selectOption('duration');
  await page.getByLabel('Activity to change', { exact: true }).selectOption('keynote');
  await page.getByLabel('Extra minutes', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Find a way forward', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Adjust the change', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make this the plan', exact: true })).toHaveCount(0);
  await expect(page.locator('.blocker-box')).toContainText(/fixed/i);
  expect(await savedPlan(page), 'An infeasible extension must not move fixed lunch or save any other changes').toEqual(before);

  await page.getByRole('button', { name: 'Adjust the change', exact: true }).click();
  await page.getByLabel('Choose a change', { exact: true }).selectOption('duration');
  await page.getByLabel('Activity to change', { exact: true }).selectOption('keynote');
  await page.getByLabel('Extra minutes', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Find a way forward', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Make this the plan', exact: true })).toBeVisible();
  expect(await savedPlan(page)).toEqual(before);
  await page.getByRole('button', { name: 'Make this the plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'That’s the new plan.' })).toBeVisible();
  const after = await savedPlan(page);
  expect(after.sessions.find(session => session.id === 'keynote')).toEqual({ ...keynote, duration: 50 });
  for (const earlier of before.sessions.filter(session => session.start < 580 && session.id !== 'keynote')) {
    expect(after.sessions.find(session => session.id === earlier.id)).toEqual(earlier);
  }
  expect(after.sessions.find(session => session.id === 'lunch')?.start).toBe(740);
});
