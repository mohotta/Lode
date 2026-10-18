# Contributing to Lode

Thanks for helping. Bug reports, ideas, docs fixes and merge requests are all welcome.

## Before you start

- **Small fixes** (typos, obvious bugs): open a merge request directly.
- **Features or larger changes**: open an issue first so we can agree on the approach. Lode stores users' learning history, so anything that changes the on-disk format, the IPC surface or what data is sent to a provider needs a short discussion before code.

## Development setup

You need **Node.js 24+** and **pnpm** (via Corepack).

```bash
git clone https://gitlab.com/mohotta/lode.git
cd lode
corepack enable
pnpm install
pnpm dev
```

pnpm 12 only runs the dependency build scripts listed under `allowBuilds` in `pnpm-workspace.yaml`. If Electron's binary is missing, run `node node_modules/electron/install.js`.

To try generation without a paid key, point Settings at a local model (Ollama: `http://localhost:11434/v1`).

## Checks

Run these before opening a merge request; CI runs the same:

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm test:e2e
```

The e2e suite drives the real Electron app against fake LLM and search servers. It never uses real API keys; please keep it that way.

## Invariants

These are why Lode exists. A change that breaks one is a bug even if the tests pass.

1. **Generation never writes the backlog.** Only user actions (add, edit, soft delete) write backlog files. Generation code receives the read-only `ReadonlyBacklog` view.
2. **User text never passes through LLM output.** Notes hold `{{point:<id>}}` markers, not copies of point text. The LLM output schema has no field for user text and must not gain one.
3. **LLM text can't forge structure.** `{{point:` and line-leading `::` are stripped from model output before it is written.
4. **API keys never reach the renderer.** No IPC channel returns a key, and keys are never logged.
5. **Generate only appends.** Only an explicit Regenerate replaces AI blocks, and it saves the previous version first.
6. **Every AI addition needs a verifiable source**: a URL from that run's search results. Others are dropped or marked unsourced.
7. **Writes are atomic** (temp file, then rename), and every path is checked to stay inside the vault.
8. **No telemetry, no backend.** Data leaves the device only to the user's chosen LLM and search providers, on an explicit action.

## Code guidelines

- TypeScript in strict mode. No `any` without a comment explaining why.
- Validate every boundary with Zod: IPC input, LLM output, file contents.
- Keep `src/core` free of Electron imports; put side effects (fs, network) behind small interfaces so they can be mocked.
- The renderer is sandboxed. Never add a generic IPC passthrough, and never use `dangerouslySetInnerHTML`; markdown is rendered from an AST.
- Highlighting must not rely on colour alone (use border, icon and label too).
- Prefer editing existing modules over adding new ones. Justify any new dependency in the merge request.

## Tests

Add a test with every behaviour change.

- **Format changes** (backlog or note files) need round-trip tests: parsing then serialising returns the same bytes.
- **Generation changes** need a mock-LLM test, including adversarial output: invented point IDs, forged markers, uncited additions.
- Keep the backlog-unchanged-after-generation tests passing; don't weaken them.

## Commits and merge requests

- Small, focused commits with clear messages, in the [Conventional Commits](https://www.conventionalcommits.org/) style used in the history (`feat:`, `fix:`, `ci:`, `docs:`...).
- One concern per merge request. Fill in the template checklist.
- If behaviour visible to users changes, update the README in the same merge request.

## License

By contributing, you agree that your contributions are licensed under the project's license, [GPL-3.0-or-later](LICENSE).
