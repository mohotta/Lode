import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { hashBacklogs, removeDir } from '../helpers';
import { startFakes, type Fakes } from './fakeServers';
import { launch, type Launched } from './launch';

let l: Launched;
let fakes: Fakes;

async function seed(root: string): Promise<void> {
  await mkdir(join(root, 'kubernetes', 'backlog'), { recursive: true });
  await mkdir(join(root, 'kubernetes', 'notes'), { recursive: true });
  await writeFile(join(root, 'kubernetes', 'folder.json'), JSON.stringify({ title: 'Kubernetes', createdAt: '2026-01-01T00:00:00.000Z' }));
  await writeFile(
    join(root, 'kubernetes', 'backlog', '2026-10-01.md'),
    `---\ndate: 2026-10-01\ndeleted: []\n---\n- ClusterIP services are only reachable inside the cluster ^p-aaaaaaaa\n`,
  );
  await writeFile(
    join(root, 'kubernetes', 'notes', 'services.md'),
    `---\nfolder: kubernetes\nsubtopic: services\ntitle: Services\nupdated: 2026-01-01T00:00:00.000Z\n---\n` +
      `{{point:p-aaaaaaaa}}\n\n::llm{id=b-00000001 model="m" at="2026-01-01T00:00:00.000Z"}\nkube-proxy programs iptables rules.\n::\n`,
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

test('compose a note from subtopics, edit it by hand and with AI, then undo', async () => {
  const { page, vaultRoot } = l;
  const before = await hashBacklogs(vaultRoot);
  await page.locator('.tree-item', { hasText: 'Kubernetes' }).click();
  // Let the folder finish loading (it focuses the composer) before typing in the dialog.
  await expect(page.getByRole('heading', { name: 'Subtopics' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Add a point to Kubernetes' })).toBeFocused();

  // --- New note: pick a subtopic and add an extra topic.
  await page.getByRole('button', { name: 'New note' }).click();
  const picker = page.getByRole('dialog', { name: 'New note' });
  const title = picker.getByRole('textbox', { name: 'Title' });
  await expect(title).toBeFocused();
  await title.fill('Cluster networking');
  await picker.getByRole('checkbox', { name: /Services/ }).check();
  const topic = picker.getByPlaceholder('Type a topic and press Enter');
  await topic.fill('NetworkPolicy');
  await topic.press('Enter');
  await expect(picker.getByText('NetworkPolicy')).toBeVisible();
  await expect(title).toHaveValue('Cluster networking');
  await page.screenshot({ path: 'test-results/new-note.png' });
  await picker.getByRole('button', { name: 'Continue' }).click();

  const dialog = page.getByRole('dialog', { name: 'Write note' });
  await expect(dialog.getByText('Extra topics: NetworkPolicy')).toBeVisible();
  await dialog.getByRole('button', { name: 'Write note', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Background jobs' }).getByText('Written')).toBeVisible();

  await page.getByRole('list', { name: 'Notes' }).getByRole('button', { name: /Cluster networking/ }).click();
  const note = page.getByRole('region', { name: 'Cluster networking' });
  await expect(note.getByRole('heading', { name: 'How Services work' })).toBeVisible();
  await expect(note.getByRole('article', { name: /Your point from/ })).toHaveCount(1);
  await expect(note.getByText('ClusterIP services are only reachable')).toBeVisible();
  const raw = await readFile(join(vaultRoot, 'kubernetes', 'articles', 'cluster-networking.md'), 'utf8');
  expect(raw).toContain('{{point:p-aaaaaaaa}}');
  expect(raw).not.toContain('ClusterIP services are only reachable');
  await page.screenshot({ path: 'test-results/note-article.png' });

  // --- Edit by hand: the edited text is labelled as the user's.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Edit note' });
  const text = editor.getByRole('textbox', { name: 'Note text' }).last();
  await text.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Written by me.');
  await page.screenshot({ path: 'test-results/note-edit.png' });
  await editor.getByRole('button', { name: 'Save note' }).click();
  await expect(note.getByRole('article', { name: 'Text you wrote or edited' })).toContainText('Written by me.');
  expect(await readFile(join(vaultRoot, 'kubernetes', 'articles', 'cluster-networking.md'), 'utf8')).toContain('by=you');

  // --- Edit with AI: the instruction goes through the preview, then the job.
  await page.getByRole('button', { name: 'Edit with AI' }).click();
  await page.getByRole('textbox', { name: 'What should the AI change?' }).fill('Make it shorter');
  await page.getByRole('button', { name: 'Continue' }).click();
  const revise = page.getByRole('dialog', { name: 'Edit note with AI' });
  await revise.getByRole('button', { name: 'Revise note' }).click();
  await expect(page.getByRole('region', { name: 'Background jobs' }).getByText('Revised')).toBeVisible();
  await expect(note.getByRole('heading', { name: 'Short version' })).toBeVisible();
  await expect(note.getByText('Written by me.')).toHaveCount(0);

  // --- Undo brings the hand-edited version back.
  await page.getByRole('button', { name: 'Note actions' }).click();
  await page.getByRole('menuitem', { name: 'Undo last change' }).click();
  await expect(note.getByText('Written by me.')).toBeVisible();
  expect((await readdir(join(vaultRoot, '.lode', 'history', 'kubernetes', '_articles', 'cluster-networking'))).length).toBeGreaterThan(0);

  expect(await hashBacklogs(vaultRoot)).toEqual(before);
});
