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
  await page.getByRole('button', { name: 'New folder', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Kubernetes');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { level: 1, name: 'Kubernetes' })).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Add a point to Kubernetes' });
  await expect(input).toBeFocused();

  await input.fill('ClusterIP services are only reachable inside the cluster');
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('');
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
    await expect(input).toHaveValue('');
  }
  const backlog = page.getByLabel('Backlog', { exact: true });
  await expect(backlog.getByRole('heading', { name: /Today/ })).toHaveCount(0);
  await expect(backlog.getByRole('listitem')).toHaveCount(2);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/composer-date.png', clip: { x: 248, y: 0, width: 400, height: 330 } });
  expect(await readdir(join(vaultRoot, 'postgres', 'backlog'))).toEqual([`${past}.md`]);

  // Reset returns to today.
  await page.getByRole('button', { name: 'Reset date to today' }).click();
  await input.fill('Today again');
  await page.keyboard.press('Enter');
  await expect(backlog.getByRole('heading', { name: /Today/ })).toBeVisible();
  expect((await readdir(join(vaultRoot, 'postgres', 'backlog'))).sort()).toHaveLength(2);
});
