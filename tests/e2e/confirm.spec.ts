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

test('confirmations use the in-app dialog: Esc and Cancel keep things, confirm acts', async () => {
  const { page } = l;
  await page.getByRole('button', { name: 'New folder', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Scratch');
  await page.keyboard.press('Enter');
  const folder = page.getByRole('button', { name: 'Scratch', exact: true });
  const dialog = page.getByRole('alertdialog', { name: 'Move "Scratch" to the trash?' });
  const askTrash = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Actions for Scratch' }).click();
    await page.getByRole('menuitem', { name: 'Move to trash' }).click();
    await expect(dialog).toBeVisible();
  };

  await askTrash();
  await expect(dialog).toContainText('You can restore it from Trash.');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(folder).toHaveCount(1);

  await askTrash();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(folder).toHaveCount(1);

  await askTrash();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400); // let colour transitions and the open animation settle
  await page.screenshot({ path: 'test-results/confirm-dark.png' });
  await dialog.getByRole('button', { name: 'Move to trash' }).click();
  await expect(folder).toHaveCount(0);
});
