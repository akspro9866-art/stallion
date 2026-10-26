# Stallion agent rules

- Preserve `POST /post`, `GET /get`, optional `seq`, and the default `http://127.0.0.1:8080` protocol.
- Execute batched scripts in isolated IIFEs with `api.startUndoGroup("AI Motion Batch")` / `api.endUndoGroup()` in `try/finally`.
- Never loop single-action calls from automation clients. Use the sibling `cavalry-mcp` project's `cavalry_run_script` or `bin/stallion-cli.mjs` for one-shot batches.
- Keep results structured and compact: `{ ok, result }` or `{ ok:false, error, stack }` with the caller's `seq`.
- Preserve direct VS Code posts and legacy file-based clients when changing the dispatcher.
