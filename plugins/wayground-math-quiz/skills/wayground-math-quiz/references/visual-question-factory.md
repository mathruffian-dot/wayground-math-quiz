# Visual question factory

Use this workflow when a question is easier to understand as a diagram, scene, comic, puzzle, or image-based option.

## Contents

- [Choose a production mode](#choose-a-production-mode)
- [Protect mathematical facts](#protect-mathematical-facts)
- [Create and render a visual spec](#create-and-render-a-visual-spec)
- [Original visual question sources](#original-visual-question-sources)
- [AI-composite workflow](#ai-composite-workflow)
- [Visual spec fields](#visual-spec-fields)
- [Layer types](#layer-types)
- [Validation](#validation)
- [Quiz integration](#quiz-integration)
- [Handoff and sharing](#handoff-and-sharing)

## Choose a production mode

| Mode | Use for | Authority |
|---|---|---|
| `deterministic` | equations, number lines, balance scales, geometry, charts, matchsticks | `visual-spec.json` |
| `source-crop` | an original Word/PDF question whose layout must remain exact | original crop |
| `ai-composite` | shops, maps, comics, escape rooms, narrative scenes | AI background plus deterministic overlays |

Do not use image generation for a simple diagram that SVG, Canvas, or the compositor can draw exactly.

## Protect mathematical facts

Every value that affects the answer belongs in `lockedFacts`.

Allowed `renderedBy` values:

- `overlay`: rendered by the deterministic compositor;
- `source`: preserved from a reviewed source crop.

Never mark a mathematical fact as AI-rendered. AI must not decide:

- object counts;
- prices or dimensions;
- equations or labels;
- parallel, perpendicular, equal-length, or angle relationships;
- clue order or answer position.

For counting puzzles, generate or draw one object and repeat it deterministically. For hidden-clue puzzles, place each clue at a declared coordinate instead of asking AI to hide it.

## Create and render a visual spec

Create a candidate:

```powershell
node ".\scripts\quiz.mjs" visual-init `
  --out ".\visual\q001\visual-spec.json" `
  --id "q001" `
  --title "校園商店價格謎題" `
  --mode "ai-composite"
```

Edit the spec, then render:

```powershell
node ".\scripts\quiz.mjs" compose `
  --spec ".\visual\q001\visual-spec.json" `
  --out ".\visual\q001\final.png"
```

Validate before adding the image to `quiz.json`:

```powershell
node ".\scripts\quiz.mjs" visual-validate `
  --spec ".\visual\q001\visual-spec.json" `
  --image ".\visual\q001\final.png" `
  --strict `
  --report ".\visual\q001\visual-validation.json"
```

Strict validation requires:

- one declared correct answer;
- `mathChecked=true`;
- `visualChecked=true`;
- `ambiguityChecked=true`;
- all image dependencies present;
- final PNG dimensions matching the canvas;
- AI composites to contain a provider, final prompt, and locked facts.

## Original visual question sources

Strict quiz validation requires every question to link to one entry in `sourceDocuments`, including an original question with no Word or PDF source.

Use this convention:

- original deterministic or AI-composite question: use the finalized `visual-spec.json` as the source document;
- source-crop question: use the original Word/PDF file as the source document and keep `page` or `reference` on the question;
- give each source a stable id such as `original-q001`;
- after editing the source file, refresh its SHA-256 before strict validation.

PowerShell:

```powershell
$specHash = (Get-FileHash -Algorithm SHA256 `
  ".\visual\q001\visual-spec.json").Hash.ToLowerInvariant()
```

Root-level source entry:

```json
{
  "id": "original-q001",
  "name": "原創視覺題 q001",
  "path": "visual/q001/visual-spec.json",
  "sha256": "paste-the-64-character-spec-hash-here"
}
```

Question-level link:

```json
{
  "source": {
    "documentId": "original-q001",
    "reference": "原創／箭頭步道總長度"
  }
}
```

Do not use a fake all-zero hash. The hash is the reproducibility link between the reviewed source and the published question.
## AI-composite workflow

1. Write the answer, distractors, and locked facts before generating an image.
2. Ask the image model for atmosphere and negative space only.
3. Explicitly forbid text, numbers, equations, prices, codes, labels, logos, and answer choices.
4. Save the selected AI image beside `visual-spec.json`.
5. Put the exact final prompt in `provenance.prompt`.
6. Add all mathematical information as deterministic layers.
7. Render the final PNG.
8. Inspect the PNG at approximately the size students will see.
9. Set all three review flags only after inspection.
10. Preserve the selected AI background and final PNG; do not regenerate a confirmed question during handoff.

Create a prompt handoff:

```powershell
node ".\scripts\quiz.mjs" prompt-pack `
  --spec ".\visual\q001\visual-spec.json" `
  --out ".\export\q001-生圖交接包.md"
```

An agent without image generation can still:

- reuse the saved background;
- edit deterministic overlays;
- render and validate the final PNG;
- publish through the browser adapter.

## Visual spec fields

```json
{
  "schemaVersion": "1.0.0",
  "id": "q001",
  "title": "校園商店價格謎題",
  "mode": "ai-composite",
  "canvas": {
    "width": 1200,
    "height": 900,
    "background": "#f8fafc"
  },
  "alt": "商店背景上有兩筆購買紀錄，求飲料與三明治總價。",
  "answer": {
    "optionIds": ["A", "B", "C", "D"],
    "correctOptionId": "D",
    "unique": true
  },
  "provenance": {
    "provider": "image generation tool",
    "prompt": "Final prompt used for the selected background"
  },
  "lockedFacts": [
    {
      "id": "equation-one",
      "value": "2d+s=110",
      "renderedBy": "overlay"
    }
  ],
  "review": {
    "mathChecked": true,
    "visualChecked": true,
    "ambiguityChecked": true
  },
  "layers": []
}
```

Paths are relative to the directory containing the visual spec. Absolute paths and paths that escape the visual folder are rejected.

## Layer types

Layer order is back to front: later entries are drawn over earlier entries.

| Type | Required or common fields | Optional fields |
|---|---|---|
| `image` | `path`, `x`, `y`, `width`, `height` | `fit`: `cover`, `contain`, or `stretch`; `opacity`: 0 to 1 |
| `text` | `text`, `x`, `y`, `fontSize` | `fill`, `font`, `weight`, `maxWidth`, `lineSpacing`, `anchor`, `valign`, `background`, `backgroundRadius`, `padding`, `textStroke`, `textStrokeWidth` |
| `rect` | `x`, `y`, `width`, `height`, `fill` | `radius`, `stroke`, `strokeWidth` |
| `line` | `x1`, `y1`, `x2`, `y2`, `stroke` | `strokeWidth`, `arrowStart`, `arrowEnd` |
| `circle` | center `x`, center `y`, `radius` | `fill`, `stroke`, `strokeWidth` |
| `ellipse` | `x`, `y`, `width`, `height` | `fill`, `stroke`, `strokeWidth` |
| `polygon` | `points`: array of `[x,y]` | `fill`, `stroke`, `strokeWidth` |

Text alignment values:

- `anchor`: `left` (default), `center`, or `right`;
- `valign`: `top` (default), `middle`, or `bottom`;
- `weight`: use `regular` or `bold` unless a specific font file is supplied;
- colors accept `#RRGGBB` or `#RRGGBBAA`.

Example arrow and centered label:

```json
[
  {
    "type": "line",
    "x1": 180,
    "y1": 420,
    "x2": 620,
    "y2": 420,
    "stroke": "#e76f51",
    "strokeWidth": 10,
    "arrowEnd": true
  },
  {
    "type": "text",
    "x": 400,
    "y": 350,
    "text": "向右 5 格",
    "fontSize": 38,
    "weight": "bold",
    "anchor": "center",
    "valign": "middle",
    "background": "#ffffffdd",
    "backgroundRadius": 10,
    "padding": 12
  }
]
```

Use a 1200 × 900 canvas as the default Wayground-friendly 4:3 format. Keep critical text large and avoid placing essential content near the outer edge.

## Validation

Machine validation cannot prove that a visual is pedagogically unambiguous. Perform all three reviews:

1. **Math review**: recalculate the answer independently from `lockedFacts`.
2. **Visual review**: inspect the final PNG, not only the source background.
3. **Ambiguity review**: ask whether an unintended object, crop, label, or visual convention supports another answer.

OCR may check text presence but is not the mathematical source of truth.

## Quiz integration

Add a complete question object to `questions`. This example includes every question-level field required by strict validation:

```json
{
  "id": "q001",
  "type": "image-mcq",
  "cognitiveLevel": "應用",
  "stem": {
    "type": "image",
    "image": "visual/q001/final.png",
    "alt": "箭頭步道依序標示六、四、二、三公尺，求總長度。"
  },
  "options": [
    { "id": "A", "content": "12" },
    { "id": "B", "content": "13" },
    { "id": "C", "content": "15" },
    { "id": "D", "content": "18" }
  ],
  "correctOptionIds": ["C"],
  "source": {
    "documentId": "original-q001",
    "reference": "原創／箭頭步道總長度"
  },
  "visualSpec": "visual/q001/visual-spec.json",
  "explanation": "6+4+2+3=15，所以選 C。",
  "tags": ["視覺題", "deterministic"]
}
```

The root `sourceDocuments` array must contain the matching `original-q001` entry described above. A complete validated repository example is `examples/visual-question-factory/quiz.json`.

For image answer options, provide both fields:

```json
{
  "id": "A",
  "content": "A",
  "image": "visual/q001/option-a.png",
  "imageAlt": "Option A shows two connected squares"
}
```

The preview, browser plan, and portable package retain option images. The portable package also copies the visual spec and its image dependencies.

## Handoff and sharing

Hand off:

- `quiz.json`;
- final PNG files;
- `visual-spec.json`;
- selected AI backgrounds or source crops;
- prompt packs;
- strict visual-validation reports;
- the self-contained preview.

Do not require another agent to regenerate a confirmed AI image. Regeneration is a creative revision, not an installation or publication step.
