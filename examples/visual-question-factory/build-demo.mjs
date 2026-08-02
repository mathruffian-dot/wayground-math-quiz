#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const VISUAL_ROOT = join(ROOT, "visual");
const OPTION_IDS = ["A", "B", "C", "D"];
const PROMPTS = {
  q004: `Use case: illustration-story
Asset type: background for a junior-high Wayground math visual puzzle
Primary request: Create a friendly contemporary school convenience-store interior as a clean educational illustration. Show a tidy counter, shelves, warm lighting, and subtle depth, but leave a large uncluttered central counter area and generous negative space where deterministic math cards will later be overlaid.
Style/medium: polished flat 2.5D editorial illustration, appealing to Taiwanese junior-high students
Composition/framing: landscape 4:3, front-facing counter, clear central area, no important object at the outer edges
Color palette: warm teal, amber, cream, coral accents
Constraints: background atmosphere only; no readable text, no numbers, no prices, no equations, no logos, no brands, no watermark; do not create price labels or mathematical clues; keep all key mathematical information absent so it can be added later by code
Avoid: crowded shelves, tiny repeated objects that invite counting, distorted hands, illegible signs, embedded answer choices`,
  q005: `Use case: illustration-story
Asset type: background for a junior-high Wayground escape-room math puzzle
Primary request: Create a friendly mystery-library room designed for a classroom puzzle. Include bookshelves, a wooden desk, a closed door, a decorative wall clock without visible numbers, and a central empty corkboard or wall panel with generous clear space where exact clue cards and a code lock will later be overlaid.
Style/medium: polished flat 2.5D educational illustration, intriguing but not scary
Composition/framing: landscape 4:3, straight-on room view, central board clearly visible, balanced negative space
Lighting/mood: warm evening lamplight, curious and inviting
Color palette: navy, burgundy, warm wood, gold accents
Constraints: atmosphere only; no readable text, no numbers, no equations, no codes, no logos, no watermark; do not insert hidden clues; every mathematical clue will be added later by code
Avoid: horror imagery, clutter that invites accidental counting, distorted perspective, illegible signs, embedded answer choices`,
  q006: `Use case: illustration-story
Asset type: four-panel background for a junior-high Wayground math comic question
Primary request: Create a coherent four-panel classroom comic strip with the same two Taiwanese junior-high students discussing a math problem at a desk. Panels should show: noticing a puzzle, trying an idea, comparing two approaches, and reaching a conclusion. Leave every speech bubble completely blank and large enough for deterministic equation text to be overlaid later.
Style/medium: polished colorful educational comic, clean line art, expressive but natural characters
Composition/framing: landscape 4:3 overall canvas, four equal panels in a two-by-two grid, clear white blank speech bubbles, consistent characters and clothing across all panels
Color palette: bright classroom blue, yellow, coral, white
Constraints: no readable text, no letters, no numbers, no equations, no logos, no watermark; blank speech bubbles only; mathematical statements will be added later by code
Avoid: gibberish writing, chalkboard equations, changing character identity, overcrowded panels, embedded answer choices`,
};

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function text(x, y, value, size = 42, extra = {}) {
  return {
    type: "text",
    x,
    y,
    text: value,
    fontSize: size,
    fill: "#172033",
    ...extra,
  };
}

function rect(x, y, width, height, fill, extra = {}) {
  return {
    type: "rect",
    x,
    y,
    width,
    height,
    fill,
    ...extra,
  };
}

function line(x1, y1, x2, y2, stroke = "#172033", strokeWidth = 5, extra = {}) {
  return {
    type: "line",
    x1,
    y1,
    x2,
    y2,
    stroke,
    strokeWidth,
    ...extra,
  };
}

function circle(x, y, radius, fill, extra = {}) {
  return {
    type: "circle",
    x,
    y,
    radius,
    fill,
    ...extra,
  };
}

function optionCards(labels, y = 740) {
  const values = Object.entries(labels);
  return values.flatMap(([id, value], index) => {
    const x = 60 + index * 285;
    return [
      rect(x, y, 250, 108, "#ffffffee", {
        radius: 18,
        stroke: "#cbd5e1",
        strokeWidth: 3,
      }),
      circle(x + 40, y + 54, 25, "#6c4df6"),
      text(x + 40, y + 54, id, 30, {
        anchor: "center",
        valign: "middle",
        fill: "#ffffff",
        weight: "bold",
      }),
      text(x + 142, y + 54, value, 38, {
        anchor: "center",
        valign: "middle",
        weight: "bold",
      }),
    ];
  });
}

function baseSpec({
  id,
  title,
  mode,
  alt,
  correctOptionId,
  lockedFacts,
  layers,
  prompt = "",
}) {
  return {
    schemaVersion: "1.0.0",
    id,
    title,
    mode,
    canvas: {
      width: 1200,
      height: 900,
      background: "#f8fafc",
    },
    alt,
    answer: {
      optionIds: OPTION_IDS,
      correctOptionId,
      unique: true,
    },
    provenance: {
      provider: mode === "ai-composite" ? "OpenAI built-in image generation" : "deterministic-renderer",
      prompt,
      generatedAt: mode === "ai-composite" ? "2026-07-24" : "",
      notes:
        mode === "ai-composite"
          ? "AI only generated the narrative background. All math facts are deterministic overlays."
          : "All mathematical content is rendered from visual-spec.json.",
    },
    lockedFacts,
    review: {
      mathChecked: true,
      visualChecked: true,
      ambiguityChecked: true,
      reviewer: "candidate-demo",
      notes: "Original public-safe demonstration question.",
    },
    layers,
  };
}

function balanceSpec() {
  const layers = [
    rect(0, 0, 1200, 900, "#edf6ff"),
    text(600, 52, "天平保持平衡，求 x 的值", 50, {
      anchor: "center",
      weight: "bold",
      fill: "#173b63",
    }),
    line(600, 240, 600, 620, "#355070", 16),
    rect(520, 610, 160, 35, "#355070", { radius: 12 }),
    line(255, 345, 945, 345, "#355070", 14),
    circle(600, 345, 26, "#f6bd60", { stroke: "#9c6a16", strokeWidth: 4 }),
    line(300, 345, 235, 535, "#7b8794", 5),
    line(300, 345, 365, 535, "#7b8794", 5),
    line(900, 345, 835, 535, "#7b8794", 5),
    line(900, 345, 965, 535, "#7b8794", 5),
    line(210, 535, 390, 535, "#355070", 9),
    line(810, 535, 990, 535, "#355070", 9),
  ];
  [230, 285, 340].forEach((x) => {
    layers.push(rect(x, 455, 48, 64, "#5aa9e6", { radius: 8 }));
    layers.push(
      text(x + 24, 487, "x", 30, {
        anchor: "center",
        valign: "middle",
        weight: "bold",
        fill: "#ffffff",
      })
    );
  });
  layers.push(rect(270, 395, 62, 50, "#f6bd60", { radius: 10 }));
  layers.push(
    text(301, 420, "6", 30, {
      anchor: "center",
      valign: "middle",
      weight: "bold",
    })
  );
  layers.push(rect(858, 435, 86, 84, "#f28482", { radius: 12 }));
  layers.push(
    text(901, 477, "24", 34, {
      anchor: "center",
      valign: "middle",
      weight: "bold",
      fill: "#ffffff",
    })
  );
  layers.push(
    text(600, 675, "圖中代表 3x + 6 = 24", 36, {
      anchor: "center",
      fill: "#334155",
    })
  );
  layers.push(...optionCards({ A: "6", B: "8", C: "10", D: "12" }));
  return baseSpec({
    id: "q001",
    title: "天平方程式",
    mode: "deterministic",
    alt: "平衡天平左盤有三個 x 方塊與重量六，右盤重量二十四，選出 x 的值。",
    correctOptionId: "A",
    lockedFacts: [
      { id: "equation", value: "3x+6=24", renderedBy: "overlay" },
      { id: "solution", value: 6, renderedBy: "overlay" },
    ],
    layers,
  });
}

function numberLineSpec() {
  const layers = [
    rect(0, 0, 1200, 900, "#fffaf0"),
    text(600, 55, "從 -3 出發，向右移動 5 格，會停在哪裡？", 47, {
      anchor: "center",
      weight: "bold",
      fill: "#643b14",
    }),
    line(120, 445, 1080, 445, "#2f4858", 8, {
      arrowStart: true,
      arrowEnd: true,
    }),
  ];
  for (let value = -6; value <= 6; value += 1) {
    const x = 160 + (value + 6) * 73;
    layers.push(line(x, 420, x, 470, "#2f4858", value === 0 ? 7 : 4));
    layers.push(
      text(x, 490, String(value), 28, {
        anchor: "center",
        fill: "#2f4858",
        weight: value === -3 || value === 2 ? "bold" : "regular",
      })
    );
  }
  const xStart = 160 + 3 * 73;
  const xEnd = 160 + 8 * 73;
  layers.push(circle(xStart, 445, 16, "#e63946"));
  layers.push(circle(xEnd, 445, 16, "#2a9d8f"));
  layers.push(line(xStart, 325, xEnd, 325, "#e76f51", 10, { arrowEnd: true }));
  layers.push(
    text((xStart + xEnd) / 2, 255, "向右 5 格", 38, {
      anchor: "center",
      weight: "bold",
      fill: "#e76f51",
      background: "#ffffffdd",
      padding: 12,
    })
  );
  layers.push(...optionCards({ A: "-8", B: "2", C: "-2", D: "8" }));
  return baseSpec({
    id: "q002",
    title: "數線移動",
    mode: "deterministic",
    alt: "數線上從負三向右移動五格的箭頭，選出終點。",
    correctOptionId: "B",
    lockedFacts: [
      { id: "start", value: -3, renderedBy: "overlay" },
      { id: "move", value: 5, renderedBy: "overlay" },
      { id: "endpoint", value: 2, renderedBy: "overlay" },
    ],
    layers,
  });
}

function matchstickStage(x, y, squares, layers) {
  const side = 86;
  for (let index = 0; index < squares; index += 1) {
    const left = x + index * side;
    layers.push(line(left, y, left + side, y, "#d97706", 11));
    layers.push(line(left, y + side, left + side, y + side, "#d97706", 11));
    if (index === 0) layers.push(line(left, y, left, y + side, "#d97706", 11));
    layers.push(line(left + side, y, left + side, y + side, "#d97706", 11));
  }
}

function matchstickSpec() {
  const layers = [
    rect(0, 0, 1200, 900, "#f7fee7"),
    text(600, 45, "相連正方形的火柴棒規律", 49, {
      anchor: "center",
      weight: "bold",
      fill: "#365314",
    }),
    text(600, 112, "第 5 個圖形需要幾根火柴棒？", 40, {
      anchor: "center",
      fill: "#4d7c0f",
    }),
  ];
  matchstickStage(130, 285, 1, layers);
  matchstickStage(455, 285, 2, layers);
  matchstickStage(810, 285, 3, layers);
  layers.push(text(173, 400, "第1個：4根", 30, { anchor: "center" }));
  layers.push(text(541, 400, "第2個：7根", 30, { anchor: "center" }));
  layers.push(text(939, 400, "第3個：10根", 30, { anchor: "center" }));
  layers.push(
    text(600, 545, "每增加一個正方形，只多 3 根火柴棒", 36, {
      anchor: "center",
      background: "#ffffffdd",
      padding: 16,
      backgroundRadius: 14,
      fill: "#3f6212",
    })
  );
  layers.push(...optionCards({ A: "13", B: "15", C: "16", D: "20" }));
  return baseSpec({
    id: "q003",
    title: "火柴棒規律",
    mode: "deterministic",
    alt: "依序呈現一個、兩個、三個相連正方形及火柴棒數量，推算第五個圖形。",
    correctOptionId: "C",
    lockedFacts: [
      { id: "sequence", value: [4, 7, 10], renderedBy: "overlay" },
      { id: "increment", value: 3, renderedBy: "overlay" },
      { id: "stage5", value: 16, renderedBy: "overlay" },
    ],
    layers,
  });
}

function shopSpec() {
  const layers = [
    { type: "image", path: "background-ai.png", x: 0, y: 0, width: 1200, height: 900, fit: "cover" },
    rect(30, 25, 1140, 115, "#102a43dd", { radius: 22 }),
    text(600, 82, "校園商店的套餐價格謎題", 50, {
      anchor: "center",
      valign: "middle",
      weight: "bold",
      fill: "#ffffff",
    }),
    rect(80, 205, 490, 190, "#ffffffee", {
      radius: 22,
      stroke: "#0f766e",
      strokeWidth: 4,
    }),
    text(325, 245, "購買紀錄一", 30, {
      anchor: "center",
      weight: "bold",
      fill: "#0f766e",
    }),
    text(325, 300, "2杯飲料 + 1份三明治", 30, {
      anchor: "center",
      weight: "bold",
      maxWidth: 430,
    }),
    text(325, 350, "= 110 元", 34, {
      anchor: "center",
      weight: "bold",
    }),
    rect(630, 205, 490, 190, "#ffffffee", {
      radius: 22,
      stroke: "#c2410c",
      strokeWidth: 4,
    }),
    text(875, 245, "購買紀錄二", 30, {
      anchor: "center",
      weight: "bold",
      fill: "#c2410c",
    }),
    text(875, 300, "1杯飲料 + 2份三明治", 30, {
      anchor: "center",
      weight: "bold",
      maxWidth: 430,
    }),
    text(875, 350, "= 130 元", 34, {
      anchor: "center",
      weight: "bold",
    }),
    rect(175, 455, 850, 155, "#fff7edee", {
      radius: 24,
      stroke: "#f59e0b",
      strokeWidth: 5,
    }),
    text(600, 505, "買 1 杯飲料和 1 份三明治，應付多少元？", 38, {
      anchor: "center",
      weight: "bold",
      maxWidth: 780,
    }),
    text(600, 568, "所有價格都以圖上的購買紀錄為準", 27, {
      anchor: "center",
      fill: "#9a3412",
    }),
    ...optionCards({ A: "60元", B: "70元", C: "75元", D: "80元" }),
  ];
  return baseSpec({
    id: "q004",
    title: "校園商店價格謎題",
    mode: "ai-composite",
    alt: "校園商店背景上疊有兩筆飲料與三明治購買紀錄，求各買一份的總價。",
    correctOptionId: "D",
    lockedFacts: [
      { id: "equation1", value: "2d+s=110", renderedBy: "overlay" },
      { id: "equation2", value: "d+2s=130", renderedBy: "overlay" },
      { id: "drink", value: 30, renderedBy: "overlay" },
      { id: "sandwich", value: 50, renderedBy: "overlay" },
      { id: "sum", value: 80, renderedBy: "overlay" },
    ],
    layers,
    prompt: PROMPTS.q004,
  });
}

function escapeSpec() {
  const layers = [
    { type: "image", path: "background-ai.png", x: 0, y: 0, width: 1200, height: 900, fit: "cover" },
    rect(35, 25, 1130, 100, "#0f172add", { radius: 20 }),
    text(600, 75, "解開三張線索卡，找出門鎖密碼", 46, {
      anchor: "center",
      valign: "middle",
      weight: "bold",
      fill: "#ffffff",
    }),
  ];
  const clues = [
    { x: 390, y: 190, title: "線索一", value: "-4 + 9" },
    { x: 620, y: 190, title: "線索二", value: "2³" },
    { x: 850, y: 190, title: "線索三", value: "18 ÷ 6" },
  ];
  clues.forEach((clue) => {
    layers.push(
      rect(clue.x, clue.y, 190, 220, "#fffaf0ee", {
        radius: 18,
        stroke: "#8b5e34",
        strokeWidth: 4,
      })
    );
    layers.push(
      text(clue.x + 95, clue.y + 42, clue.title, 28, {
        anchor: "center",
        weight: "bold",
        fill: "#7c2d12",
      })
    );
    layers.push(
      text(clue.x + 95, clue.y + 122, clue.value, 42, {
        anchor: "center",
        weight: "bold",
      })
    );
    layers.push(
      text(clue.x + 95, clue.y + 178, "答案是一位密碼", 22, {
        anchor: "center",
        fill: "#57534e",
      })
    );
  });
  layers.push(
    text(660, 460, "依照「線索一、二、三」的順序輸入", 34, {
      anchor: "center",
      weight: "bold",
      fill: "#ffffff",
      background: "#0f172acc",
      padding: 15,
      backgroundRadius: 15,
    })
  );
  layers.push(...optionCards({ A: "583", B: "538", C: "853", D: "835" }));
  return baseSpec({
    id: "q005",
    title: "密室三線索",
    mode: "ai-composite",
    alt: "神祕圖書室背景上有三張依序排列的算式線索卡，組合答案成三位數密碼。",
    correctOptionId: "A",
    lockedFacts: [
      { id: "clue1", value: 5, renderedBy: "overlay" },
      { id: "clue2", value: 8, renderedBy: "overlay" },
      { id: "clue3", value: 3, renderedBy: "overlay" },
      { id: "code", value: 583, renderedBy: "overlay" },
    ],
    layers,
    prompt: PROMPTS.q005,
  });
}

function comicSpec() {
  const layers = [
    { type: "image", path: "background-ai.png", x: 0, y: 0, width: 1200, height: 900, fit: "cover" },
    text(45, 45, "某數的3倍再加2，結果是20。", 24, {
      maxWidth: 245,
      weight: "bold",
      fill: "#111827",
    }),
    text(340, 45, "設未知數為 x。", 26, {
      maxWidth: 220,
      weight: "bold",
      fill: "#111827",
    }),
    text(635, 45, "女生：先乘3，再加2。", 24, {
      maxWidth: 245,
      weight: "bold",
      fill: "#111827",
    }),
    text(930, 45, "男生：先加2，再乘3。", 24, {
      maxWidth: 230,
      weight: "bold",
      fill: "#111827",
    }),
    text(45, 505, "女生：3x + 2 = 20", 24, {
      maxWidth: 250,
      weight: "bold",
      fill: "#111827",
    }),
    text(340, 505, "男生：3(x + 2) = 20", 23, {
      maxWidth: 245,
      weight: "bold",
      fill: "#111827",
    }),
    text(635, 505, "哪一個列式符合題意？", 23, {
      maxWidth: 245,
      weight: "bold",
      fill: "#111827",
    }),
    text(930, 505, "請選出正確判斷。", 24, {
      maxWidth: 220,
      weight: "bold",
      fill: "#111827",
    }),
    rect(35, 755, 1130, 130, "#ffffffee", {
      radius: 18,
      stroke: "#2563eb",
      strokeWidth: 4,
    }),
    text(600, 775, "誰列的一元一次方程式正確？", 24, {
      anchor: "center",
      weight: "bold",
      fill: "#1e40af",
    }),
  ];
  const labels = {
    A: "兩人都正確",
    B: "女生正確",
    C: "男生正確",
    D: "兩人都錯",
  };
  Object.entries(labels).forEach(([id, value], index) => {
    const x = 70 + index * 275;
    layers.push(circle(x + 20, 842, 20, "#6c4df6"));
    layers.push(
      text(x + 20, 842, id, 23, {
        anchor: "center",
        valign: "middle",
        weight: "bold",
        fill: "#ffffff",
      })
    );
    layers.push(
      text(x + 55, 842, value, 25, {
        valign: "middle",
        weight: "bold",
      })
    );
  });
  return baseSpec({
    id: "q006",
    title: "漫畫列式判斷",
    mode: "ai-composite",
    alt: "四格課堂漫畫中，題意為某數的三倍再加二等於二十，兩位學生提出不同方程式。",
    correctOptionId: "B",
    lockedFacts: [
      { id: "story", value: "three-times-number-plus-two-is-twenty", renderedBy: "overlay" },
      { id: "girl-equation", value: "3x+2=20", renderedBy: "overlay" },
      { id: "boy-equation", value: "3(x+2)=20", renderedBy: "overlay" },
      { id: "judgement", value: "girl-correct", renderedBy: "overlay" },
    ],
    layers,
    prompt: PROMPTS.q006,
  });
}

const specs = [
  balanceSpec(),
  numberLineSpec(),
  matchstickSpec(),
  shopSpec(),
  escapeSpec(),
  comicSpec(),
];

for (const spec of specs) {
  writeJson(join(VISUAL_ROOT, spec.id, "visual-spec.json"), spec);
}

const sourceSha256 = createHash("sha256")
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest("hex");
const cognitiveLevels = ["記憶理解", "記憶理解", "應用", "應用", "應用", "應用"];
const answerIds = ["A", "B", "C", "D", "A", "B"];
const references = [
  "原創示範／天平方程式",
  "原創示範／數線移動",
  "原創示範／火柴棒規律",
  "原創示範／校園商店價格謎題",
  "原創示範／密室三線索",
  "原創示範／漫畫列式判斷",
];

const quiz = {
  schemaVersion: "1.0.0",
  id: "visual-question-factory-demo-v03",
  title: "視覺題工廠：六種圖片題示範",
  subject: "數學",
  grade: { start: 7, end: 7 },
  language: "zh-TW",
  settings: {
    shuffleQuestions: false,
    shuffleOptions: false,
    balancedAnswerPositions: true,
  },
  sourceDocuments: [
    {
      id: "original-demo",
      name: "原創視覺題示範",
      path: "build-demo.mjs",
      sha256: sourceSha256,
    },
  ],
  questions: specs.map((spec, index) => ({
    id: spec.id,
    type: "image-mcq",
    cognitiveLevel: cognitiveLevels[index],
    stem: {
      type: "image",
      image: `visual/${spec.id}/final.png`,
      alt: spec.alt,
    },
    options: OPTION_IDS.map((id) => ({ id, content: id })),
    correctOptionIds: [answerIds[index]],
    source: {
      documentId: "original-demo",
      reference: references[index],
    },
    visualSpec: `visual/${spec.id}/visual-spec.json`,
    explanation: [
      "3x+6=24，所以 x=6。",
      "-3+5=2。",
      "每增加一個正方形多三根，第五個是 4+4×3=16。",
      "解聯立關係可得飲料30元、三明治50元，合計80元。",
      "三張線索依序為5、8、3，因此密碼是583。",
      "題意是先將未知數乘三再加二，所以女生的 3x+2=20 正確。",
    ][index],
    tags: ["視覺題", spec.mode, "v0.3-demo"],
  })),
  createdAt: "2026-07-24T00:00:00.000Z",
};

writeJson(join(ROOT, "quiz.json"), quiz);
writeJson(join(ROOT, "answer-plan.json"), {
  schemaVersion: "1.0.0",
  count: 6,
  optionCount: 4,
  balanced: true,
  distribution: [
    { label: "A", count: 2 },
    { label: "B", count: 2 },
    { label: "C", count: 1 },
    { label: "D", count: 1 },
  ],
  sequence: answerIds.map((answer, index) => ({
    question: index + 1,
    answer,
  })),
});

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      root: ROOT,
      visualSpecs: specs.length,
      quiz: join(ROOT, "quiz.json"),
    },
    null,
    2
  )}\n`
);
