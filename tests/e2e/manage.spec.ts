import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { hashBacklogs, removeDir } from '../helpers';
import { startFakes, type Fakes } from './fakeServers';
import { launch, type Launched } from './launch';

let l: Launched;
let fakes: Fakes;

test.beforeEach(async () => {
  fakes = await startFakes();
  l = await launch(
    { LODE_TAVILY_URL: fakes.tavilyUrl },
    { llm: { baseUrl: fakes.llmBase, model: 'fake-model' }, allowWeakKeyStorage: true },
  );
  // Native confirm() prompts (move to trash) are accepted.
  l.page.on('dialog', (d) => void d.accept());
});
test.afterEach(async () => {
  await l.app.close();
  await fakes.close();
  await removeDir(l.vaultRoot);
  await removeDir(l.userData);
});

async function saveKeys(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('LLM API key API key').fill('sk-e2e-fake-key');
  await page.getByRole('group', { name: 'LLM API key' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved to secure storage')).toBeVisible();
  await page.getByLabel('Tavily search key API key').fill('tvly-e2e-fake');
  await page.getByRole('group', { name: 'Tavily search key' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('group', { name: 'Tavily search key' }).getByText('Saved to secure storage')).toBeVisible();
  await page.getByRole('button', { name: 'Close settings' }).click();
}

test('duplicates, point edit/delete, background generate, breadcrumb history, regenerate + undo, trash', async () => {
  const { page, vaultRoot } = l;
  await saveKeys(page);

  await page.getByRole('button', { name: 'New folder', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Kubernetes');
  await page.keyboard.press('Enter');
  const input = page.getByRole('textbox', { name: 'Add a point to Kubernetes' });
  const backlog = page.getByLabel('Backlog', { exact: true });
  const rows = backlog.getByRole('listitem');
  for (const t of ['ClusterIP services are only reachable inside the cluster', 'kube-proxy IPVS mode scales better']) {
    await input.fill(t);
    await page.keyboard.press('Enter');
    await expect(input).toHaveText('');
  }
  await expect(rows).toHaveCount(2);

  // --- Duplicates: an exact repeat is refused; a near repeat asks first.
  await input.fill('clusterip services are only reachable INSIDE the cluster.');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Already in your backlog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add anyway' })).toHaveCount(0);
  await expect(rows).toHaveCount(2);
  await input.fill('ClusterIP services are reachable only inside the cluster network');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Looks like an earlier point')).toBeVisible();
  await page.getByRole('button', { name: 'Add anyway' }).click();
  await expect(rows).toHaveCount(3);
  await expect(input).toHaveText('');

  // --- Edit a point in place: same ID, new text on disk.
  const dayFile = join(vaultRoot, 'kubernetes', 'backlog', (await readdir(join(vaultRoot, 'kubernetes', 'backlog')))[0]!);
  const ipvs = rows.filter({ hasText: 'kube-proxy IPVS mode' });
  const idBefore = (await readFile(dayFile, 'utf8')).match(/kube-proxy IPVS mode scales better \^(p-[0-9a-z]{8})/)?.[1];
  await ipvs.getByRole('button', { name: 'Point actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'Edit point' }).fill('kube-proxy in IPVS mode scales better with many Services');
  await page.keyboard.press('Enter');
  await expect(backlog.getByText('kube-proxy in IPVS mode scales better with many Services')).toBeVisible();
  expect(await readFile(dayFile, 'utf8')).toContain(`kube-proxy in IPVS mode scales better with many Services ^${idBefore}`);

  // --- Disable (soft delete) and restore; a disabled point can also be deleted permanently.
  const near = rows.filter({ hasText: 'cluster network' });
  await near.getByRole('button', { name: 'Point actions' }).click();
  await expect(page.getByRole('menuitem', { name: /Delete permanently/ })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Disable' }).click();
  await expect(near.getByText('disabled')).toBeVisible();
  expect(await readFile(dayFile, 'utf8')).toMatch(/deleted:\s*\n?\s*-?\s*\[?p-/);
  await near.getByRole('button', { name: 'Point actions' }).click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(near.getByText('disabled')).toHaveCount(0);

  await input.fill('A throwaway note to delete');
  await page.keyboard.press('Enter');
  const temp = rows.filter({ hasText: 'A throwaway note to delete' });
  await temp.getByRole('button', { name: 'Point actions' }).click();
  await page.getByRole('menuitem', { name: 'Disable' }).click();
  await temp.getByRole('button', { name: 'Point actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete permanently…' }).click();
  await page.getByRole('alertdialog', { name: 'Delete this point permanently?' }).getByRole('button', { name: 'Delete permanently' }).click();
  await expect(temp).toHaveCount(0);
  await expect(rows).toHaveCount(3);
  expect(await readFile(dayFile, 'utf8')).not.toContain('A throwaway note to delete');

  // --- Generate runs in the background; the composer stays usable meanwhile.
  const before = await hashBacklogs(vaultRoot);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(input).toBeEnabled();
  const bar = page.getByRole('region', { name: 'Background jobs' });
  await expect(bar.getByText(/Filed 3/)).toBeVisible();
  await bar.getByRole('button', { name: 'Dismiss Generate · Kubernetes' }).click();
  await expect(bar).toHaveCount(0);
  expect(await hashBacklogs(vaultRoot)).toEqual(before);

  // --- Breadcrumb and back/forward.
  await backlog.getByRole('button', { name: 'Service networking & kube-proxy' }).first().click();
  const noteHeading = page.getByRole('heading', { level: 2, name: 'Service networking & kube-proxy' });
  await expect(noteHeading).toBeVisible();
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'Kubernetes' }).click();
  await expect(page.getByRole('heading', { name: 'Subtopics' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(noteHeading).toBeVisible();
  await page.getByRole('button', { name: 'Forward' }).click();
  await expect(page.getByRole('heading', { name: 'Subtopics' })).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(noteHeading).toBeVisible();

  // --- Regenerate: all of the note's points are sent again; AI text is replaced; undo restores it.
  const notePath = join(vaultRoot, 'kubernetes', 'notes', 'service-networking.md');
  const original = await readFile(notePath, 'utf8');
  await page.getByRole('button', { name: 'Note actions' }).click();
  await page.getByRole('menuitem', { name: 'Rewrite from points…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(bar.getByText('Rewritten')).toBeVisible();
  const note = page.getByRole('region', { name: 'Service networking & kube-proxy' });
  await expect(note.getByText('Rewritten: Services load-balance across ready pods.')).toBeVisible();
  await expect(note.getByRole('article', { name: /Your point from/ })).toHaveCount(3);
  expect(await readdir(join(vaultRoot, '.lode', 'history', 'kubernetes', 'service-networking'))).toHaveLength(1);
  expect(await hashBacklogs(vaultRoot)).toEqual(before);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/regenerate-statusbar-dark.png' });

  await page.getByRole('button', { name: 'Note actions' }).click();
  await page.getByRole('menuitem', { name: 'Undo rewrite' }).click();
  await expect(note.getByText('Rewritten:')).toHaveCount(0);
  expect(await readFile(notePath, 'utf8')).toBe(original);

  // --- Move the note to trash: its points become unfiled; restore it from Trash.
  await page.getByRole('button', { name: 'Note actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await page.getByRole('alertdialog', { name: /to the trash\?$/ }).getByRole('button', { name: 'Move to trash' }).click();
  await expect(noteHeading).toHaveCount(0);
  await expect(backlog.getByText('unfiled')).toHaveCount(3);
  await page.getByRole('button', { name: /^Trash, 1 item/ }).click();
  const trash = page.getByRole('list', { name: 'Deleted items' });
  await expect(trash.getByText('Note in Kubernetes')).toBeVisible();
  await page.screenshot({ path: 'test-results/trash-dark.png' });
  await trash.getByRole('button', { name: 'Restore Service networking & kube-proxy' }).click();
  await expect(page.getByText('Trash is empty')).toBeVisible();
  await page.getByRole('button', { name: 'Close trash' }).click();
  await expect(backlog.getByText('unfiled')).toHaveCount(0);

  // --- Delete the folder, then restore it.
  await page.getByRole('button', { name: 'Actions for Kubernetes' }).click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await page.getByRole('alertdialog', { name: 'Move "Kubernetes" to the trash?' }).getByRole('button', { name: 'Move to trash' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kubernetes' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Trash, 1 item/ }).click();
  await trash.getByRole('button', { name: 'Restore Kubernetes' }).click();
  await page.getByRole('button', { name: 'Close trash' }).click();
  await page.getByRole('button', { name: 'Kubernetes', exact: true }).click();
  await expect(rows).toHaveCount(3);
  expect(await hashBacklogs(vaultRoot)).toEqual(before);
});
