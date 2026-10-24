import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { vaultIdFor } from '../../src/main/VaultRegistry';
import { tempDir } from '../helpers';

export interface Launched {
  app: ElectronApplication;
  page: Page;
  vaultRoot: string;
  userData: string;
}

/** Launches the built app against a fresh temp profile with one pre-registered empty vault. */
export async function launch(
  extraEnv: Record<string, string> = {},
  settings: object = {},
  seed?: (vaultRoot: string) => Promise<void>,
  vaultName = 'E2E Vault',
): Promise<Launched> {
  const userData = await tempDir('lode-e2e-profile-');
  const vaultRoot = await tempDir('lode-e2e-vault-');
  await seed?.(vaultRoot);
  await mkdir(userData, { recursive: true });
  const id = vaultIdFor(vaultRoot);
  await writeFile(
    join(userData, 'settings.json'),
    JSON.stringify({ vaults: [{ id, path: vaultRoot, name: vaultName }], lastVaultId: id, ...settings }),
  );
  // LODE_E2E_EXECUTABLE runs the suite against a packaged build (e.g. dist/linux-unpacked/lode).
  const packaged = process.env.LODE_E2E_EXECUTABLE;
  const app = await electron.launch({
    ...(packaged ? { executablePath: resolve(packaged) } : {}),
    // Basic password store: never touch (or prompt for) the developer's real keyring.
    // CI containers run as root, where Chromium's OS sandbox cannot start. The renderer is still
    // isolated (contextIsolation, sandbox: true, no Node), which the sandbox test checks.
    args: [
      ...(packaged ? [] : [resolve('out/main/index.js')]),
      '--password-store=basic',
      ...(process.env.CI && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    ],
    env: { ...process.env, LODE_USER_DATA: userData, ELECTRON_RENDERER_URL: '', ...extraEnv } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, vaultRoot, userData };
}
