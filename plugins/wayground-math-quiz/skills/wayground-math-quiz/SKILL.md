---
name: wayground-math-quiz
description: Build reproducible Wayground math quizzes from Word/PDF papers or original visual questions, including deterministic diagrams, image answer options, and AI-background narrative puzzles with locked math overlays. Use when an agent needs to ingest or crop a source paper, design a visual-spec, compose and validate question images, balance answers, preview a canonical quiz.json, export a sharing package, or publish through a Wayground connector or logged-in browser.
---

# Wayground Math Quiz

## Overview

Turn a Word/PDF math paper into a traceable, image-first Wayground quiz. Keep the source layout intact, store all decisions in a platform-neutral `quiz.json`, validate before publishing, and preserve a local evidence trail.

## Non-negotiable rules

1. Treat original papers as read-only. Work in a separate job directory.
2. Use `quiz.json` as the canonical source of truth. Never make Wayground the only copy.
3. For formulas, geometry figures, number lines, charts, or complex tables, prefer one image containing the full stem and its printed choices.
4. When choices are embedded in the image, create Wayground choices as `A`, `B`, `C`, `D` and turn answer shuffling off.
5. Generate and verify a balanced answer-position plan before finalizing the images. A difference of at most one between positions is balanced.
6. Do not store cookies, access tokens, browser profiles, student names, or private account data in the skill or job package.
7. Review every crop and answer. Do not rely on OCR to rewrite mathematical notation.
8. Publish only after strict validation passes. After publishing, verify the question count, images, correct answers, order, and settings in Wayground.
9. For AI-composite questions, let AI create only the narrative background; render every answer-bearing number, label, equation, count, dimension, and clue position deterministically.

## Choose the publishing route

- Use `wayground-mcp` only for text-only multiple-choice questions that fit the available connector schema.
- Use `wayground-browser` for question images, equation-editor content, or any feature not exposed by the connector.
- Use `export-only` when another person or agent will publish later.

Read [references/wayground-capabilities.md](references/wayground-capabilities.md) when deciding. Read [references/browser-publishing.md](references/browser-publishing.md) before any browser write.
Read [references/mcp-server.md](references/mcp-server.md) when exposing this workflow as tools to another agent.

## Workflow

### 1. Check the runtime

From the skill directory:

```powershell
node ".\scripts\quiz.mjs" doctor
```

If Python is not on `PATH`, pass it explicitly:

```powershell
node ".\scripts\quiz.mjs" doctor --python "C:\path\to\python.exe"
```

Required for PDF/image work:

- Node.js 18 or newer
- Python 3.10 or newer with Pillow
- `pdftoppm`
- For Word input: LibreOffice, or Microsoft Word on Windows

### 2. Create a job and ingest the source

```powershell
node ".\scripts\quiz.mjs" init --out "D:\quiz-jobs\unit-01" --title "七年級第一冊複習"
node ".\scripts\quiz.mjs" ingest --input "D:\sources\第一冊.pdf" --out "D:\quiz-jobs\unit-01" --dpi 220
```

The ingest command produces:

- `normalized\source.pdf`
- `pages\page-001.png`, `page-002.png`, ...
- `source.json` with the source hash and page metadata
- `crop-plan.json` if one does not already exist

For Word, the pipeline first converts to PDF so equations and layout are preserved.

### 3. Inspect pages and describe crop regions

Use the agent's image-viewing ability to inspect the generated page images. Create one `crop-plan.json` entry per desired question. Use normalized coordinates (`unit: "ratio"`) when possible so the plan remains stable if the DPI changes.

Do not crop the answer key or page header into a question. Include all information a student needs, including printed answer choices. Add a short meaningful `alt` description and an exact `answer`.

Before deciding answers, generate a balanced target:

```powershell
node ".\scripts\quiz.mjs" answer-plan --count 15 --options 4 --seed "book1-v1" --out "D:\quiz-jobs\unit-01\answer-plan.json"
```

For a 15-question, four-choice quiz, the expected position counts are a permutation of `4, 4, 4, 3`.

See [references/quiz-schema.md](references/quiz-schema.md) for the crop-plan and quiz fields.

### 4. Crop and assemble

```powershell
node ".\scripts\quiz.mjs" crop --job "D:\quiz-jobs\unit-01"
node ".\scripts\quiz.mjs" assemble --job "D:\quiz-jobs\unit-01" --grade-start 7 --grade-end 7 --subject "數學"
```

Open the crop images and check:

- no formula, diagram label, or choice is cut off;
- text is readable on a student device;
- answer-key marks are absent;
- the crop contains no unrelated question.

If a crop is poor, edit `crop-plan.json`, rerun `crop --force`, and inspect again.

### 4A. Create original visual questions

Use the visual factory for diagrams, comics, escape-room clues, maps, shops, matchstick patterns, or image answer options. Read [references/visual-question-factory.md](references/visual-question-factory.md) before creating an AI-composite question.

```powershell
node ".\scripts\quiz.mjs" visual-init --out "D:\quiz-jobs\visual-01\visual\q001\visual-spec.json" --id "q001" --title "視覺題" --mode "deterministic"
node ".\scripts\quiz.mjs" compose --spec "D:\quiz-jobs\visual-01\visual\q001\visual-spec.json" --out "D:\quiz-jobs\visual-01\visual\q001\final.png"
node ".\scripts\quiz.mjs" visual-validate --spec "D:\quiz-jobs\visual-01\visual\q001\visual-spec.json" --image "D:\quiz-jobs\visual-01\visual\q001\final.png" --strict
```

Choose one mode:

- `deterministic`: exact diagrams, number lines, balance scales, charts, or matchsticks;
- `source-crop`: reviewed fragments from an original paper;
- `ai-composite`: AI background plus deterministic math overlays.

Keep the selected AI background, final prompt, locked facts, final PNG, and validation report. Do not ask another agent to regenerate a confirmed image.

### 5. Validate and preview

```powershell
node ".\scripts\quiz.mjs" validate --quiz "D:\quiz-jobs\unit-01\quiz.json" --strict --report "D:\quiz-jobs\unit-01\validation.json"
node ".\scripts\quiz.mjs" preview --quiz "D:\quiz-jobs\unit-01\quiz.json" --out "D:\quiz-jobs\unit-01\preview.html"
```

Strict validation must report zero errors. Fix warnings that affect students or traceability. The preview is self-contained; image-first mathematics remains accurate without an online equation renderer.

### 6. Prepare publication

Text-only connector payload:

```powershell
node ".\scripts\quiz.mjs" publish --adapter wayground-mcp --quiz "D:\quiz-jobs\unit-01\quiz.json" --out "D:\quiz-jobs\unit-01\export\wayground-mcp.json"
```

Image-question browser plan and resumable state:

```powershell
node ".\scripts\quiz.mjs" publish --adapter wayground-browser --quiz "D:\quiz-jobs\unit-01\quiz.json" --out "D:\quiz-jobs\unit-01\export\wayground-browser.json" --state "D:\quiz-jobs\unit-01\publication-state.json"
```

Portable package:

```powershell
node ".\scripts\quiz.mjs" publish --adapter export-only --quiz "D:\quiz-jobs\unit-01\quiz.json" --out "D:\quiz-jobs\unit-01\export\package"
```

`publish` creates a plan or package; it does not save login credentials. The agent then executes the matching connector or browser workflow.

### 7. Publish and verify

For `wayground-mcp`, call the available Wayground quiz-creation tool with the generated payload. The current connector is suitable only when every question is text-only.

For `wayground-browser`, control the agent environment's already open, logged-in browser and follow [references/browser-publishing.md](references/browser-publishing.md). Do not launch or copy a persistent browser profile. Do not delete overlay DOM or force-click blocked controls. Confirm explicit resource-publication authorization and the visible teacher account, then record `publication-state --action authorize --resource-only true --account-confirmed true` before adding questions.

Use `correctAnswerIds` as authoritative; `correctAnswerIndices` are zero-based cross-checks. The browser plan records strict-validation time plus `quiz.json` and image hashes. Treat each question as an atomic transaction. After saving it, visibly confirm that the resource question count increased by one, confirm the image and correct answer, capture a screenshot, and record a `publication-state --action mark` checkpoint. Stop on the first unverified step and resume from the first pending question.

After publishing, re-open the specific resource. Use `publication-state --action finalize` to create `publication-evidence.json`, then run:

```powershell
node ".\scripts\quiz.mjs" verify --quiz "D:\quiz-jobs\unit-01\quiz.json" --evidence "D:\quiz-jobs\unit-01\publication-evidence.json"
```

A dashboard, login, create, My Library, or draft-list URL is never publication evidence. Verification requires the exact title, exact question order/count, one checkpoint per question, loaded images, confirmed answers, a resource-specific URL, and two distinct screenshots.

## Agent handoff contract

When another agent continues the job, provide only:

- the skill directory or installed skill name;
- the job directory;
- the source path;
- the requested question count and cognitive-level split;
- the publishing adapter;
- whether final Wayground publication is authorized.

Do not hand off browser cookies or account secrets. A new agent should start from `quiz.json`, run strict validation, and inspect the most recent evidence before editing.

## Resource map

- `scripts/quiz.mjs`: main cross-platform CLI
- `mcp/server.mjs`: dependency-free thin MCP wrapper over the CLI
- `scripts/document_pipeline.py`: PDF rendering and image cropping
- `scripts/visual_pipeline.py`: deterministic visual composition and strict visual checks
- `scripts/word_to_pdf.ps1`: Microsoft Word conversion fallback
- `scripts/run.ps1`: PowerShell launcher
- `assets/quiz.schema.json`: canonical JSON Schema
- `assets/visual-spec.schema.json`: visual-question composition schema
- `assets/config.example.json`: path-free configuration example
- `references/quiz-schema.md`: field and crop-plan reference
- `references/visual-question-factory.md`: deterministic and AI-composite visual workflow
- `references/wayground-capabilities.md`: supported routes and platform constraints
- `references/browser-publishing.md`: safe browser publishing and verification
- `references/mcp-server.md`: standalone MCP setup and security boundary
