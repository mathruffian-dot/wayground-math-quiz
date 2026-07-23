# Quiz and crop-plan reference

## Canonical quiz

`quiz.json` is the source of truth. Paths to images are relative to the directory containing `quiz.json`.

Required top-level fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | Currently `1.0.0` |
| `id` | Stable local quiz identifier |
| `title` | Teacher-facing quiz title |
| `subject` | Usually `數學` |
| `grade.start`, `grade.end` | Wayground grade range |
| `language` | Usually `zh-TW` |
| `settings` | Question/answer shuffle and balance requirements |
| `sourceDocuments` | Source IDs and SHA-256 hashes |
| `questions` | Ordered questions |

Each multiple-choice question contains:

```json
{
  "id": "q001",
  "type": "image-mcq",
  "cognitiveLevel": "記憶理解",
  "stem": {
    "type": "image",
    "image": "assets/q001.png",
    "alt": "整數加減運算選擇題，含四個選項"
  },
  "options": [
    { "id": "A", "content": "A" },
    { "id": "B", "content": "B" },
    { "id": "C", "content": "C" },
    { "id": "D", "content": "D" }
  ],
  "correctOptionIds": ["C"],
  "source": {
    "documentId": "source",
    "page": 3,
    "bbox": {
      "unit": "ratio",
      "x": 0.06,
      "y": 0.18,
      "width": 0.88,
      "height": 0.21
    },
    "reference": "第一冊／整數運算／原卷第 3 頁第 2 題"
  },
  "explanation": "",
  "tags": ["第一冊", "整數運算"]
}
```

For `text-mcq`, use `stem.type: "text"` and provide `stem.text`. Preserve optional LaTeX source in `stem.latex` or an option's `latex`; do not assume every publishing adapter can render it.

## Crop plan

`crop-plan.json` is written by an agent after visually inspecting the rendered pages:

```json
{
  "schemaVersion": "1.0.0",
  "sourceManifest": "source.json",
  "crops": [
    {
      "id": "q001",
      "page": 1,
      "bbox": {
        "unit": "ratio",
        "x": 0.05,
        "y": 0.10,
        "width": 0.90,
        "height": 0.18
      },
      "padding": 12,
      "trimWhitespace": false,
      "answer": "A",
      "cognitiveLevel": "記憶理解",
      "alt": "負數與數線選擇題，含數線圖與四個選項",
      "sourceRef": "第一冊／數與數線／第 1 頁第 1 題",
      "tags": ["第一冊", "數與數線"]
    }
  ]
}
```

Coordinate rules:

- `unit: "ratio"`: all four numbers must be between 0 and 1.
- `unit: "pixel"`: numbers are pixel coordinates in the rendered page image.
- `x`, `y` are the top-left corner.
- `width`, `height` are the crop size.
- `padding` adds white pixels around the crop after optional whitespace trim.

Every crop should include the complete printed stem and choices. The Wayground options then become fixed labels `A` through `D`.

## Publication evidence

After publishing, create:

```json
{
  "schemaVersion": "1.0.0",
  "adapter": "wayground-browser",
  "resourceUrl": "https://wayground.com/...",
  "verifiedAt": "2026-07-23T12:34:56.000Z",
  "questionCount": 15,
  "shuffleOptions": false,
  "screenshots": [
    "evidence/published-overview.png",
    "evidence/question-check.png"
  ],
  "notes": "Checked all question images and answer positions."
}
```

Do not include cookies, tokens, student data, or a browser-profile directory.
