import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { removeDir } from '../helpers';
import { launch, type Launched } from './launch';

let l: Launched;
test.beforeEach(async () => {
  l = await launch();
});
test.afterEach(async () => {
  await l.app.close();
  await removeDir(l.vaultRoot);
  await removeDir(l.userData);
});

test('create folder, add points, see them in the backlog and on disk', async () => {
  const { page, vaultRoot } = l;
  await expect(page).toHaveTitle('Lode - Mine what you learn');
  await page.getByRole('button', { name: 'New folder', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Kubernetes');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { level: 1, name: 'Kubernetes' })).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Add a point to Kubernetes' });
  await expect(input).toBeFocused();

  await input.fill('ClusterIP services are only reachable inside the cluster');
  await page.keyboard.press('Enter');
  await expect(input).toHaveText('');
  await input.fill('kube-proxy in IPVS mode scales better than iptables');
  await page.keyboard.press('Enter');

  const backlog = page.getByLabel('Backlog', { exact: true });
  await expect(backlog.getByRole('heading', { name: 'Today' })).toBeVisible();
  const rows = backlog.getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('kube-proxy in IPVS mode');
  await expect(rows.first()).toContainText('unfiled');

  const files = await readdir(join(vaultRoot, 'kubernetes', 'backlog'));
  expect(files).toHaveLength(1);
  const content = await readFile(join(vaultRoot, 'kubernetes', 'backlog', files[0]!), 'utf8');
  expect(content).toMatch(/^- ClusterIP services are only reachable inside the cluster \^p-[0-9a-z]{8}$/m);
  expect(content).toMatch(/^- kube-proxy in IPVS mode scales better than iptables \^p-[0-9a-z]{8}$/m);
});

test('Ctrl = zooms in, Ctrl - zooms out, Ctrl 0 resets, and the level is saved', async () => {
  const { app, userData } = l;
  const zoom = (): Promise<number> =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomLevel());
  // Real input events (Playwright's synthetic keys skip Electron's before-input-event). They only
  // reach a focused window, and CI's display has no window manager, so focus it explicitly.
  const press = (keyCode: string): Promise<void> =>
    app.evaluate(({ BrowserWindow }, k) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.focus();
      const wc = win.webContents;
      wc.focus();
      wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: ['control'] });
      wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: ['control'] });
    }, keyCode);
  await press('=');
  await expect.poll(zoom).toBe(0.5);
  await press('=');
  await expect.poll(zoom).toBe(1);
  await press('-');
  await expect.poll(zoom).toBe(0.5);
  await expect
    .poll(async () => (JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { zoomLevel: number }).zoomLevel)
    .toBe(0.5);
  await press('0');
  await expect.poll(zoom).toBe(0);
});

test('renderer is sandboxed with no node access', async () => {
  const { page } = l;
  const probe = await page.evaluate(() => ({
    require: typeof (globalThis as { require?: unknown }).require,
    process: typeof (globalThis as { process?: unknown }).process,
    api: Object.keys((globalThis as unknown as { lode: object }).lode).sort(),
  }));
  expect(probe.require).toBe('undefined');
  expect(probe.process).toBe('undefined');
  expect(probe.api).not.toContain('invoke');
});

test('backfill a point to an earlier day with the composer date picker', async () => {
  const { page, vaultRoot } = l;
  await page.getByRole('button', { name: 'New folder', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Postgres');
  await page.keyboard.press('Enter');
  const input = page.getByRole('textbox', { name: 'Add a point to Postgres' });
  await expect(input).toBeFocused();

  const d = new Date();
  d.setDate(d.getDate() - 3);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const past = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  await page.getByLabel('Entry date').fill(past);
  await expect(page.getByRole('button', { name: 'Reset date to today' })).toBeVisible();
  await expect(page.getByText(/New points go to/)).toBeVisible();

  // Sticky: two points in a row land on the picked day.
  for (const t of ['VACUUM reclaims dead tuples', 'HOT updates avoid index writes']) {
    await input.fill(t);
    await page.keyboard.press('Enter');
    await expect(input).toHaveText('');
  }
  const backlog = page.getByLabel('Backlog', { exact: true });
  await expect(backlog.getByRole('heading', { name: /Today/ })).toHaveCount(0);
  await expect(backlog.getByRole('listitem')).toHaveCount(2);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/composer-date.png', clip: { x: 248, y: 0, width: 400, height: 330 } });
  expect(await readdir(join(vaultRoot, 'postgres', 'backlog'))).toEqual([`${past}.md`]);

  // The date chip opens the themed calendar; future days are disabled and Escape closes it.
  // Found by its title: the visible date text depends on the machine's locale.
  await page.getByTitle('Choose the day this point belongs to').click();
  const cal = page.getByRole('dialog', { name: 'Choose a day' });
  await expect(cal).toBeVisible();
  await expect(cal.getByRole('gridcell', { selected: true })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(cal).toHaveCount(0);

  // Reset returns to today.
  await page.getByRole('button', { name: 'Reset date to today' }).click();
  await input.fill('Today again');
  await page.keyboard.press('Enter');
  await expect(backlog.getByRole('heading', { name: /Today/ })).toBeVisible();
  expect((await readdir(join(vaultRoot, 'postgres', 'backlog'))).sort()).toHaveLength(2);
});

test('sidebar and backlog panes resize by drag and keyboard, and remember their width', async () => {
  const { page } = l;
  await page.getByRole('button', { name: 'New folder', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Kubernetes');
  await page.keyboard.press('Enter');
  // Measure only once the folder has rendered, so the layout is settled.
  await expect(page.getByRole('heading', { level: 1, name: 'Kubernetes' })).toBeVisible();
  const sidebar = page.getByRole('navigation', { name: 'Vaults and folders' });
  const backlog = page.getByRole('main', { name: 'Scratchpad and backlog' });
  const width = async (loc: typeof sidebar): Promise<number> => (await loc.boundingBox())?.width ?? 0;
  const before = await width(sidebar);

  // Drag the sidebar's edge 80px to the right. Retried as a whole: right after launch the
  // first synthetic drag is occasionally dropped under a loaded suite.
  const handle = page.getByRole('separator', { name: 'Resize sidebar' });
  await expect(async () => {
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + 200, { steps: 5 });
    await page.mouse.up();
    expect(await width(sidebar)).toBeGreaterThan(before + 70);
  }).toPass({ timeout: 10_000 });

  // Keyboard: arrows resize the backlog pane, Home resets it.
  const list = page.getByRole('separator', { name: 'Resize backlog' });
  const listBefore = await width(backlog);
  await list.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => width(backlog)).toBeLessThan(listBefore - 20);
  await page.keyboard.press('Home');
  await expect.poll(() => width(backlog)).toBeCloseTo(listBefore, -1);

  // Double-click resets the sidebar; widths survive a reload.
  await handle.dblclick();
  await expect.poll(() => width(sidebar)).toBeCloseTo(before, -1);
  await list.focus();
  await page.keyboard.press('ArrowRight');
  const kept = await width(backlog);
  await page.reload();
  await expect.poll(() => width(page.getByRole('main', { name: 'Scratchpad and backlog' }))).toBeCloseTo(kept, -1);
});
