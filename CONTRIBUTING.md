# Contributing

Thanks for being here. Stallion is a two-piece bridge (Cavalry script + VS Code
extension) with one wire contract, plus a headless mock that speaks the same
protocol. Additive, backwards-compatible changes only unless a breaking change
is explicitly proposed and approved.

## Prerequisites

- Node.js 20, 22 or 24 (the CI matrix) and npm.
- For live work: Cavalry 2.4.0+ (the script gates on it; the mock models 2.8)
  and VS Code 1.101.0+ for the extension commands.
- The extension-host suite (`npm run test:vscode`) downloads Electron; it is
  excluded from PR CI and available as a manual `workflow_dispatch` job.

## Development loop

```bash
npm ci
npx cross-env NODE_ENV=production npm run build   # one-shot; plain build watches
npm run test:ci        # build + typecheck + lint + protocol + mock suites
npm run lint           # ESLint flat config
npm run test:vscode    # local only, downloads Electron
```

`npm run build` without `NODE_ENV=production` starts a watch loop that never
exits — use the cross-env form in scripts and CI. `dist/` is ignored; a fresh
checkout must build before the extension, mock CLI or protocol test can run.

## Ground rules

1. **One wire contract.** The live bridge, the mock and the protocol tests must
   keep answering the same envelopes; new capabilities go into the heartbeat
   `capabilities` handshake, not silent behaviour changes.
2. **One Undo group per script, no automatic rollback.** Keep the `finally`
   close and the receipt/state audit trail intact.
3. **UI-thread discipline.** Everything runs synchronously in Cavalry; keep the
   bounded-work caps (budgets, frame caps, pagination) when adding endpoints.
4. **One coherent change per commit**, conventional-commit messages
   (`fix(deps): …`, `docs(readme): …`, `chore(ci): …`).
5. Add a line to `CHANGELOG.md` under *Unreleased* for anything user-visible;
   never rewrite historical entries.

## Publishing

This fork is `private: true` and still carries upstream's `publisher` value;
the `publish` script was removed on purpose. **Before any Marketplace publish
a real publisher ID must be set and `private` removed** — do not invent or
reuse a publisher ID you do not own. Local packaging keeps working:
`npx @vscode/vsce package` produces a `.vsix` (ignored by git), and
`vscode:prepublish` runs the production build.

## Pull requests

- One coherent change per PR with the tests that prove it; CI must stay green
  on the Ubuntu/Windows × Node 20/22/24 matrix.
- If you change the wire contract, update the protocol tests, the mock and the
  README protocol section together, and say which payloads move.
- Read [SECURITY.md](SECURITY.md) before touching execution or auth paths;
  mandatory token auth is a proposed breaking change, not a default.