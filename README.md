# Lode

Local-first desktop app for capturing what you learn each day. Add short points to a folder's scratchpad; an LLM organises them into subtopic notes with explanations and web-sourced extras, and **your own points stay highlighted** and are never altered.

## Run

```bash
corepack enable pnpm
pnpm install
pnpm dev
```

## First use

1. **Open or create a vault**: choose any directory. It stays plain markdown you can open in any editor.
2. **Create a folder** (e.g. "Kubernetes") and type points into the scratchpad. Press Enter to add, or Shift+Enter for a new line.
3. **Settings**: set an OpenAI-compatible base URL and model (OpenAI, OpenRouter, Groq, or a local Ollama/vLLM), then save your LLM key and a Tavily key for web search. Keys go into the OS keychain and can't be read back.
4. **Generate**: review the preview (points, model, token estimate, search on or off) and confirm. It runs in the background; follow it in the status bar at the bottom and click it for the report.

## Day to day

- **Edit or delete a point** from its ⋯ menu, in the backlog or inside a note. Deleting is a soft tombstone with Restore.
- **Repeats** are caught when you add them; Generate also files points that restate an earlier one next to the original.
- **Regenerate** a note to rewrite its AI sections from all of its points. Undo regenerate restores the previous version.
- **Trash**: deleted notes and folders go to the vault trash (sidebar footer), where you can restore them or delete them for good.
- **Navigate** with the breadcrumb and Back/Forward (Alt+←/→).

## Recap

- **Review** (sidebar) resurfaces points from about a day, a week and a month ago; mark each one reviewed.
- **Search** (Ctrl+K) covers your points and the AI notes, listed separately. The index is local (`.lode/index.sqlite`) and can be deleted at any time.
- **My points** in a note's header hides the AI sections.
- **Digests**: in a folder's overview, *New digest* writes a weekly or monthly recap of your points, with them highlighted.

## Package

```bash
pnpm package        # dist/: Lode-<v>-x86_64.AppImage, lode_<v>_amd64.deb, lode-<v>.x86_64.rpm
```

deb/rpm use electron-builder's bundled fpm, which needs `libcrypt.so.1` (Fedora: `sudo dnf install libxcrypt-compat`). Windows and macOS installers are built by `pnpm package:win` / `pnpm package:mac` on those systems, or by the manual jobs in `.gitlab-ci.yml`. Builds are unsigned.

## Check

```bash
pnpm typecheck && pnpm lint && pnpm test   # unit + integration
pnpm test:e2e                              # builds, then drives Electron with fake LLM/search servers
LODE_E2E_EXECUTABLE=dist/linux-unpacked/lode pnpm exec playwright test   # same suite against a packaged build
```
