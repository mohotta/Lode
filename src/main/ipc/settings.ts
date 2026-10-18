import { OpenAiCompatibleAdapter } from '@core/llm/openaiCompatible';
import { TavilySearch } from '@core/llm/tavily';
import type { SettingsView } from '@shared/ipc';
import type { KeyStore } from '../KeyStore';
import type { SettingsStore } from '../SettingsStore';
import { handle } from './handle';

const TAVILY_URL = process.env.LODE_TAVILY_URL;

export function registerSettingsHandlers(settings: SettingsStore, keys: KeyStore, isPackaged: boolean): void {
  const view = async (): Promise<SettingsView> => {
    const s = await settings.get();
    return {
      llm: s.llm,
      generation: s.generation,
      keys: { llm: await keys.has('llm'), tavily: await keys.has('tavily') },
      keyBackend: keys.backend(),
      allowWeakKeyStorage: s.allowWeakKeyStorage,
    };
  };

  handle('settings:get', view);

  handle('settings:set', async (patch) => {
    await settings.update((s) => ({
      ...s,
      ...(patch.allowWeakKeyStorage !== undefined ? { allowWeakKeyStorage: patch.allowWeakKeyStorage } : {}),
      llm: { ...s.llm, ...patch.llm },
      generation: { ...s.generation, ...patch.generation },
    }));
    return view();
  });

  // No keys:get. The renderer can set, check, test and clear, never read (invariant 4).
  handle('keys:set', async ({ id, key }) => {
    await keys.set(id, key);
    return true;
  });
  handle('keys:has', async ({ id }) => keys.has(id));
  handle('keys:clear', async ({ id }) => {
    await keys.clear(id);
    return true;
  });
  handle('keys:test', async ({ id }) => {
    if (id === 'tavily') {
      const endpoint = !isPackaged && TAVILY_URL ? TAVILY_URL : undefined;
      await new TavilySearch({ getKey: () => keys.get('tavily'), ...(endpoint ? { endpoint } : {}) }).testConnection();
    } else {
      const s = await settings.get();
      if (!s.llm.model) throw new Error('Set a model name first');
      await new OpenAiCompatibleAdapter({ baseUrl: s.llm.baseUrl, model: s.llm.model, getKey: () => keys.get('llm') }).testConnection();
    }
    return 'Connection OK';
  });
}
