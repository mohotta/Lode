# Security policy

Lode handles personal notes and stores API keys, so security reports are taken seriously.

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Instead, open a
[confidential issue](https://gitlab.com/mohotta/lode/-/issues/new?issue[confidential]=true) on GitLab
(tick "This issue is confidential"), or email the maintainer at the address in `package.json`.

Include what you found, how to reproduce it, the Lode version and your OS. You'll get an acknowledgement within a week. Please give a reasonable time for a fix before disclosing publicly.

## Supported versions

Fixes go into the latest release. Older versions are not patched.

## In scope

- **API key exposure:** any way for the renderer, a log, a note or a network request to an unintended host to obtain a stored key.
- **Renderer escape:** bypassing the sandbox or context isolation, reaching Node or Electron APIs from the UI, or a generic IPC path.
- **Untrusted content:** LLM output or web search results that inject markup or script, forge point markers or blocks, or make Lode write user-visible text that pretends to be the user's.
- **File system:** writing or reading outside the chosen vault (path traversal, symlinks), or non-atomic writes that can corrupt a vault.
- **Data leaving the device** other than to the configured LLM and search providers on an explicit action.

## Out of scope

- What the user's chosen LLM or search provider does with data sent to it.
- Linux systems with no keyring where the user explicitly opted in to basic key obfuscation (the app warns about this).
- Attacks that need an already-compromised user account or machine.
- Unsigned builds being flagged by Windows SmartScreen or macOS Gatekeeper.
