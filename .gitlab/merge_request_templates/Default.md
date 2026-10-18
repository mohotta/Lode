## What and why

<!-- What this changes and the problem it solves. Link the issue: Closes #123 -->

## How it was tested

<!-- Commands run, manual steps, screenshots for UI changes. -->

## Checklist

- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass
- [ ] `pnpm test:e2e` passes (or not affected)
- [ ] Added or updated tests for the behaviour change
- [ ] Keeps every invariant in [CONTRIBUTING.md](CONTRIBUTING.md#invariants) (backlog read-only to generation, no user text in LLM output, no keys in the renderer, …)
- [ ] Format changes have round-trip tests; generation changes have mock-LLM tests with adversarial output
- [ ] New dependencies are justified below (or none added)
- [ ] README updated if user-visible behaviour changed

## Dependencies added

<!-- Package, why it's needed, alternatives considered. Delete if none. -->
