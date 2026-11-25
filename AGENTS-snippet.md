# Komorebi Bridge — Suggested Agent Instructions

Paste the section below into your `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` (either per-project or global). Replace `<install-dir>` and `<skills-dir>` with your local paths.

---

```markdown
## Komorebi Bridge Collaboration

- **Workbench tool**: `<install-dir>/scripts/komorebi-room` (set `KOMOREBI_URL` if Bridge is not on `http://localhost:3000`).
- **Which skill to read before starting**:
  - Group lead (crown ♛): read `<skills-dir>/lead/SKILL.md`.
  - Assigned a workbench ticket (`[工作台 #N｜…]`): read `<skills-dir>/member/SKILL.md`.
  - Working alone in a single room: complete the task directly, verify honestly, and report clearly.
- **UI build**: after changing `src/`, `public/`, or `index.html`, run `npm run build` and ask the user to refresh the page; Bridge need not restart. For immediate development previews, set `KOMOREBI_UI=dev` before starting Bridge.
- **No idle waiting**: never poll or sleep to wait for another agent. Send a workbench message and stop; the Bridge wakes you when a reply arrives.
- **Verification**: use `verify-gate --test-changed` for intermediate checks. Codex rooms can run the full checks with `--background --from <session-id>` and end the turn to await the workbench notice; Claude and AGY run checks directly. Run the required full checks before pushing.
- **Honest reporting**: report real verification results (`PASS` / `FAIL` / `SKIP` / `not run`) and state what was not verified. End formal lead/solo reports with a 5-line summary (`Result`, `Code`, `Evidence`, `Blocker`, `Next`) and a final line of `RESULT — DONE`, `RESULT — STOP`, or `RESULT — INCOMPLETE`. Members close tickets with `bench done --receipt <HANDOFF-path>`.
- **Ask before irreversible actions**: always ask the user before deleting files, force-pushing, rewriting Git history, merging, deploying, sending external messages, or changing room permission modes.

## Persona (Optional)

<!-- Give this agent a name, tone, or working style if you like. Leave blank to use the default voice. -->
```
