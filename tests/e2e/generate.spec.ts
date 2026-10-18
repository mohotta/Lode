import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { hashBacklogs, removeDir } from '../helpers';
import { CITED_URL, startFakes, type Fakes } from './fakeServers';
import { launch, type Launched } from './launch';

let l: Launched;
let fakes: Fakes;
const LLM_KEY = 'sk-e2e-fake-key';

test.beforeEach(async () => {
  fakes = await startFakes();
  l = await launch({ LODE_TAVILY_URL: fakes.tavilyUrl }, { llm: { baseUrl: fakes.llmBase, model: 'fake-model' } });
});
test.afterEach(async () => {
  await l.app.close();
  await fakes.close();
  await removeDir(l.vaultRoot);
  await removeDir(l.userData);
});

test('BYOK settings, generate with search, highlighted user points vs AI blocks', async () => {
  const { page, vaultRoot, userData } = l;

  // --- Settings: save keys (write-only) and test the connection.
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('No system keyring was found')).toBeVisible();
  // Refused until the user explicitly opts in to weak storage.
  await page.getByLabel('LLM API key API key').fill(LLM_KEY);
  await page.getByRole('group', { name: 'LLM API key' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/No system keyring is available/)).toBeVisible();
  const weak = page.getByLabel('Store keys anyway with basic obfuscation');
  await weak.click();
  await expect(weak).toBeChecked();
  const llmKey = page.getByLabel('LLM API key API key');
  await llmKey.fill(LLM_KEY);
  await page.getByRole('group', { name: 'LLM API key' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved to secure storage')).toBeVisible();
  await page.getByRole('group', { name: 'LLM API key' }).getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Connection OK')).toBeVisible();
  await page.getByLabel('Tavily search key API key').fill('tvly-e2e-fake');
  await page.getByRole('group', { name: 'Tavily search key' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('group', { name: 'Tavily search key' }).getByText('Saved to secure storage')).toBeVisible();

  // The renderer has no way to read a key back.
  const exposed = await page.evaluate(() => Object.keys((globalThis as unknown as { lode: { keys: object } }).lode.keys).sort());
  expect(exposed).toEqual(['clear', 'has', 'set', 'test']);
  // And it is not stored in plain text.
  expect(await readFile(join(userData, 'keys.json'), 'utf8')).not.toContain(LLM_KEY);
  expect(await readFile(join(userData, 'settings.json'), 'utf8')).not.toContain(LLM_KEY);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400); // let colour transitions settle before capturing
  await page.screenshot({ path: 'test-results/settings-dark.png' });
  await page.getByRole('button', { name: 'Back' }).click();

  // --- Capture.
  await page.getByRole('button', { name: 'New folder', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Kubernetes');
  await page.keyboard.press('Enter');
  const input = page.getByRole('textbox', { name: 'Add a point to Kubernetes' });
  const CODE_POINT = 'Expose a Service with `kubectl expose`:\n```bash\nkubectl expose deploy web --port 80\n```';
  for (const t of ['ClusterIP services are only reachable inside the cluster', 'kube-proxy IPVS mode scales better', CODE_POINT]) {
    await input.fill(t);
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('');
  }
  await expect(page.getByLabel('Backlog', { exact: true }).getByText('unfiled')).toHaveCount(3);
  // The user's own code renders as a code block in the backlog, from their exact text.
  await expect(page.getByLabel('Backlog', { exact: true }).locator('pre code')).toHaveText('kubectl expose deploy web --port 80');
  const before = await hashBacklogs(vaultRoot);

  // --- Generate: preview first, then confirm.
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('3 unfiled')).toBeVisible();
  await expect(dialog.getByText('fake-model')).toBeVisible();
  await expect(dialog.getByText('On (Tavily)')).toBeVisible();
  await expect(dialog.getByText(/~[\d,]+ in/)).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400); // let colour transitions settle before capturing
  await page.screenshot({ path: 'test-results/dialog-dark.png' });
  await dialog.getByRole('button', { name: 'Send 3 point(s)' }).click();
  await expect(dialog.getByText(/Filed 3 point\(s\)/)).toBeVisible();
  await expect(dialog.getByText(/1 point\(s\) got a correction note/)).toBeVisible();
  await expect(dialog.getByText(/Dropped 1 addition/)).toBeVisible();
  await dialog.getByRole('button', { name: /Service networking & kube-proxy \(new\)/ }).click();

  // --- Invariant: backlog bytes unchanged.
  expect(await hashBacklogs(vaultRoot)).toEqual(before);
  expect(fakes.llmAuth.every((a) => a === `Bearer ${LLM_KEY}`)).toBe(true);

  // --- Note rendering: user points highlighted (label + icon + border), AI block distinct with sources.
  const note = page.getByRole('region', { name: 'Service networking & kube-proxy' });
  const mine = note.getByRole('article', { name: /Your point from/ });
  await expect(mine).toHaveCount(3);
  await expect(mine.nth(2).locator('pre code')).toHaveText('kubectl expose deploy web --port 80');
  await expect(mine.nth(2).locator('code').first()).toHaveText('kubectl expose');

  // Correction: separate AI note under the untouched point, flagged with icon + label.
  const fixed = mine.filter({ hasText: 'kube-proxy IPVS mode scales better' });
  await expect(fixed).toContainText('Needs a fix');
  const correction = note.getByRole('complementary', { name: 'AI correction for your point above' });
  await expect(correction).toHaveCount(1);
  await expect(correction).toContainText('Correction');
  await expect(correction).toContainText('small clusters see little difference');
  await expect(correction).toHaveCSS('border-left-style', 'dashed');
  await expect(page.getByLabel('Backlog', { exact: true }).getByText('needs a fix')).toHaveCount(1);
  await expect(mine.first()).toContainText('You');
  await expect(mine.first()).toContainText('ClusterIP services are only reachable inside the cluster');
  // Distinct by shape too, not just colour: solid callout rule for points, dotted rule for AI.
  await expect(mine.first()).toHaveCSS('border-left-width', '3px');
  await expect(mine.first()).toHaveCSS('border-left-style', 'solid');

  const ai = note.getByRole('article', { name: 'AI-generated explanation' });
  await expect(ai).toHaveCount(1);
  await expect(ai).toHaveCSS('border-left-style', 'dotted');
  await expect(ai).toContainText('AI');
  await expect(ai.locator('strong')).toHaveText('Service');
  await expect(ai.getByRole('button', { name: /kubernetes\.io/ })).toBeVisible();
  await expect(ai).not.toContainText('made up');

  // Backlog shows filing status now.
  await expect(
    page.getByLabel('Backlog', { exact: true }).getByRole('button', { name: 'Service networking & kube-proxy' }),
  ).toHaveCount(3);

  // On disk: markers only, no user text, forged marker neutralised, only the real URL.
  const files = await readdir(join(vaultRoot, 'kubernetes', 'notes'));
  expect(files).toEqual(['service-networking.md']);
  const raw = await readFile(join(vaultRoot, 'kubernetes', 'notes', 'service-networking.md'), 'utf8');
  expect(raw).not.toContain('ClusterIP services are only reachable');
  expect(raw).not.toContain('kubectl expose deploy');
  expect(raw.match(/^\{\{point:p-[0-9a-z]{8}\}\}$/gm)).toHaveLength(3);
  expect(raw).toContain(CITED_URL);
  expect(raw).not.toContain('fake.example');
  expect(raw.match(/^::llm\{/gm)).toHaveLength(2);
  expect(raw.match(/^::llm\{id=b-[0-9a-z]{8} kind=correction for=p-[0-9a-z]{8} /gm)).toHaveLength(1);

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400); // let colour transitions settle before capturing
  await page.screenshot({ path: 'test-results/note-dark.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(400); // let colour transitions settle before capturing
  await page.screenshot({ path: 'test-results/note-light.png' });

  // Rename the subtopic from the sidebar: title changes, file and blocks stay.
  const blocksBefore = raw.slice(raw.indexOf('\n---\n', 4));
  await page.getByRole('button', { name: 'Actions for Service networking & kube-proxy' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rn = page.getByRole('textbox', { name: 'New subtopic name' });
  await rn.fill('Kubernetes Services, ClusterIP & IPVS');
  await rn.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Kubernetes Services, ClusterIP & IPVS' })).toBeVisible();
  const renamed = await readFile(join(vaultRoot, 'kubernetes', 'notes', 'service-networking.md'), 'utf8');
  expect(renamed).toContain('title: Kubernetes Services, ClusterIP & IPVS');
  expect(renamed.slice(renamed.indexOf('\n---\n', 4))).toBe(blocksBefore);
  expect(await hashBacklogs(vaultRoot)).toEqual(before);

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/note-corrections-dark.png' });

  // Generate is disabled when nothing is unfiled.
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
});
