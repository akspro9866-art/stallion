# Security

## Reporting

Open a **private security advisory** on the repository (Security → Report a
vulnerability) rather than a public issue, and include the version, your OS,
whether the live bridge or the headless mock was running, and the redacted
request payload.

## What this software does on your machine

- The Cavalry script (`dist/Stallion.js`) starts `api.WebServer` **inside the
  running Cavalry process** and executes posted JavaScript on Cavalry's UI
  thread, one Undo group per script.
- The VS Code extension installs that script into Cavalry's Scripts folder
  and posts editor contents to the bridge; it does not read `stallion.json`.
- The headless mock bridge (`dist/stallion-mock.mjs`) speaks the same protocol
  against an in-memory scene and writes renders to your temp folder.
- No telemetry, no accounts, no TLS, and no network calls beyond the HTTP
  listener you start.

## The risk you are actually taking

`POST /post` executes arbitrary JavaScript in your animation app. Token auth
is **optional** (`stallion.json` `token`, Bearer on both endpoints):

- **Bind to localhost wherever possible.** The default `127.0.0.1:8080` keeps
  the bridge on-loopback; changing `host` exposes an unauthenticated scripting
  endpoint to the network unless you also set a token.
- **Set a token if the port is reachable by anything else.** Without one, any
  client that can reach the port can mutate, save or render your open scene.
  The bridge logs a startup warning when it listens without a token.
- **Treat posted code as untrusted input.** Plans and scripts may be authored
  by a language model; review them before posting against a scene you care
  about, and keep your own copy of any `.cv` project — a failed script leaves
  its already-applied edits inside one Undo group (no automatic rollback).
- **Results are not queued.** `GET /get` serves the latest payload; concurrent
  clients can overwrite each other's result. Match `seq` and enforce timeouts.

## Not covered

No sandboxing of the Cavalry process, no TLS, no secrets management, and no
mandatory authentication (making auth mandatory is a proposed breaking change,
recorded in CHANGELOG.md, not shipped). See [LICENSE](LICENSE) for terms.