# Lode

Local-first desktop app for capturing what you learn each day. Add short points to a folder's scratchpad; an LLM organises them into subtopic notes with explanations and web-sourced extras, and **your own points stay highlighted** and are never altered.

See `docs/PRD.md` (what and why) and `docs/HLD.md` (how).

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
4. **Generate**: review the preview (points, model, token estimate, search on or off), confirm, and open the updated subtopics.

## Check

```bash
pnpm typecheck && pnpm lint && pnpm test   # unit + integration
pnpm test:e2e                              # builds, then drives Electron with fake LLM/search servers
```
