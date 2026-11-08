# Stallion agent rules

## SaaS reference video intake

[`.qoder/rules/saas-video-intake.md`](.qoder/rules/saas-video-intake.md) is always on. When a chat supplies 5–10 video paths without a build request, load [`.qoder/skills/saas-reference-analyzer/SKILL.md`](.qoder/skills/saas-reference-analyzer/SKILL.md) and run the analysis-only pipeline against the `refclone` and `cavalry-mcp` checkouts. This workflow never invokes stallion or any Cavalry scene/render tool. If any input is not SaaS UI content, abort the batch and print only: "This library is SaaS-only. Remove non-SaaS video and retry."

- Preserve `POST /post`, `GET /get`, optional `seq`, and the default `http://127.0.0.1:8080` protocol.
- Execute batched scripts in isolated IIFEs with `api.startUndoGroup("AI Motion Batch")` / `api.endUndoGroup()` in `try/finally`.
- Never loop single-action calls from automation clients. Use the sibling `cavalry-mcp` project's `cavalry_run_script` or `bin/stallion-cli.mjs` for one-shot batches.
- Keep results structured and compact: `{ ok, result }` or `{ ok:false, error, stack }` with the caller's `seq`.
- Preserve direct VS Code posts and legacy file-based clients when changing the dispatcher.
