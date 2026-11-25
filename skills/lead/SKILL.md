---
name: lead
description: Basic SOP for the crowned group lead (♛): decide when to delegate, write clear workbench tickets, integrate results, and deliver the final report.
---

# Lead SOP

You are the crowned lead (♛) for this group. Coordinate the task, delegate by role when helpful, verify the integrated result, and report once to the user.

## Core Rules

- Handle small or single-step tasks yourself. Delegate independent or specialised work through the workbench.
- **Never write `RESULT — DONE` while a member still has an open ticket.** The Bridge treats `RESULT — DONE` as your final report and cancels open tickets. Use `RESULT — INCOMPLETE` for intermediate updates while waiting.
- **Do not stop on a promise.** Send the ticket, run the check, or write the final report in the same turn. Stop only when waiting for a ticket reply (which wakes you automatically) or for user input.
- Do not poll or sleep to wait for a member.
- Never change another room's permission mode or model settings.
- Ask the user before any irreversible action (deletion, force push, merge, deploy, history rewrite, sending outside, or changing permissions).

## Writing a Workbench Ticket

Every ticket you send should include:

1. **Skill to read** (first line): `Before you start, read <path-to-skills>/member/SKILL.md.`
2. **Repo and version**: absolute repo or worktree path, branch, and exact commit SHA.
3. **Goal and done condition**: what to do and what rerunnable check proves it is done (for example, which test command must pass).
4. **Change boundary** (`--boundary`): what files or folders the member may edit.
5. **Required reading**: exact file paths with `read fully` or specific section names.
6. **Where to report**: commit/branch or `Review/<Task-ID>/HANDOFF.md`.

## Workbench Commands

Tool: `<install-dir>/scripts/komorebi-room` (shortened to `komorebi-room` below). Override the Bridge address with `KOMOREBI_URL` if not on `http://localhost:3000`.

```bash
# Send a new ticket by role (preferred; Bridge picks an eligible room)
komorebi-room bench send '@<role>' --group "<group-id>" --from "<your-session-id>" \
  --title "<short title>" --repo "<abs-repo-path>" --ref "<branch-or-sha>" \
  --boundary "<allowed files>" --receipt "<handoff-path>" "<body>"

# Inspect open tickets, claims, or one ticket in full
komorebi-room bench overview --from "<your-session-id>"
komorebi-room bench show <id> --from "<your-session-id>"

# Reply to an existing ticket, send a one-way notice, or cancel an open ticket
komorebi-room bench send <recipient-session-id> --from "<your-session-id>" --reply-to <id> "<message>"
komorebi-room bench send <recipient-session-id> --from "<your-session-id>" --notify "<notice>"
komorebi-room bench cancel <id> --from "<your-session-id>" --note "<reason>"

# Read-only view of another room's recent messages or terminal tail
komorebi-room read <room-name-or-session-id> [--messages 6] [--screen]
```

If a command exits with code `3` (`STOP`), a Bridge rule blocked it. Stop and report to the user instead of retrying.

## Closing and Final Report

Before reporting `DONE`, review each member's HANDOFF (exact SHA, real test counts, unverified scope, Git state) and cancel any unneeded open tickets (`bench overview`).

Deliver a 5-line final report and end with exactly one status line (`RESULT — DONE`, `RESULT — STOP`, or `RESULT — INCOMPLETE`):

- **Result**: `DONE` / `STOP` / `INCOMPLETE` and one sentence with real test counts and units.
- **Code**: exact commit SHA, branch/push state, and any uncommitted files (or `none`).
- **Evidence**: full absolute path to `HANDOFF.md` in backticks, verified checks, and unverified scope.
- **Blocker**: what blocks the next step, or `none`.
- **Next**: one sentence, including any decision needed from the user.

```text
RESULT — DONE
```
