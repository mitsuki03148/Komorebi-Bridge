---
name: member
description: Basic SOP for a group member taking a workbench ticket: read, claim, implement, verify, write HANDOFF, and close with bench done.
---

# Member SOP

A workbench ticket (`[工作台 #N｜…]`) is your assignment. Stay inside the repo, branch, and change boundary named in the ticket.

## Step-by-Step Workflow

1. **Read first**: read the full ticket and every required file it lists. Check `git status --short` and `git rev-parse HEAD` before editing; keep other people's uncommitted changes untouched.
2. **Claim your scope**: claim the file or folder you will edit so teammates do not collide:
   ```bash
   <install-dir>/scripts/komorebi-room bench claim "<file-or-folder>" --group "<group-id>" --from "<your-session-id>"
   ```
   (Closing the ticket releases the claim automatically.)
3. **Ask if blocked**: if a requirement is missing or ambiguous, reply on the same ticket instead of guessing or waiting idle:
   ```bash
   <install-dir>/scripts/komorebi-room bench send <sender-session-id> --from "<your-session-id>" --reply-to <id> "<question>"
   ```
4. **Do the work and verify honestly**:
   - Run the smallest verification that proves your change (lint/typecheck, targeted tests, build as needed).
   - Report real outcomes (`PASS`, `FAIL`, `SKIP`, `not run`). Never loosen an assertion or hide a failure. A run executing 0 tests is never `PASS`.
   - If a test fails, diagnose the cause before retrying. Stop and report if still blocked after fixing.
5. **Write HANDOFF**: save a concise `HANDOFF.md` at the path named in the ticket with:
   - Result and exact commit SHA (plus branch/push state and any uncommitted files).
   - Verification run (PASS/FAIL counts and units) and any unverified scope.
   - Required files read (`read fully` / `sections` / `not read`).
   - Any assumptions or open questions.
6. **Close the ticket**: once deliverables and HANDOFF are written, run `bench done`:
   ```bash
   <install-dir>/scripts/komorebi-room bench done <id> --from "<your-session-id>" \
     --receipt "<absolute-path-to-HANDOFF.md>" \
     --note "<one-line outcome>\nRESULT — DONE"
   ```
   If you could not finish, leave the ticket open (unless the sender asks to return it), record the stop point in HANDOFF, and send a `--reply-to` update explaining the blocker.

## Safety Boundaries

- Do not perform irreversible actions (deletion, force push, merge, deploy, history rewrite, sending outside, or changing room permissions) unless explicitly authorised by the user.
- Do not delete shared logs, receipts, builds, or scratch files; leave cleanup to the lead.
- Do not poll or sleep after sending a message. The Bridge wakes you when a reply arrives.

## Chat Acknowledgement

After `bench done`, keep your chat message to two short lines plus the status marker (details stay in HANDOFF):

- **Result**: one sentence summary and link to HANDOFF.
- **Blocker**: `none` (or one sentence describing the blocker).

```text
RESULT — DONE
```
