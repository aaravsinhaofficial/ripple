import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { DailyTask, DayPlan, Workspace } from '../../src/daily/types';

const DATE = '2030-06-14'; // A Friday; independent of the runner's clock.
const WORKSPACE_KEY = 'ripple-daily-workspace-v1';
const PLAN_KEY = 'ripple-daily-approved-v1';

async function savedWorkspace(page: Page): Promise<Workspace> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), WORKSPACE_KEY);
}

async function savedPlan(page: Page): Promise<DayPlan | null> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}').plan || null, PLAN_KEY);
}

async function setDay(page: Page, end = '13:00') {
  await page.getByRole('button', { name: 'Open preferences', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Day settings', exact: true });
  await dialog.getByLabel('Planning date', { exact: true }).fill(DATE);
  await dialog.getByLabel('Day starts', { exact: true }).fill('09:00');
  await dialog.getByLabel('Day ends', { exact: true }).fill(end);
  await dialog.getByLabel('Plan from', { exact: true }).fill('09:00');
  await dialog.getByText('Work rhythm and timezone', { exact: true }).click();
  await dialog.getByLabel('Break between blocks (minutes)', { exact: true }).fill('0');
  await dialog.getByLabel('Timezone', { exact: true }).fill('America/Chicago');
  await dialog.getByRole('button', { name: 'Save day settings', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function quickTask(page: Page, title: string, minutes = '30') {
  await page.getByLabel('New task', { exact: true }).fill(title);
  await page.getByLabel('Task estimate', { exact: true }).selectOption(minutes);
  await page.getByRole('button', { name: 'Add quick task', exact: true }).click();
  await expect(page.getByRole('button', { name: `Edit ${title}`, exact: true })).toBeVisible();
}

async function taskDetails(page: Page, title: string, minutes: number, advanced?: (dialog: Locator) => Promise<void>) {
  await page.getByRole('button', { name: 'Add task with details', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a task', exact: true });
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog.getByLabel('Time needed (minutes)', { exact: true }).fill(String(minutes));
  if (advanced) {
    await dialog.getByText('More options', { exact: true }).click();
    await advanced(dialog);
  }
  await dialog.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function addMeeting(page: Page, title = 'Team check-in', start = '10:00', end = '10:30') {
  await page.getByRole('button', { name: 'Add fixed commitment', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a fixed commitment', exact: true });
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog.getByLabel('Date', { exact: true }).fill(DATE);
  await dialog.getByLabel('Starts', { exact: true }).fill(start);
  await dialog.getByLabel('Ends', { exact: true }).fill(end);
  await dialog.getByRole('button', { name: 'Add commitment', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function approvePlan(page: Page) {
  await page.getByRole('button', { name: /^(Plan my day|Refresh plan)$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Use this plan', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function downloadedText(page: Page, button: Locator) {
  const pending = page.waitForEvent('download');
  await button.click();
  const download = await pending;
  return { filename: download.suggestedFilename(), text: await readFile((await download.path())!, 'utf8') };
}

function expectAllEffortAccounted(workspace: Workspace, plan: DayPlan) {
  for (const task of workspace.tasks) {
    const planned = plan.blocks.filter(block => block.taskId === task.id).reduce((sum, block) => sum + block.end - block.start, 0);
    const left = plan.overflow.filter(item => item.taskId === task.id).reduce((sum, item) => sum + item.remainingMinutes, 0);
    expect(planned + left, `Every unfinished minute of ${task.title} remains visible`).toBe(task.status === 'done' ? 0 : task.minutes);
  }
  for (const block of plan.blocks.filter(block => block.kind === 'task')) {
    expect(block.start).toBeGreaterThanOrEqual(workspace.settings.planFrom);
    expect(block.end).toBeLessThanOrEqual(workspace.settings.end);
    for (const fixed of workspace.commitments.filter(item => item.date === workspace.settings.date)) {
      expect(block.start >= fixed.end || block.end <= fixed.start, `${block.title} must not overlap ${fixed.title}`).toBe(true);
    }
  }
}

async function expectFits(page: Page, dialog: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const result = await dialog.evaluate(panel => {
    const bounds = panel.getBoundingClientRect();
    return {
      horizontal: panel.scrollWidth <= panel.clientWidth + 1,
      outside: [...panel.querySelectorAll('input, select, textarea, button')]
        .filter(control => control.getClientRects().length)
        .filter(control => { const box = control.getBoundingClientRect(); return box.left < bounds.left - 1 || box.right > bounds.right + 1; })
        .map(control => control.getAttribute('aria-label') || control.id || control.textContent),
    };
  });
  expect(result).toEqual({ horizontal: true, outside: [] });
}

test('a real task list becomes an approved day, then recovers honestly after an interruption', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Make today workable.' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/ripple-daily-empty-desktop.png', fullPage: true, animations: 'disabled' });
  expect((await savedWorkspace(page)).tasks).toHaveLength(0);
  await setDay(page);

  await page.getByRole('button', { name: 'Quick capture', exact: true }).click();
  const capture = page.getByRole('dialog');
  await capture.getByLabel('Task list to capture', { exact: true }).fill(`Write the outline 45m #Client !high due:${DATE}@13:00 ~weekly\nReply to messages 30m\nSort receipts 60m`);
  await capture.getByRole('button', { name: 'Review tasks', exact: true }).click();
  await expect(capture.getByLabel('Minutes for captured task 1', { exact: true })).toHaveValue('45');
  const firstDraft = capture.locator('.d-capture-draft').first();
  for (const detail of ['High priority', 'Project: Client', `Due ${DATE} at 13:00`, 'Repeats weekly', 'Shorter blocks allowed']) {
    await expect(firstDraft.locator('.d-draft-metadata')).toContainText(detail);
  }
  expect((await savedWorkspace(page)).tasks).toHaveLength(0);
  await capture.getByRole('button', { name: 'Add 3 tasks', exact: true }).click();
  await addMeeting(page);
  const before = await savedWorkspace(page);
  expect(before.tasks.map(task => task.title)).toEqual(['Write the outline', 'Reply to messages', 'Sort receipts']);
  expect(before.tasks[0]).toMatchObject({ priority: 'high', project: 'Client', dueDate: DATE, dueTime: 780, recurrence: 'weekly', splittable: true });

  await page.getByRole('button', { name: 'Plan my day', exact: true }).click();
  const preview = page.getByRole('dialog');
  await expect(preview.getByRole('heading', { name: 'Here’s what fits.' })).toBeVisible();
  await expect(preview.locator('.d-preview-blocks')).toContainText('Team check-in');
  expect(await savedWorkspace(page), 'Reviewing a plan cannot alter the workspace').toEqual(before);
  expect(await savedPlan(page)).toBeNull();
  await preview.screenshot({ path: 'artifacts/ripple-daily-preview-desktop.png', animations: 'disabled' });
  await preview.getByRole('button', { name: 'Use this plan', exact: true }).click();
  const originalPlan = (await savedPlan(page))!;
  expect(originalPlan.scheduledMinutes).toBe(135);
  expect(originalPlan.overflow).toHaveLength(0);
  expectAllEffortAccounted(before, originalPlan);
  await page.screenshot({ path: 'artifacts/ripple-daily-workspace-desktop.png', fullPage: true, animations: 'disabled' });

  const prepareRecovery = async () => {
    await page.getByRole('button', { name: 'Day changed?', exact: true }).click();
    const recovery = page.getByRole('dialog');
    await recovery.getByRole('button', { name: /^I lost some time/ }).click();
    await recovery.getByLabel('Unavailable from', { exact: true }).fill('10:00');
    await recovery.getByLabel('Minutes', { exact: true }).fill('150');
    await recovery.getByRole('button', { name: 'Review revised plan', exact: true }).click();
    await expect(page.getByRole('dialog').locator('.d-preview-overflow')).toContainText('Still on your list');
  };
  await prepareRecovery();
  expect(await savedWorkspace(page)).toEqual(before);
  expect(await savedPlan(page)).toEqual(originalPlan);
  await page.getByRole('dialog').getByRole('button', { name: 'Keep my current plan', exact: true }).click();
  expect(await savedWorkspace(page)).toEqual(before);
  await prepareRecovery();
  await page.getByRole('dialog').screenshot({ path: 'artifacts/ripple-daily-recovery-desktop.png', animations: 'disabled' });
  await page.getByRole('dialog').getByRole('button', { name: 'Use this plan', exact: true }).click();
  const recovered = await savedWorkspace(page);
  const recoveredPlan = (await savedPlan(page))!;
  expect(recovered.settings.planFrom).toBe(750);
  expect(recovered.settings.end).toBe(780);
  expect(recovered.tasks).toEqual(before.tasks);
  expect(recovered.tasks.every(task => task.status === 'todo')).toBe(true);
  expect(recovered.commitments).toEqual(before.commitments);
  expect(recoveredPlan.overflow.reduce((sum, item) => sum + item.remainingMinutes, 0)).toBeGreaterThanOrEqual(105);
  expectAllEffortAccounted(recovered, recoveredPlan);

  await page.reload();
  await expect(page.locator('.d-status')).toHaveText('Up to date');
  expect(await savedWorkspace(page)).toEqual(recovered);
  expect(await savedPlan(page)).toEqual(recoveredPlan);
  await page.getByRole('button', { name: 'Export and backup', exact: true }).click();
  const exports = page.getByRole('dialog');
  const text = await downloadedText(page, exports.getByRole('button', { name: /^Download day plan/ }));
  expect(text.filename).toMatch(/\.txt$/);
  for (const value of ['RIPPLE · DAILY PLAN', DATE, 'America/Chicago', 'NOT PLACED', 'Sort receipts', 'Nothing has been sent or synced.']) expect(text.text).toContain(value);
  const calendar = await downloadedText(page, exports.getByRole('button', { name: /^Add to your calendar/ }));
  expect(calendar.filename).toMatch(/\.ics$/);
  expect(calendar.text.match(/BEGIN:VEVENT/g)).toHaveLength(recoveredPlan.blocks.length);
  expect(calendar.text).not.toContain('ATTENDEE:');
  expect(calendar.text).not.toContain('METHOD:REQUEST');
  const backup = await downloadedText(page, exports.getByRole('button', { name: /^Download workspace backup/ }));
  expect(JSON.parse(backup.text)).toEqual(recovered);
  await exports.getByRole('button', { name: /^Close / }).click();

  await page.getByRole('button', { name: 'History & undo', exact: true }).click();
  await page.getByRole('dialog').locator('.d-history-row').filter({ hasText: 'Recover 150 lost minutes' }).getByRole('button', { name: 'Restore', exact: true }).click();
  expect(await savedWorkspace(page)).toEqual(before);
  expect(await savedPlan(page)).toEqual(originalPlan);
  expect(errors).toEqual([]);
});

test('dependency and deadline details stay usable, and only explicit completion unblocks a prerequisite', async ({ page }) => {
  await page.goto('./');
  await setDay(page, '10:00');
  await taskDetails(page, 'Research the brief', 90, async dialog => {
    await dialog.getByLabel('Project (optional)', { exact: true }).fill('Portfolio');
    await dialog.getByRole('checkbox', { name: /^Allow shorter work blocks/ }).uncheck();
  });
  await taskDetails(page, 'Send the proposal', 30, async dialog => {
    await dialog.getByLabel('Priority', { exact: true }).selectOption('high');
    await dialog.getByLabel('Due date (optional)', { exact: true }).fill(DATE);
    await dialog.getByLabel('Due time (optional)', { exact: true }).fill('10:00');
    await dialog.getByRole('checkbox', { name: /^Research the brief/ }).check();
  });
  await page.getByRole('button', { name: 'Edit Research the brief', exact: true }).click();
  let editor = page.getByRole('dialog', { name: 'Edit task', exact: true });
  await expect(editor.getByRole('checkbox', { name: /^Send the proposal/ })).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Delete task', exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: 'Close dialog', exact: true }).click();

  await approvePlan(page);
  let workspace = await savedWorkspace(page);
  let plan = (await savedPlan(page))!;
  const prerequisite = workspace.tasks.find(task => task.title === 'Research the brief')!;
  const dependent = workspace.tasks.find(task => task.title === 'Send the proposal')!;
  expect(plan.blocks.filter(block => block.kind === 'task')).toHaveLength(0);
  expect(plan.overflow.find(item => item.taskId === prerequisite.id)?.code).toBe('capacity');
  expect(plan.overflow.find(item => item.taskId === dependent.id)?.code).toBe('dependency');
  await page.getByRole('button', { name: 'Complete Research the brief', exact: true }).click();
  await expect(page.locator('.d-status')).toContainText('Needs refresh');
  await approvePlan(page);
  workspace = await savedWorkspace(page);
  plan = (await savedPlan(page))!;
  expect(workspace.tasks.find(task => task.id === prerequisite.id)?.status).toBe('done');
  expect(plan.blocks.filter(block => block.taskId === dependent.id).reduce((sum, block) => sum + block.end - block.start, 0)).toBe(30);
  expect(plan.blocks.some(block => block.taskId === prerequisite.id)).toBe(false);
  expectAllEffortAccounted(workspace, plan);

  const before = workspace;
  await page.getByRole('button', { name: 'Edit Send the proposal', exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Edit task', exact: true });
  await editor.getByLabel('Time needed (minutes)', { exact: true }).fill('0');
  await editor.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('1–720 whole minutes');
  expect(await savedWorkspace(page)).toEqual(before);
  await editor.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await editor.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Send the proposal', exact: true })).toBeFocused();
  expect(await savedWorkspace(page)).toEqual(before);
});

test('weekday repeats carry to Monday once, including after reopening and completing again', async ({ page }) => {
  await page.goto('./');
  await setDay(page);
  await taskDetails(page, 'Review the daily inbox', 15, async dialog => {
    await dialog.getByLabel('Repeat', { exact: true }).selectOption('weekdays');
    await dialog.getByLabel('Due date (optional)', { exact: true }).fill(DATE);
  });
  const original = (await savedWorkspace(page)).tasks[0];
  await page.getByRole('button', { name: 'Complete Review the daily inbox', exact: true }).click();
  let tasks = (await savedWorkspace(page)).tasks;
  expect(tasks).toHaveLength(2);
  expect(tasks.find(task => task.id !== original.id)).toMatchObject({ status: 'todo', earliestDate: '2030-06-17', dueDate: '2030-06-17', minutes: 15 });
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen Review the daily inbox', exact: true }).click();
  await page.getByRole('button', { name: /^My day/ }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Complete Review the daily inbox', exact: true }).click();
  tasks = (await savedWorkspace(page)).tasks;
  expect(tasks).toHaveLength(2);
  expect(tasks.filter(task => task.status === 'todo')).toHaveLength(1);
  await page.reload();
  expect((await savedWorkspace(page)).tasks).toEqual(tasks);
});

test('backup restores are checked before replacement, and history can undo the replacement', async ({ page }) => {
  await page.goto('./');
  await setDay(page);
  await quickTask(page, 'A task worth keeping', '45');
  await approvePlan(page);
  const initial = await savedWorkspace(page);
  const initialPlan = await savedPlan(page);
  await page.getByRole('button', { name: 'Export and backup', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type=file]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...initial, tasks: [{ ...initial.tasks[0], minutes: -5 }] })) });
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(await savedWorkspace(page)).toEqual(initial);
  expect(await savedPlan(page)).toEqual(initialPlan);

  const replacement = { ...initial, tasks: [{ ...initial.tasks[0], title: 'Restored from another device', minutes: 60 }] };
  await dialog.locator('input[type=file]').setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replacement)) });
  await expect(dialog).toHaveCount(0);
  expect(await savedWorkspace(page)).toEqual(replacement);
  expect(await savedPlan(page)).toBeNull();
  await expect(page.getByRole('button', { name: 'Edit Restored from another device', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'History & undo', exact: true }).click();
  await page.getByRole('dialog').locator('.d-history-row').filter({ hasText: 'Import backup' }).getByRole('button', { name: 'Restore', exact: true }).click();
  expect(await savedWorkspace(page)).toEqual(initial);
  expect(await savedPlan(page)).toEqual(initialPlan);
});

test('the phone editors fit, expose advanced errors, and protect unsaved work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date('2030-06-14T14:00:00Z') });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Add my first task', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/ripple-daily-empty-mobile.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Add my first task', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Prepare a useful project update');
  await dialog.getByLabel('Time needed (minutes)', { exact: true }).fill('40');
  await expectFits(page, dialog);
  await dialog.screenshot({ path: 'artifacts/ripple-daily-task-editor-mobile.png', animations: 'disabled' });
  await dialog.getByText('More options', { exact: true }).click();
  await dialog.getByLabel('Project (optional)', { exact: true }).fill('A very long project name that should wrap without widening the screen');
  await dialog.getByLabel('Notes (optional)', { exact: true }).fill('Keep it clear. Bring the decision and its reason.');
  await expectFits(page, dialog);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const before = await savedWorkspace(page);

  await page.getByRole('button', { name: 'Open preferences', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByText('Work rhythm and timezone', { exact: true }).click();
  await dialog.getByLabel('Timezone', { exact: true }).fill('Not/A_Timezone');
  await dialog.getByText('Work rhythm and timezone', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Save day settings', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('valid timezone');
  await expect(dialog.getByLabel('Timezone', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Timezone', { exact: true })).toBeFocused();
  expect(await savedWorkspace(page)).toEqual(before);
  await dialog.getByLabel('Timezone', { exact: true }).fill('America/Chicago');
  await expectFits(page, dialog);
  await dialog.screenshot({ path: 'artifacts/ripple-daily-preferences-mobile.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Save day settings', exact: true }).click();

  await page.getByRole('button', { name: 'Add fixed commitment', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('A fixed class');
  await expectFits(page, dialog);
  await dialog.screenshot({ path: 'artifacts/ripple-daily-commitment-mobile.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Add commitment', exact: true }).click();
  await approvePlan(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/ripple-daily-workspace-mobile.png', fullPage: true, animations: 'disabled' });
});

test('unavailable browser storage preserves in-memory planning and a downloadable recovery backup', async ({ page }) => {
  await page.clock.install({ time: new Date('2030-06-14T14:00:00Z') });
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('Storage unavailable', 'QuotaExceededError'); };
  });
  await page.goto('./');
  await quickTask(page, 'Keep this work safe');
  await expect(page.getByRole('alert')).toContainText('Browser storage is unavailable or full');
  await approvePlan(page);
  await expect(page.locator('.d-timeline')).toContainText('Keep this work safe');
  await page.getByRole('button', { name: 'Export and backup', exact: true }).click();
  const result = await downloadedText(page, page.getByRole('dialog').getByRole('button', { name: /^Download workspace backup/ }));
  const backup = JSON.parse(result.text) as Workspace;
  expect(backup.tasks.map((task: DailyTask) => task.title)).toEqual(['Keep this work safe']);
  expect(backup.tasks[0].status).toBe('todo');
});

test('keyboard capture stays inside the editor and a finished focus timer never marks work complete', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.install({ time: new Date('2030-06-14T14:00:00Z') });
  await page.goto('./');
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('n');
  const dialog = page.getByRole('dialog', { name: 'Add a task', exact: true });
  const title = dialog.getByLabel('Title', { exact: true });
  await expect(title).toBeFocused();
  await title.pressSequentially('Plan next steps / notes');
  await expect(title).toHaveValue('Plan next steps / notes');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await dialog.getByLabel('Time needed (minutes)', { exact: true }).fill('1');
  await dialog.screenshot({ path: 'artifacts/ripple-daily-task-editor-desktop.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Add task', exact: true }).click();
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('/');
  await expect(page.getByLabel('Search tasks', { exact: true })).toBeFocused();
  await page.getByLabel('Search tasks', { exact: true }).fill('Plan');
  await expect(page.getByRole('button', { name: 'Edit Plan next steps / notes', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Focus on Plan next steps / notes', exact: true }).click();
  const focus = page.getByRole('region', { name: 'Focus timer', exact: true });
  await focus.getByRole('button', { name: 'Start focus timer', exact: true }).click();
  await page.clock.fastForward(61_000);
  expect((await savedWorkspace(page)).tasks[0].status).toBe('todo');
  await expect(focus).toContainText('00:00');
  await focus.getByRole('button', { name: 'Finish task', exact: true }).click();
  expect((await savedWorkspace(page)).tasks[0].status).toBe('done');
  await expect(focus).toHaveCount(0);
});

test('the real local HTTP assistant returns a reviewable rules draft and keeps its token out of storage', async ({ page, request }) => {
  test.skip(!!process.env.RIPPLE_TEST_BASE_URL, 'A public static site does not include a localhost API.');
  const health = await request.get('http://127.0.0.1:8000/health');
  expect(health.ok()).toBe(true);
  expect((await health.json()).mode, 'Browser QA must never call a paid live service').toBe('demo');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await page.getByRole('button', { name: 'Optional AI assistant', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Ripple service URL', { exact: true }).fill('http://127.0.0.1:8000');
  const token = 'browser-qa-memory-only';
  await dialog.getByLabel('Service access token', { exact: true }).fill(token);
  await dialog.getByRole('button', { name: 'Connect service', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Connected to a rules service');
  await dialog.getByRole('button', { name: /^Close / }).click();
  await page.getByRole('button', { name: 'Quick capture', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task list to capture', { exact: true }).fill('Prepare the brief 25m\nRead the notes 15m');
  const pending = page.waitForRequest(sent => sent.url().endsWith('/api/daily/assist') && sent.method() === 'POST');
  await dialog.getByRole('button', { name: 'Let AI organize it', exact: true }).click();
  const sent = await pending;
  expect(sent.headers().authorization).toBe(`Bearer ${token}`);
  expect(sent.postDataJSON()).toMatchObject({ action: 'capture', useWeb: false });
  await expect(dialog.locator('.d-assist-provenance')).toContainText('Rule-based draft');
  await expect(dialog.getByLabel('Captured task 1', { exact: true })).toHaveValue('Prepare the brief');
  await expect(dialog.getByLabel('Minutes for captured task 1', { exact: true })).toHaveValue('25');
  expect((await savedWorkspace(page)).tasks).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Add 2 tasks', exact: true }).click();
  expect((await savedWorkspace(page)).tasks.map(task => task.minutes)).toEqual([25, 15]);
  const stored = await page.evaluate(() => [...Object.keys(localStorage).map(key => localStorage.getItem(key)), ...Object.keys(sessionStorage).map(key => sessionStorage.getItem(key))].join('\n'));
  expect(stored).not.toContain(token);
  expect(stored).not.toContain('http://127.0.0.1:8000');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Optional AI assistant', exact: true })).toBeVisible();
  expect((await savedWorkspace(page)).tasks).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('unreadable saved data stays recoverable and a forged approved plan is not displayed', async ({ page }) => {
  await page.clock.install({ time: new Date('2030-06-14T14:00:00Z') });
  const broken = '{"version":1,"tasks":[{"title":"An incomplete original task"}]}';
  await page.addInitScript(({ key, raw }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
  }, { key: WORKSPACE_KEY, raw: broken });
  await page.goto('./');
  await expect(page.getByRole('alert')).toContainText('saved workspace could not be read');
  expect(await page.evaluate(key => localStorage.getItem(key), WORKSPACE_KEY)).toBe(broken);
  const original = await downloadedText(page, page.getByRole('button', { name: 'Download original data', exact: true }));
  expect(original.text).toBe(broken);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('saved workspace could not be read');
  expect(await page.evaluate(key => localStorage.getItem(key), WORKSPACE_KEY)).toBe(broken);

  await quickTask(page, 'Start safely with a new task');
  const workspace = await savedWorkspace(page);
  expect(workspace.tasks).toHaveLength(1);
  await expect(page.getByRole('alert')).toContainText('unreadable original is still available');
  expect((await downloadedText(page, page.getByRole('button', { name: 'Download original data', exact: true }))).text).toBe(broken);
  await approvePlan(page);
  const plan = (await savedPlan(page))!;
  await page.evaluate(({ key, workspace, plan }) => {
    localStorage.setItem(key, JSON.stringify({
      signature: JSON.stringify(workspace),
      plan: { ...plan, blocks: [{ id: 'fabricated', kind: 'task', taskId: workspace.tasks[0].id, title: 'An invented unsafe plan', start: -100, end: 2000 }] },
    }));
  }, { key: PLAN_KEY, workspace, plan });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Plan my day', exact: true })).toBeVisible();
  await expect(page.getByText('An invented unsafe plan', { exact: true })).toHaveCount(0);
  expect(await savedPlan(page)).toBeNull();
  expect(await savedWorkspace(page)).toEqual(workspace);
});

test('closing a slow assistant request cancels it without overwriting the next capture draft', async ({ page }) => {
  let release!: () => void;
  const responseGate = new Promise<void>(resolve => { release = resolve; });
  let finished!: () => void;
  const responseFinished = new Promise<void>(resolve => { finished = resolve; });
  await page.route('https://daily-cancel-test.invalid/**', async route => {
    if (route.request().url().endsWith('/health')) {
      await route.fulfill({ json: { status: 'ok', mode: 'live', requiresAuth: false, configured: { nebius: true, tavily: false } } });
      return;
    }
    await responseGate;
    try {
      await route.fulfill({ json: {
        mode: 'live', summary: 'A mocked delayed draft.',
        tasks: [{ title: 'An obsolete suggestion', minutes: 30, priority: 'normal', project: '', notes: '', dueDate: null, dependsOnIndices: [] }],
        steps: [], sources: [], trace: [],
      } });
    } catch { /* The browser has already cancelled this synthetic request. */ }
    finally { finished(); }
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Optional AI assistant', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Ripple service URL', { exact: true }).fill('https://daily-cancel-test.invalid');
  await dialog.getByRole('button', { name: 'Connect service', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Connected to live AI');
  await dialog.getByRole('button', { name: /^Close / }).click();
  await page.getByRole('button', { name: 'Quick capture', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task list to capture', { exact: true }).fill('This draft is no longer needed');
  const pending = page.waitForRequest(sent => sent.url().endsWith('/api/daily/assist'));
  const failed = page.waitForEvent('requestfailed', { predicate: sent => sent.url().endsWith('/api/daily/assist') });
  await dialog.getByRole('button', { name: 'Let AI organize it', exact: true }).click();
  await pending;
  await expect(dialog.getByRole('button', { name: 'Reading…', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: /^Close / }).click();
  await expect(dialog).toHaveCount(0);
  expect((await failed).failure()?.errorText).toMatch(/ABORTED|FAILED/i);
  expect((await savedWorkspace(page)).tasks).toHaveLength(0);

  await page.getByRole('button', { name: 'Quick capture', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task list to capture', { exact: true }).fill('The task I actually want 20m');
  await dialog.getByRole('button', { name: 'Review tasks', exact: true }).click();
  release();
  await responseFinished;
  await expect(dialog.getByLabel('Captured task 1', { exact: true })).toHaveValue('The task I actually want');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Add 1 task', exact: true }).click();
  expect((await savedWorkspace(page)).tasks.map(task => task.title)).toEqual(['The task I actually want']);
});
