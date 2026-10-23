import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
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

test('a vault folder deleted outside Lode shows a friendly panel; nothing is recreated unless asked', async () => {
  const { page, vaultRoot } = l;
  await page.getByRole('button', { name: 'New folder', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Scratch');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Scratch' })).toBeVisible();

  await rm(vaultRoot, { recursive: true, force: true });
  // Coming back to the window re-checks the vault on disk.
  await page.evaluate(() => (globalThis as unknown as EventTarget).dispatchEvent(new Event('focus')));
  const panel = page.getByRole('alert').filter({ hasText: "Can't find" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(vaultRoot);
  await expect(page.getByText(/ENOENT/)).toHaveCount(0);
  expect(existsSync(vaultRoot)).toBe(false);
  await expect(page.getByRole('button', { name: 'Scratch', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/missing-vault.png' });

  // Only an explicit choice creates the folder again (empty).
  await panel.getByRole('button', { name: 'Create an empty vault here' }).click();
  await expect(panel).toHaveCount(0);
  expect(existsSync(vaultRoot)).toBe(true);
  await expect(page.getByRole('button', { name: 'Scratch', exact: true })).toHaveCount(0);
});

test('remove a missing vault from the list without touching any files', async () => {
  const { page, vaultRoot } = l;
  await rm(vaultRoot, { recursive: true, force: true });
  await page.evaluate(() => (globalThis as unknown as EventTarget).dispatchEvent(new Event('focus')));
  const panel = page.getByRole('alert').filter({ hasText: "Can't find" });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Remove from list' }).click();
  await page.getByRole('dialog', { name: /from the list\?$/ }).getByRole('button', { name: 'Remove from list' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open or create a vault' }).first()).toBeVisible();
  expect(existsSync(vaultRoot)).toBe(false);
});
