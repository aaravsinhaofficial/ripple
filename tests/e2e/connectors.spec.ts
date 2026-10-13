import { test, expect, type Locator, type Page } from '@playwright/test';
import type { DayPlan, Workspace } from '../../src/daily/types';

const DATE = '2030-06-14';
const WORKSPACE_KEY = 'ripple-daily-workspace-v1';
const PLAN_KEY = 'ripple-daily-approved-v1';

async function savedWorkspace(page: Page): Promise<Workspace> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), WORKSPACE_KEY);
}

async function setDay(page: Page) {
  await page.getByRole('button', { name: 'Open preferences', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Day settings', exact: true });
  await dialog.getByLabel('Planning date', { exact: true }).fill(DATE);
  await dialog.getByLabel('Day starts', { exact: true }).fill('09:00');
  await dialog.getByLabel('Day ends', { exact: true }).fill('13:00');
  await dialog.getByLabel('Plan from', { exact: true }).fill('09:00');
  await dialog.getByText('Work rhythm and timezone', { exact: true }).click();
  await dialog.getByLabel('Break between blocks (minutes)', { exact: true }).fill('0');
  await dialog.getByLabel('Timezone', { exact: true }).fill('America/Chicago');
  await dialog.getByRole('button', { name: 'Save day settings', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function openImports(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Connections and imports', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Bring your work into Ripple', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

function calendar(title = 'Planning review', start = '150000', end = '153000') {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ripple browser verification//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:stable-review@example.invalid',
    'DTSTAMP:20300601T120000Z',
    `DTSTART:20300614T${start}Z`,
    `DTEND:20300614T${end}Z`,
    `SUMMARY:${title}`,
    'DESCRIPTION:Review the draft and confirm the handoff.',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:free-reminder@example.invalid',
    'DTSTAMP:20300601T120000Z',
    'DTSTART:20300614T160000Z',
    'DTEND:20300614T163000Z',
    'SUMMARY:Available reminder',
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:cancelled-review@example.invalid',
    'DTSTAMP:20300601T120000Z',
    'DTSTART:20300614T170000Z',
    'DTEND:20300614T173000Z',
    'SUMMARY:Cancelled review',
    'STATUS:CANCELLED',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

async function previewCalendar(page: Page, contents = calendar()) {
  const dialog = await openImports(page);
  await dialog.getByRole('button', { name: 'Calendar file', exact: true }).click();
  await dialog.getByLabel('Choose calendar file', { exact: true }).setInputFiles({
    name: 'review.ics', mimeType: 'text/calendar', buffer: Buffer.from(contents),
  });
  await dialog.getByLabel('From date', { exact: true }).fill(DATE);
  await dialog.getByLabel('Through date', { exact: true }).fill(DATE);
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  return dialog;
}

async function previewPack(page: Page, pack: unknown) {
  const dialog = await openImports(page);
  await dialog.getByRole('button', { name: 'Connector pack', exact: true }).click();
  await dialog.getByLabel('Connector pack JSON', { exact: true }).fill(JSON.stringify(pack));
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  return dialog;
}

async function browserStorage(page: Page): Promise<string> {
  return page.evaluate(() => [localStorage, sessionStorage].flatMap(storage =>
    Object.keys(storage).map(key => `${key}:${storage.getItem(key)}`),
  ).join('\n'));
}

async function connectFixtureService(page: Page, origin: string, accessCode: string) {
  await page.getByRole('button', { name: 'Optional AI assistant', exact: true }).click();
  const service = page.getByRole('dialog');
  await service.getByLabel('Ripple service URL', { exact: true }).fill(origin);
  await service.getByLabel('Access code', { exact: true }).fill(accessCode);
  await service.getByRole('button', { name: 'Connect service', exact: true }).click();
  await expect(service.getByRole('status')).toContainText('Connected to a rules service');
  await service.getByRole('button', { name: /^Close / }).click();
}

test('calendar import is reviewed, survives reload, blocks real planning time and deduplicates a second import', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await setDay(page);
  await page.getByLabel('New task', { exact: true }).fill('Write the launch draft');
  await page.getByLabel('Task estimate', { exact: true }).selectOption('90');
  await page.getByRole('button', { name: 'Add quick task', exact: true }).click();
  const baseline = await savedWorkspace(page);

  const dialog = await previewCalendar(page);
  await expect(dialog.getByRole('checkbox', { name: 'Import Planning review', exact: true })).toBeChecked();
  for (const title of ['Available reminder', 'Cancelled review']) {
    const skipped = dialog.getByRole('checkbox', { name: `Import ${title}`, exact: true });
    await expect(skipped).toBeDisabled();
    await expect(skipped).not.toBeChecked();
  }
  expect(await savedWorkspace(page)).toEqual(baseline);
  await dialog.getByRole('button', { name: 'Add selected items', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const imported = await savedWorkspace(page);
  expect(imported.commitments).toHaveLength(1);
  expect(imported.commitments[0]).toMatchObject({ title: 'Planning review', date: DATE, start: 600, end: 630 });
  expect(imported.tasks).toEqual(baseline.tasks);
  await page.getByRole('button', { name: /^(Plan my day|Refresh plan)$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Use this plan', exact: true }).click();
  const plan: DayPlan = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).plan, PLAN_KEY);
  expect(plan.blocks.filter(block => block.kind === 'commitment')).toEqual([
    expect.objectContaining({ title: 'Planning review', start: 600, end: 630 }),
  ]);
  for (const block of plan.blocks.filter(block => block.kind === 'task')) {
    expect(block.end <= 600 || block.start >= 630, 'Imported busy time must stay protected').toBe(true);
  }
  const placed = plan.blocks.filter(block => block.kind === 'task').reduce((total, block) => total + block.end - block.start, 0);
  expect(placed + plan.overflow.reduce((total, item) => total + item.remainingMinutes, 0)).toBe(90);

  await page.reload();
  expect((await savedWorkspace(page)).commitments).toEqual(imported.commitments);
  const duplicate = await previewCalendar(page);
  await expect(duplicate.getByRole('checkbox', { name: 'Import Planning review', exact: true })).toBeDisabled();
  await expect(duplicate.getByRole('button', { name: 'Add selected items', exact: true })).toBeDisabled();
  expect((await savedWorkspace(page)).commitments).toEqual(imported.commitments);
  await page.keyboard.press('Escape');
  await expect(duplicate).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a changed calendar occurrence stays unselected and cancellation preserves the original appointment', async ({ page }) => {
  await page.goto('./');
  await setDay(page);
  const initial = await previewCalendar(page);
  await initial.getByRole('button', { name: 'Add selected items', exact: true }).click();
  const baseline = await savedWorkspace(page);

  const moved = calendar('Planning review moved', '160000', '163000');
  const preview = await previewCalendar(page, moved);
  const row = preview.getByRole('checkbox', { name: 'Import Planning review moved', exact: true });
  await expect(row).not.toBeChecked();
  await expect(row).toBeEnabled();
  await row.check();
  expect(await savedWorkspace(page)).toEqual(baseline);
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  expect(await savedWorkspace(page)).toEqual(baseline);

  const accepted = await previewCalendar(page, moved);
  await accepted.getByRole('checkbox', { name: 'Import Planning review moved', exact: true }).check();
  await accepted.getByRole('button', { name: 'Add selected items', exact: true }).click();
  const updated = await savedWorkspace(page);
  expect(updated.commitments).toHaveLength(1);
  expect(updated.commitments[0]).toMatchObject({
    id: baseline.commitments[0].id, title: 'Planning review moved', date: DATE, start: 660, end: 690,
  });
});

test('an invalid calendar cannot replace an existing workspace or approved plan', async ({ page }) => {
  await page.goto('./');
  await setDay(page);
  await page.getByLabel('New task', { exact: true }).fill('Keep the saved draft');
  await page.getByRole('button', { name: 'Add quick task', exact: true }).click();
  await page.getByRole('button', { name: 'Plan my day', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Use this plan', exact: true }).click();
  const before = await page.evaluate(keys => keys.map(key => localStorage.getItem(key)), [WORKSPACE_KEY, PLAN_KEY]);

  const dialog = await previewCalendar(page, '{ "this": "is not a calendar" }');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /^Import / })).toHaveCount(0);
  expect(await page.evaluate(keys => keys.map(key => localStorage.getItem(key)), [WORKSPACE_KEY, PLAN_KEY])).toEqual(before);
  await page.keyboard.press('Escape');
  await page.reload();
  expect(await page.evaluate(keys => keys.map(key => localStorage.getItem(key)), [WORKSPACE_KEY, PLAN_KEY])).toEqual(before);
});

test('phone notes import keeps action selection explicit and does not turn ordinary transcript prose into tasks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await setDay(page);
  const baseline = await savedWorkspace(page);
  const dialog = await openImports(page);
  await dialog.getByRole('button', { name: 'Meeting notes', exact: true }).click();
  await dialog.getByLabel('Notes or action items', { exact: true }).fill([
    '# Friday review',
    'Avery explained the experiment. This paragraph is background, not an assignment.',
    '- [ ] Prepare weekly update 45m',
    '- [ ] Check the launch checklist 20m',
    '- [x] Send the previous update 10m',
  ].join('\n'));
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  const included = dialog.getByRole('checkbox', { name: 'Import Prepare weekly update', exact: true });
  const omitted = dialog.getByRole('checkbox', { name: 'Import Check the launch checklist', exact: true });
  await expect(included).toBeChecked();
  await expect(omitted).toBeChecked();
  await omitted.uncheck();
  expect(await savedWorkspace(page)).toEqual(baseline);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await dialog.evaluate(panel => panel.scrollWidth <= panel.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'artifacts/ripple-import-notes-mobile.png', fullPage: true, animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Add selected items', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const result = await savedWorkspace(page);
  expect(result.tasks).toHaveLength(1);
  expect(result.tasks[0]).toMatchObject({ title: 'Prepare weekly update', minutes: 45, status: 'todo', source: { provider: 'notes' } });
  expect(result.commitments).toEqual(baseline.commitments);
  await page.reload();
  expect((await savedWorkspace(page)).tasks).toEqual(result.tasks);
});

test('connector packs validate atomically, preserve completed work on refresh, and can be undone', async ({ page }) => {
  const remoteReads: string[] = [];
  await page.route('https://pack-source.invalid/**', async route => {
    remoteReads.push(route.request().url());
    await route.abort();
  });
  await page.goto('./');
  await setDay(page);
  await page.getByLabel('New task', { exact: true }).fill('Keep my existing work');
  await page.getByRole('button', { name: 'Add quick task', exact: true }).click();
  const baseline = await savedWorkspace(page);
  const pack = {
    version: 1,
    source: { provider: 'json', label: 'Reviewed handoff', namespace: 'browser-qa-handoff' },
    items: [
      { kind: 'task', externalId: 'handoff-task-1', title: 'Prepare the handoff', notes: '<img src="https://pack-source.invalid/pixel" onerror="throw new Error(1)">', minutes: 40, priority: 'high', project: 'Launch', status: 'todo', dueDate: DATE, url: 'https://pack-source.invalid/task/1' },
      { kind: 'commitment', externalId: 'handoff-meeting-1', title: 'Handoff review', notes: 'Confirm the next steps.', date: DATE, start: 660, end: 690 },
    ],
  };
  const invalid = structuredClone(pack);
  invalid.items[0].minutes = -10;
  const rejected = await previewPack(page, invalid);
  await expect(rejected.getByRole('alert')).toBeVisible();
  await expect(rejected.getByRole('checkbox', { name: /^Import / })).toHaveCount(0);
  expect(await savedWorkspace(page)).toEqual(baseline);
  await page.keyboard.press('Escape');

  const reviewed = await previewPack(page, pack);
  await expect(reviewed.getByRole('checkbox', { name: 'Import Prepare the handoff', exact: true })).toBeChecked();
  await expect(reviewed.getByRole('checkbox', { name: 'Import Handoff review', exact: true })).toBeChecked();
  expect(await savedWorkspace(page)).toEqual(baseline);
  await expect(reviewed.locator('img')).toHaveCount(0);
  await expect(reviewed.getByRole('link', { name: 'Open source', exact: true })).toHaveAttribute('href', 'https://pack-source.invalid/task/1');
  await reviewed.getByRole('button', { name: 'Add selected items', exact: true }).click();
  const initial = await savedWorkspace(page);
  expect(initial.tasks).toHaveLength(2);
  expect(initial.commitments).toHaveLength(1);
  const imported = initial.tasks.find(task => task.title === 'Prepare the handoff')!;
  expect(imported).toMatchObject({ minutes: 40, priority: 'high', project: 'Launch', dueDate: DATE });
  await page.getByRole('button', { name: 'Complete Prepare the handoff', exact: true }).click();
  const completed = await savedWorkspace(page);

  const changed = structuredClone(pack);
  changed.items[0].title = 'Prepare the final handoff';
  changed.items[0].minutes = 60;
  const refresh = await previewPack(page, changed);
  const changedRow = refresh.getByRole('checkbox', { name: 'Import Prepare the final handoff', exact: true });
  await expect(changedRow).not.toBeChecked();
  await expect(refresh.getByRole('checkbox', { name: 'Import Handoff review', exact: true })).toBeDisabled();
  expect(await savedWorkspace(page)).toEqual(completed);
  await changedRow.check();
  await refresh.getByRole('button', { name: 'Add selected items', exact: true }).click();
  const result = await savedWorkspace(page);
  expect(result.tasks).toHaveLength(2);
  expect(result.tasks.find(task => task.id === imported.id)).toMatchObject({ title: 'Prepare the final handoff', minutes: 60, status: 'done' });
  expect(result.commitments).toEqual(completed.commitments);
  expect(remoteReads).toEqual([]);

  await page.getByRole('button', { name: 'History & undo', exact: true }).click();
  await page.getByRole('dialog').locator('.d-history-row').filter({ hasText: 'Import connected work' }).first().getByRole('button', { name: 'Restore', exact: true }).click();
  expect(await savedWorkspace(page)).toEqual(completed);
  await page.reload();
  expect(await savedWorkspace(page)).toEqual(completed);
});

test('task spreadsheets require a title mapping and preserve quoted notes, estimates and deadlines', async ({ page }) => {
  await page.goto('./');
  await setDay(page);
  const baseline = await savedWorkspace(page);
  const dialog = await openImports(page);
  await dialog.getByRole('button', { name: 'Task spreadsheet', exact: true }).click();
  await dialog.getByLabel('Choose task spreadsheet', { exact: true }).setInputFiles({
    name: 'team-tasks.csv', mimeType: 'text/csv', buffer: Buffer.from([
      'Work item,Effort,Due,Priority,Project,State,ID,Notes',
      '"Prepare launch, final draft",1h 15m,2030-06-14,High,Launch,To do,task-101,"Check notes,\nthen confirm."',
      'Cancelled admin,20,2030-06-14,Low,Admin,Cancelled,task-102,No longer needed.',
      'Unclear estimate,soon,2030-06-14,Normal,Launch,To do,task-103,Ask for an estimate.',
    ].join('\r\n')),
  });
  await expect(dialog.getByRole('combobox', { name: 'Task title column', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Review import', exact: true })).toBeDisabled();
  await dialog.getByRole('combobox', { name: 'Task title column', exact: true }).selectOption('Work item');
  await dialog.getByRole('combobox', { name: 'Minutes column', exact: true }).selectOption('Effort');
  await dialog.getByRole('combobox', { name: 'Status column', exact: true }).selectOption('State');
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Import Prepare launch, final draft', exact: true })).toBeChecked();
  for (const title of ['Cancelled admin', 'Unclear estimate']) {
    await expect(dialog.getByRole('checkbox', { name: `Import ${title}`, exact: true })).toBeDisabled();
  }
  expect(await savedWorkspace(page)).toEqual(baseline);
  await dialog.getByRole('button', { name: 'Add selected items', exact: true }).click();
  const imported = await savedWorkspace(page);
  expect(imported.tasks).toHaveLength(1);
  expect(imported.tasks[0]).toMatchObject({ title: 'Prepare launch, final draft', minutes: 75, priority: 'high', project: 'Launch', dueDate: DATE, notes: 'Check notes,\nthen confirm.', source: { provider: 'csv', externalId: 'task-101' } });
  await page.reload();
  expect((await savedWorkspace(page)).tasks).toEqual(imported.tasks);
});

test('Google Calendar uses a temporary read grant, follows empty result pages, and reviews busy time before import', async ({ page }) => {
  const token = 'browser-fixture-google-token-memory-only';
  const calls: { path: string; authorization?: string; query: Record<string, string> }[] = [];
  await page.route('https://accounts.google.com/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.google={accounts:{oauth2:{initTokenClient(config){return{requestAccessToken(){setTimeout(()=>config.callback({access_token:${JSON.stringify(token)},expires_in:3600,scope:config.scope}),0)}}},revoke(token,callback){callback({successful:true})}}}};`,
  }));
  await page.route('https://www.googleapis.com/**', async route => {
    const request = route.request(), url = new URL(request.url());
    calls.push({ path: url.pathname, authorization: request.headers().authorization, query: Object.fromEntries(url.searchParams) });
    if (url.pathname.endsWith('/calendarList')) {
      await route.fulfill({ json: { items: [{ id: 'fixture-calendar@example.invalid', summary: 'QA calendar', primary: true }] } });
    } else if (url.pathname.endsWith('/events') && !url.searchParams.has('pageToken')) {
      await route.fulfill({ json: { items: [], nextPageToken: 'fixture-second-page' } });
    } else if (url.pathname.endsWith('/events') && url.searchParams.get('pageToken') === 'fixture-second-page') {
      await route.fulfill({ json: { items: [
        { id: 'fixture-review', summary: 'Google planning review', start: { dateTime: '2030-06-14T15:00:00Z' }, end: { dateTime: '2030-06-14T15:30:59Z' }, htmlLink: 'https://calendar.google.com/calendar/event?eid=synthetic' },
        { id: 'fixture-all-day', summary: 'Optional all-day reminder', start: { date: DATE }, end: { date: '2030-06-15' } },
        { id: 'fixture-declined', summary: 'Declined invitation', start: { dateTime: '2030-06-14T17:00:00Z' }, end: { dateTime: '2030-06-14T17:30:00Z' }, attendees: [{ self: true, responseStatus: 'declined' }] },
      ] } });
    } else await route.abort();
  });
  await page.goto('./');
  await setDay(page);
  const baseline = await savedWorkspace(page);
  const dialog = await openImports(page);
  await dialog.getByRole('button', { name: 'Google Calendar', exact: true }).click();
  await dialog.getByText('Use your own client ID', { exact: true }).click();
  await dialog.getByLabel('Google OAuth client ID', { exact: true }).fill('browser-qa.apps.googleusercontent.com');
  expect(calls).toEqual([]);
  await dialog.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(dialog.getByText('Read access connected for this tab', { exact: false })).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Calendar', exact: true }).selectOption('fixture-calendar@example.invalid');
  await dialog.getByLabel('From date', { exact: true }).fill(DATE);
  await dialog.getByLabel('Through date', { exact: true }).fill(DATE);
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Import Google planning review', exact: true })).toBeChecked();
  for (const title of ['Optional all-day reminder', 'Declined invitation']) {
    await expect(dialog.getByRole('checkbox', { name: `Import ${title}`, exact: true })).toBeDisabled();
  }
  expect(await savedWorkspace(page)).toEqual(baseline);
  expect(calls).toHaveLength(3);
  expect(calls.every(call => call.authorization === `Bearer ${token}`)).toBe(true);
  expect(calls[1].query).toMatchObject({ singleEvents: 'true', timeMin: '2030-06-14T05:00:00.000Z', timeMax: '2030-06-15T05:00:00.000Z', timeZone: 'America/Chicago' });
  await dialog.getByRole('button', { name: 'Add selected items', exact: true }).click();
  const imported = await savedWorkspace(page);
  expect(imported.commitments).toHaveLength(1);
  expect(imported.commitments[0]).toMatchObject({ title: 'Google planning review', date: DATE, start: 600, end: 631, source: { provider: 'google-calendar' } });
  expect(await browserStorage(page)).not.toContain(token);
  await page.reload();
  expect((await savedWorkspace(page)).commitments).toEqual(imported.commitments);
  const reopened = await openImports(page);
  await reopened.getByRole('button', { name: 'Google Calendar', exact: true }).click();
  await expect(reopened.getByText('Read access connected for this tab', { exact: false })).toHaveCount(0);
  expect(calls).toHaveLength(3);
});

test('MCP authorization checks popup origin and source, isolates session headers, and imports only approved action items', async ({ page, context }) => {
  const origin = 'https://connector-fixture.invalid';
  const accessCode = 'browser-fixture-private-service-access';
  const sessionToken = 'browser-fixture-separate-connector-session-token';
  const flowId = 'browser-fixture-oauth-flow-identifier-123456789';
  const completionToken = 'browser-fixture-one-time-completion-token-123456789';
  const documentId = 'fixture-note-one';
  let connected = false, finishes = 0;
  const requests: { path: string; authorization?: string; session?: string; body: string | null }[] = [];
  await context.route('https://mcp.notion.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture authorization</title><p>Synthetic provider sign-in fixture.</p>' }));
  await context.route(`${origin}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/oauth/notion/callback')) {
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Fixture callback</title><p>Fixture completion code</p><code>${completionToken}</code><script>if(window.opener)window.opener.postMessage(${JSON.stringify({ type: 'ripple-connector-complete', provider: 'notion', flowId, completionToken })}, ${JSON.stringify(new URL(page.url()).origin)});</script>` });
      return;
    }
    requests.push({ path, authorization: request.headers().authorization, session: request.headers()['x-ripple-connector-session'], body: request.postData() });
    if (path === '/health') await route.fulfill({ json: { status: 'ok', mode: 'demo', requiresAuth: true, configured: { nebius: false, tavily: false } } });
    else if (path === '/api/session') await route.fulfill({ json: { status: 'ok', mode: 'demo' } });
    else if (path === '/api/connectors/session') await route.fulfill({ json: { sessionToken, expiresAt: new Date(Date.now() + 3600000).toISOString() } });
    else if (path === '/api/connectors') await route.fulfill({ json: { providers: [{ id: 'notion', label: 'Notion', configured: true, connected, authMode: 'oauth', detail: 'Synthetic read-only connector fixture.' }] } });
    else if (path === '/api/connectors/notion/connect') await route.fulfill({ json: { connected: false, authorizationUrl: `https://mcp.notion.com/authorize?state=${flowId}`, flowId, expiresAt: new Date(Date.now() + 600000).toISOString() } });
    else if (path === '/api/connectors/notion/finish') {
      expect(request.postDataJSON()).toEqual({ flowId, completionToken });
      finishes += 1; connected = true;
      await route.fulfill({ json: { connected: true } });
    } else if (path === '/api/connectors/notion/search') await route.fulfill({ json: { provider: 'notion', documents: [{ id: documentId, title: 'Launch follow-ups', url: 'https://www.notion.so/fixture-note-one', excerpt: 'Selected source note.' }], warnings: [] } });
    else if (path === '/api/connectors/notion/read') {
      expect(request.postDataJSON()).toEqual({ id: documentId });
      await route.fulfill({ json: { provider: 'notion', document: { id: documentId, title: 'Launch follow-ups', url: 'https://www.notion.so/fixture-note-one', text: '# Notes\nThe team discussed three possible approaches.\n- [ ] Draft launch follow-up 25m\n- [x] Archive the old outline 10m' }, warnings: [] } });
    } else await route.abort();
  });
  await page.goto('./');
  await setDay(page);
  await page.getByLabel('New task', { exact: true }).fill('Private local task must not be sent');
  await page.getByRole('button', { name: 'Add quick task', exact: true }).click();
  await connectFixtureService(page, origin, accessCode);
  const baseline = await savedWorkspace(page);
  const dialog = await openImports(page);
  await dialog.getByRole('button', { name: 'Notion', exact: true }).click();
  await dialog.getByRole('button', { name: 'Check connection', exact: true }).click();
  await expect(dialog.getByText('Ready to connect', { exact: true })).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: 'Connect Notion', exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForURL('https://mcp.notion.com/**');
  await expect(dialog.getByRole('button', { name: 'Finish connection', exact: true })).toBeVisible();
  const payload = { type: 'ripple-connector-complete', provider: 'notion', flowId, completionToken };
  // A forged message from the parent has the wrong WindowProxy even with a matching origin.
  await page.evaluate(({ origin, payload }) => {
    window.dispatchEvent(new MessageEvent('message', { origin, source: window, data: payload }));
  }, { origin, payload });
  // The genuine popup is still on the provider origin, so its premature message must also fail.
  await popup.evaluate(payload => window.opener.postMessage(payload, '*'), payload);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(finishes).toBe(0);
  // Navigate as the authorization provider would; CDP page.goto() severs the popup opener.
  await popup.evaluate(url => { window.location.href = url; }, `${origin}/api/connectors/oauth/notion/callback?code=synthetic-fixture-code`);
  await popup.waitForURL(`${origin}/api/connectors/oauth/notion/callback?code=synthetic-fixture-code`).catch(error => {
    if (!popup.isClosed()) throw error;
  });
  await expect(dialog.getByText('Connected for this tab', { exact: true })).toBeVisible();
  expect(finishes).toBe(1);
  await dialog.getByLabel('Search your notes', { exact: true }).fill('Launch');
  await dialog.getByRole('button', { name: 'Find notes', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review action items', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Import Draft launch follow-up', exact: true })).toBeChecked();
  expect(await savedWorkspace(page)).toEqual(baseline);
  await dialog.getByRole('button', { name: 'Add selected items', exact: true }).click();
  const result = await savedWorkspace(page);
  expect(result.tasks).toHaveLength(2);
  expect(result.tasks.find(task => task.title === 'Draft launch follow-up')).toMatchObject({ minutes: 25, status: 'todo', source: { provider: 'notion', namespace: documentId, url: 'https://www.notion.so/fixture-note-one' } });
  expect(requests.filter(request => request.path.startsWith('/api/')).every(request => request.authorization === `Bearer ${accessCode}`)).toBe(true);
  expect(requests.filter(request => request.path.startsWith('/api/connectors') && request.path !== '/api/connectors/session').every(request => request.session === sessionToken)).toBe(true);
  expect(requests.every(request => !request.body?.includes('Private local task must not be sent'))).toBe(true);
  const stored = await browserStorage(page);
  for (const secret of [accessCode, sessionToken, completionToken]) expect(stored).not.toContain(secret);
  const requestCount = requests.length;
  await page.reload();
  expect((await savedWorkspace(page)).tasks).toEqual(result.tasks);
  const reopened = await openImports(page);
  await reopened.getByRole('button', { name: 'Notion', exact: true }).click();
  await expect(reopened.getByRole('button', { name: 'Connect Ripple service', exact: true })).toBeVisible();
  expect(requests).toHaveLength(requestCount);
});

test('canceling sign-in during completion clears the pending grant and a late response cannot reconnect it', async ({ page, context }) => {
  const origin = 'https://connector-cancel-fixture.invalid';
  const accessCode = 'browser-cancel-fixture-access-code';
  const sessionToken = 'browser-cancel-fixture-session-token';
  const flowId = 'browser-cancel-fixture-flow-identifier-123456789';
  const completionToken = 'browser-cancel-fixture-completion-token-123456789';
  let disconnected = 0;
  let releaseFinish!: () => void;
  const finishGate = new Promise<void>(resolve => { releaseFinish = resolve; });
  await context.route('https://mcp.notion.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture authorization</title><p>Fixture sign-in</p>' }));
  await context.route(`${origin}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/health') await route.fulfill({ json: { status: 'ok', mode: 'demo', requiresAuth: true, configured: { nebius: false, tavily: false } } });
    else if (path === '/api/session') await route.fulfill({ json: { status: 'ok', mode: 'demo' } });
    else if (path === '/api/connectors/session') await route.fulfill({ json: { sessionToken, expiresAt: new Date(Date.now() + 3600000).toISOString() } });
    else if (path === '/api/connectors') await route.fulfill({ json: { providers: [{ id: 'notion', label: 'Notion', configured: true, connected: false, authMode: 'oauth', detail: 'Synthetic cancellation fixture.' }] } });
    else if (path === '/api/connectors/notion/connect') await route.fulfill({ json: { connected: false, authorizationUrl: `https://mcp.notion.com/authorize?state=${flowId}`, flowId } });
    else if (path === '/api/connectors/notion/finish') {
      await finishGate;
      // Even a late successful transport response cannot restore a canceled UI operation.
      await route.fulfill({ json: { connected: true } }).catch(() => {});
    } else if (path === '/api/connectors/notion/disconnect') {
      expect(route.request().headers()['x-ripple-connector-session']).toBe(sessionToken);
      disconnected += 1;
      await route.fulfill({ json: { connected: false } });
    } else await route.abort();
  });
  await page.goto('./');
  await setDay(page);
  await connectFixtureService(page, origin, accessCode);
  const baseline = await savedWorkspace(page);
  const dialog = await openImports(page);
  await dialog.getByRole('button', { name: 'Notion', exact: true }).click();
  await dialog.getByRole('button', { name: 'Check connection', exact: true }).click();
  const popupPromise = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: 'Connect Notion', exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForURL('https://mcp.notion.com/**');
  await dialog.getByLabel('Connection completion code', { exact: true }).fill(completionToken);
  const finishingRequest = page.waitForRequest(request => request.url() === `${origin}/api/connectors/notion/finish`);
  await dialog.getByRole('button', { name: 'Finish connection', exact: true }).click();
  await finishingRequest;
  await dialog.getByRole('button', { name: 'Cancel sign-in', exact: true }).click();
  await expect.poll(() => disconnected).toBe(1);
  releaseFinish();
  await expect(dialog.getByRole('button', { name: 'Connect Notion', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Finish connection', exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Connected for this tab', { exact: true })).toHaveCount(0);
  expect(popup.isClosed()).toBe(true);
  expect(await savedWorkspace(page)).toEqual(baseline);
  expect(await browserStorage(page)).not.toContain(sessionToken);
});
