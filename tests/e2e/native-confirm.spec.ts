import { expect, test } from '@playwright/test';
import { removeDir } from '../helpers';
import { launch, type Launched } from './launch';

let l: Launched;
test.beforeEach(async () => {
  l = await launch({ LODE_E2E_AUTO_CONFIRM: '0' });
});
test.afterEach(async () => {
  await l.app.close();
  await removeDir(l.vaultRoot);
  await removeDir(l.userData);
});

test('move to trash goes through the native message box', async () => {
  const { app, page } = l;
  const calls = await app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { boxes: unknown[] };
    g.boxes = [];
    dialog.showMessageBox = (async (...args: unknown[]) => {
      g.boxes.push(args.at(-1));
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
    return g.boxes.length;
  });
  expect(calls).toBe(0);
  await page.getByRole('button', { name: 'New folder', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Scratch');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Actions for Scratch' }).click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await expect(page.getByRole('button', { name: 'Scratch', exact: true })).toHaveCount(0);
  const boxes = await app.evaluate(() => (globalThis as unknown as { boxes: { message: string }[] }).boxes);
  expect(boxes.map((b) => b.message)).toEqual(['Move "Scratch" to the trash?']);
});
