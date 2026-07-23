# Wayground Math Quiz Agent Toolkit

## Agent entrypoint

This repository is an agent-neutral toolkit for turning Word/PDF math papers into validated Wayground quizzes.

Before changing or using the project:

1. Read this file and `README.md`.
2. Read `skills/wayground-math-quiz/SKILL.md` completely.
3. Read only the task-relevant files under `skills/wayground-math-quiz/references/`.
4. If `AGENTS.local.md` exists, read it for private local paths and workspace-only rules. Never commit that file.

## Authoritative sources

- `skills/wayground-math-quiz/` is the canonical skill source.
- `plugins/wayground-math-quiz/skills/wayground-math-quiz/` is a generated mirror for the Codex plugin.
- `quiz.json` is the canonical source of truth for each quiz job.
- Wayground is a publication target, not the only storage location.

Edit the canonical skill first, then run:

```powershell
pwsh -NoProfile -File ".\scripts\sync-plugin.ps1"
pwsh -NoProfile -File ".\scripts\verify-repository.ps1"
```

Do not hand-edit the plugin mirror and canonical skill independently.

## Non-negotiable rules

- Treat source papers as read-only.
- Work in a separate job directory.
- Preserve complex formulas, diagrams, tables, and printed choices as images when text conversion could alter meaning.
- Inspect every crop visually. OCR may assist discovery but must not silently rewrite mathematics.
- When the image contains printed choices, use fixed Wayground choices `A/B/C/D`.
- Set `shuffleQuestions=false` and `shuffleOptions=false` for fixed image-choice quizzes.
- Create an answer-position plan before finalizing the quiz. Position counts may differ by at most one.
- Run strict validation and create an offline preview before publishing.
- After publishing, re-open the resource and save structured evidence plus screenshots.
- Never store cookies, browser profiles, passwords, tokens, API keys, student names, or private account data.
- Never commit copyrighted source papers, large source-derived screenshot collections, or private classroom records.

## Publishing boundary

- Use `wayground-mcp` only when the available connector fully supports every question.
- Use `wayground-browser` for images, equation-editor content, and unsupported fields.
- Browser automation requires the user's already logged-in session.
- Do not change public visibility, create a class assignment, start a live session, send notifications, or delete resources without explicit authorization.
- Wayground may default both `隨機出題` and `隨機播放答案` to on in assignment/session setup. Turn both off for fixed printed choices.
- If only resource publication is authorized, exit assignment/session setup without clicking the final Assign/Start action.

## Cross-agent compatibility

The skill must remain usable by:

- Claude Code
- Codex／ChatGPT App
- Google AntiGravity
- OpenCode

Keep the skill self-contained and avoid agent-specific absolute paths. Use relative paths from the skill or repository root. PowerShell examples are required for Windows, while the Node CLI and Python pipeline should remain cross-platform where practical.

Install or verify all four roots with:

```powershell
pwsh -NoProfile -File ".\scripts\sync-four-agents.ps1"
```

## Validation

Before declaring work complete:

1. Run `node ".\skills\wayground-math-quiz\scripts\quiz.mjs" --help`.
2. Run `pwsh -NoProfile -File ".\scripts\sync-plugin.ps1"`.
3. Run `pwsh -NoProfile -File ".\scripts\verify-repository.ps1"`.
4. Confirm `git status --short` contains only intended public files.
5. Scan staged files for local paths, account identifiers, credentials, student data, and source-derived copyrighted material.

## Repository scope

Public files include code, schemas, agent instructions, reusable documentation, and original examples.

Keep these outside version control:

- local quiz jobs and publication evidence;
- local source-bank indexes and statistics;
- browser screenshots and session artifacts;
- `README.local.md`, `AGENTS.local.md`, and other `*.local.*` files;
- environment files, logs, caches, and dependency folders.
