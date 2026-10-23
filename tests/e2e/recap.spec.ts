import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { hashBacklogs, removeDir } from '../helpers';
import { startFakes, type Fakes } from './fakeServers';
import { launch, type Launched } from './launch';

let l: Launched;
let fakes: Fakes;

const day = (offset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** A folder with a point from a week ago, one from yesterday, and a note filing the first. */
async function seed(root: string): Promise<void> {
  await mkdir(join(root, 'kubernetes', 'backlog'), { recursive: true });
  await mkdir(join(root, 'kubernetes', 'notes'), { recursive: true });
  await writeFile(join(root, 'kubernetes', 'folder.json'), JSON.stringify({ title: 'Kubernetes', createdAt: '2026-01-01T00:00:00.000Z' }));
  await writeFile(
    join(root, 'kubernetes', 'backlog', `${day(7)}.md`),
    `---\ndate: ${day(7)}\ndeleted: []\n---\n- ClusterIP services are only reachable inside the cluster ^p-aaaaaaaa\n`,
  );
  await writeFile(
    join(root, 'kubernetes', 'backlog', `${day(1)}.md`),
    `---\ndate: ${day(1)}\ndeleted: []\n---\n- NodePort opens a port on every node ^p-bbbbbbbb\n`,
  );
  await writeFile(
    join(root, 'kubernetes', 'notes', 'services.md'),
    `---\nfolder: kubernetes\nsubtopic: services\ntitle: Services\nupdated: 2026-01-01T00:00:00.000Z\n---\n` +
      `{{point:p-aaaaaaaa}}\n\n::llm{id=b-00000001 model="m" at="2026-01-01T00:00:00.000Z"}\nkube-proxy programs iptables rules for each Service.\n::\n`,
  );
}

test.beforeEach(async () => {
  fakes = await startFakes();
  l = await launch(
    { LODE_TAVILY_URL: fakes.tavilyUrl },
    { llm: { baseUrl: fakes.llmBase, model: 'fake-model' }, allowWeakKeyStorage: true },
    seed,
  );
});
test.afterEach(async () => {
  await l.app.close();
  await fakes.close();
  await removeDir(l.vaultRoot);
  await removeDir(l.userData);
});

test('review, search, Only mine and a weekly digest', async () => {
  const { page, vaultRoot } = l;
  const before = await hashBacklogs(vaultRoot);

  // --- Review: both points are due (a week ago, yesterday).
  const review = page.getByRole('button', { name: /^Review/ });
  await expect(review.getByLabel('2 due')).toBeVisible();
  await review.click();
  await expect(page.getByRole('heading', { name: /About a week ago/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /In the last few days/ })).toBeVisible();
  const card = page.getByRole('article').filter({ hasText: 'NodePort opens a port' });
  await card.getByRole('button', { name: 'Reviewed' }).click();
  await expect(card).toHaveCount(0);
  await expect(review.getByLabel('1 due')).toBeVisible();
  const marks = JSON.parse(await readFile(join(vaultRoot, '.lode', 'review.json'), 'utf8')) as { reviewed: Record<string, unknown> };
  expect(Object.keys(marks.reviewed)).toEqual(['p-bbbbbbbb']);
  await page.screenshot({ path: 'test-results/review.png' });

  // --- Search (Ctrl+K): your points and AI text are listed apart.
  await page.keyboard.press('Control+k');
  const box = page.getByRole('searchbox', { name: 'Search points and notes' });
  await box.fill('kube');
  await box.fill('cluster');
  const mine = page.getByRole('list', { name: 'Matching points' });
  await expect(mine.getByRole('button')).toHaveCount(1);
  await expect(mine.locator('mark')).toHaveText(['ClusterIP', 'cluster']);
  await box.fill('iptables');
  const ai = page.getByRole('list', { name: 'Matching AI text' });
  await expect(ai.getByRole('button')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/search.png' });
  await ai.getByRole('button').click();
  const noteHeading = page.getByRole('heading', { level: 2, name: 'Services' });
  await expect(noteHeading).toBeVisible();

  // --- Only mine hides AI blocks but keeps the user's highlighted point.
  const note = page.getByRole('region', { name: 'Services' });
  await expect(note.getByRole('article', { name: 'AI-generated explanation' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Only mine', exact: true }).click();
  await expect(note.getByRole('article', { name: 'AI-generated explanation' })).toHaveCount(0);
  await expect(note.getByRole('article', { name: /Your point from/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'All', exact: true }).click();

  // --- Keys, then a weekly digest through the background queue.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('LLM API key API key').fill('sk-e2e-fake-key');
  await page.getByRole('group', { name: 'LLM API key' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved to secure storage')).toBeVisible();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'Kubernetes' }).click();
  await page.getByRole('button', { name: 'New digest' }).click();
  const picker = page.getByRole('dialog');
  await picker.getByRole('tab', { name: 'Monthly' }).click();
  await picker.getByRole('tab', { name: 'Weekly' }).click();
  await picker.getByRole('list', { name: 'Periods' }).getByRole('button').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /^Digest · / })).toBeVisible();
  await dialog.getByRole('button', { name: /^Write digest from \d+ point\(s\)$/ }).click();
  await expect(page.getByRole('contentinfo', { name: 'Background jobs' }).getByText('Written')).toBeVisible();
  await page.getByRole('list', { name: 'Digests' }).getByRole('button').first().click();
  const digest = page.getByRole('region').filter({ hasText: 'Recap of Week' });
  await expect(digest.getByText(/Digest ·/)).toBeVisible();
  await expect(digest.getByRole('article', { name: /Your point from/ }).first()).toBeVisible();
  await expect(digest.getByRole('heading', { name: 'Service networking' })).toBeVisible();
  await page.screenshot({ path: 'test-results/digest.png' });

  expect(await hashBacklogs(vaultRoot)).toEqual(before);
});
