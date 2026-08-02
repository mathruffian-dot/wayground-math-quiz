#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = dirname(SCRIPT_DIR);
const PIPELINE = join(SCRIPT_DIR, "document_pipeline.py");
const VISUAL_PIPELINE = join(SCRIPT_DIR, "visual_pipeline.py");
const WORD_HELPER = join(SCRIPT_DIR, "word_to_pdf.ps1");
const QUIZ_SCHEMA = join(SKILL_DIR, "assets", "quiz.schema.json");
const VISUAL_SCHEMA = join(SKILL_DIR, "assets", "visual-spec.schema.json");
const SCHEMA_VERSION = "1.0.0";

class CliError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseArgv(argv) {
  const command = argv[0] ?? "help";
  const options = {};
  const positionals = [];
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    let rawKey;
    let value;
    if (equals >= 0) {
      rawKey = token.slice(2, equals);
      value = token.slice(equals + 1);
    } else {
      rawKey = token.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        index += 1;
      } else {
        value = true;
      }
    }
    options[camelCase(rawKey)] = value;
  }
  return { command, options, positionals };
}

function requireOption(options, key, label = `--${key}`) {
  const value = options[camelCase(key)];
  if (value === undefined || value === "") {
    throw new CliError(`Missing required option: ${label}`);
  }
  return String(value);
}

function numberOption(options, key, fallback) {
  const value = options[camelCase(key)];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CliError(`--${key} must be a number`);
  }
  return parsed;
}

function booleanOption(options, key, fallback = false) {
  const value = options[camelCase(key)];
  if (value === undefined) return fallback;
  if (value === true) return true;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new CliError(`--${key} must be true or false`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new CliError(`File not found: ${path}`);
    }
    throw new CliError(`Unable to read JSON ${path}: ${error.message}`);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function storedPath(baseDir, candidate) {
  const absolute = isAbsolute(String(candidate))
    ? resolve(String(candidate))
    : safeResolve(baseDir, String(candidate));
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new CliError(`Evidence file not found: ${absolute}`);
  }
  const rel = relative(baseDir, absolute);
  if (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
    return rel.split(sep).join("/");
  }
  return absolute;
}

function safeResolve(root, candidate) {
  const rootPath = resolve(root);
  const target = resolve(rootPath, candidate);
  const rel = relative(rootPath, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new CliError(`Path escapes its allowed directory: ${candidate}`);
  }
  return target;
}

function ensureWritableTarget(path, force) {
  if (existsSync(path) && !force) {
    throw new CliError(`Output already exists: ${path}. Use --force to replace it.`);
  }
}

function commandWorks(command, prefixArgs = []) {
  const result = spawnSync(command, [...prefixArgs, "--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0;
}

function findPython(options) {
  const explicit = options.python ? String(options.python) : "";
  const configured = process.env.WAYGROUND_PYTHON ?? "";
  const candidates = [
    explicit && { command: explicit, prefix: [] },
    configured && { command: configured, prefix: [] },
    { command: "python", prefix: [] },
    { command: "python3", prefix: [] },
    process.platform === "win32" && { command: "py", prefix: ["-3"] },
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (commandWorks(candidate.command, candidate.prefix)) {
      return candidate;
    }
  }
  return null;
}

function appendOption(args, name, value) {
  if (value !== undefined && value !== "" && value !== false) {
    args.push(`--${name}`, String(value));
  }
}

function runPipeline(subcommand, pipelineArgs, options) {
  const python = findPython(options);
  if (!python) {
    throw new CliError(
      "Python 3 was not found. Pass --python or set WAYGROUND_PYTHON."
    );
  }
  const args = [...python.prefix, PIPELINE, subcommand, ...pipelineArgs];
  const result = spawnSync(python.command, args, {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PYTHONUTF8: "1" },
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) {
    throw new CliError(`Unable to start document pipeline: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new CliError(detail || `Document pipeline failed with code ${result.status}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new CliError(`Document pipeline returned invalid JSON:\n${result.stdout}`);
  }
}

function runVisualPipeline(subcommand, pipelineArgs, options) {
  const python = findPython(options);
  if (!python) {
    throw new CliError(
      "Python 3 was not found. Pass --python or set WAYGROUND_PYTHON."
    );
  }
  const args = [...python.prefix, VISUAL_PIPELINE, subcommand, ...pipelineArgs];
  const result = spawnSync(python.command, args, {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PYTHONUTF8: "1" },
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) {
    throw new CliError(`Unable to start visual pipeline: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new CliError(detail || `Visual pipeline failed with code ${result.status}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new CliError(`Visual pipeline returned invalid JSON:\n${result.stdout}`);
  }
}
function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function slug(value) {
  const normalized = String(value)
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || "quiz";
}

function cropPlanTemplate() {
  return {
    schemaVersion: SCHEMA_VERSION,
    sourceManifest: "source.json",
    crops: [
      {
        id: "q001",
        page: 1,
        bbox: {
          unit: "ratio",
          x: 0.05,
          y: 0.1,
          width: 0.9,
          height: 0.18,
        },
        padding: 12,
        trimWhitespace: false,
        answer: "A",
        cognitiveLevel: "記憶理解",
        alt: "請描述本題的數學內容與圖形",
        sourceRef: "冊別／單元／原卷頁碼與題號",
        tags: [],
      },
    ],
  };
}

function visualSpecTemplate(options) {
  const mode = String(options.mode ?? "deterministic");
  if (!["deterministic", "source-crop", "ai-composite"].includes(mode)) {
    throw new CliError("--mode must be deterministic, source-crop, or ai-composite");
  }
  const id = String(options.id ?? "visual-q001");
  const title = String(options.title ?? "未命名視覺題");
  const width = numberOption(options, "width", 1200);
  const height = numberOption(options, "height", 900);
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    title,
    mode,
    canvas: {
      width,
      height,
      background: "#f8fafc",
    },
    alt: "請描述學生需要從圖片讀取的數學資訊",
    answer: {
      optionIds: ["A", "B", "C", "D"],
      correctOptionId: "A",
      unique: false,
    },
    provenance:
      mode === "ai-composite"
        ? {
            provider: "請填寫圖片生成工具",
            prompt: "請貼上最後使用的完整生圖提示詞",
            generatedAt: "",
            notes: "AI 只產生情境背景；數學事實由 overlay 圖層加入。",
          }
        : {
            provider: mode === "source-crop" ? "source-document" : "deterministic-renderer",
            prompt: "",
            generatedAt: "",
            notes: "",
          },
    lockedFacts: [],
    review: {
      mathChecked: false,
      visualChecked: false,
      ambiguityChecked: false,
      reviewer: "",
      notes: "",
    },
    layers: [
      {
        type: "text",
        x: width / 2,
        y: height / 2,
        anchor: "center",
        valign: "middle",
        text: "請編輯 visual-spec.json",
        fontSize: 52,
        weight: "bold",
        fill: "#334155",
      },
    ],
  };
}

function commandVisualInit(options) {
  const output = resolve(requireOption(options, "out"));
  ensureWritableTarget(output, booleanOption(options, "force", false));
  const spec = visualSpecTemplate(options);
  writeJson(output, spec);
  printJson({ ok: true, visualSpec: output, mode: spec.mode });
  return spec;
}

function commandCompose(options) {
  const spec = resolve(requireOption(options, "spec"));
  const output = resolve(requireOption(options, "out"));
  const args = ["--spec", spec, "--out", output];
  if (booleanOption(options, "force", false)) args.push("--force");
  const result = runVisualPipeline("compose", args, options);
  printJson(result);
  return result;
}

function commandVisualValidate(options) {
  const spec = resolve(requireOption(options, "spec"));
  const args = ["--spec", spec];
  if (options.image) args.push("--image", resolve(String(options.image)));
  if (booleanOption(options, "strict", false)) args.push("--strict");
  if (options.report) args.push("--report", resolve(String(options.report)));
  const result = runVisualPipeline("validate", args, options);
  process.stdout.write(
    `${result.valid ? "PASS" : "FAIL"}: visual spec, ${result.errorCount} errors, ${result.warningCount} warnings\n`
  );
  for (const issue of result.issues ?? []) {
    process.stdout.write(
      `[${issue.severity.toUpperCase()}] ${issue.code} ${issue.path}: ${issue.message}\n`
    );
  }
  return result;
}

function commandPromptPack(options) {
  const specPath = resolve(requireOption(options, "spec"));
  const output = resolve(requireOption(options, "out"));
  ensureWritableTarget(output, booleanOption(options, "force", false));
  const spec = readJson(specPath);
  const facts = (spec.lockedFacts ?? [])
    .map(
      (fact) =>
        `- ${String(fact.id ?? "fact")}: ${JSON.stringify(fact.value)}（${String(
          fact.renderedBy ?? "overlay"
        )}）${fact.description ? `—${fact.description}` : ""}`
    )
    .join("\n");
  const markdown = `# ${String(spec.title ?? spec.id ?? "視覺題")}生圖交接包

- 規格檔：${basename(specPath)}
- 模式：${String(spec.mode ?? "")}
- 圖片用途：Wayground 數學題情境背景
- 圖片替代文字：${String(spec.alt ?? "")}

## 最終生圖提示詞

${String(spec.provenance?.prompt ?? "此題不需要 AI 生圖。")}

## 不可交給 AI 決定的數學事實

${facts || "- 無；本題由確定性繪圖完成。"}

## 合成規則

- AI 圖只作為背景或敘事素材。
- 數字、算式、價格、幾何關係、物件精確數量與答案線索由 overlay 圖層加入。
- 以 visual-spec.json 與最終 PNG 為準，不重新生成已確認的最終圖片。
- 發布前執行 compose、visual-validate --strict、quiz validate --strict 與 preview。
`;
  writeText(output, markdown);
  printJson({ ok: true, promptPack: output, lockedFactCount: spec.lockedFacts?.length ?? 0 });
  return output;
}
function commandInit(options) {
  const output = resolve(requireOption(options, "out"));
  mkdirSync(output, { recursive: true });
  for (const directory of ["normalized", "pages", "assets", "export", "evidence"]) {
    mkdirSync(join(output, directory), { recursive: true });
  }
  const jobPath = join(output, "job.json");
  if (!existsSync(jobPath) || booleanOption(options, "force", false)) {
    writeJson(jobPath, {
      schemaVersion: SCHEMA_VERSION,
      title: String(options.title ?? "未命名數學測驗"),
      createdAt: new Date().toISOString(),
      workflow: "image-first-wayground",
    });
  }
  const cropPlanPath = join(output, "crop-plan.json");
  if (!existsSync(cropPlanPath)) {
    writeJson(cropPlanPath, cropPlanTemplate());
  }
  const result = {
    ok: true,
    job: output,
    files: {
      job: jobPath,
      cropPlan: cropPlanPath,
    },
  };
  printJson(result);
  return result;
}

function commandDoctor(options) {
  const python = findPython(options);
  const result = {
    ok: false,
    node: {
      ok: Number(process.versions.node.split(".")[0]) >= 18,
      version: process.versions.node,
      executable: process.execPath,
    },
    python: {
      ok: Boolean(python),
      command: python?.command ?? "",
    },
    documentPipeline: null,
  };
  if (python) {
    const args = ["--word-helper", WORD_HELPER];
    appendOption(args, "pdftoppm", options.pdftoppm);
    appendOption(args, "office", options.office);
    result.documentPipeline = runPipeline("doctor", args, options);
  }
  result.ok =
    result.node.ok &&
    Boolean(result.documentPipeline?.python?.ok) &&
    Boolean(result.documentPipeline?.pillow?.ok) &&
    Boolean(result.documentPipeline?.pdftoppm?.ok);
  printJson(result);
  if (!result.ok) {
    throw new CliError(
      "Runtime check failed. Node, Python, Pillow, and pdftoppm are required.",
      1
    );
  }
  return result;
}

function commandIngest(options) {
  const input = resolve(requireOption(options, "input"));
  const output = resolve(requireOption(options, "out"));
  mkdirSync(output, { recursive: true });
  const dpi = numberOption(options, "dpi", 220);
  const args = [
    "--input",
    input,
    "--out",
    output,
    "--dpi",
    String(dpi),
    "--word-helper",
    WORD_HELPER,
  ];
  appendOption(args, "pdftoppm", options.pdftoppm);
  appendOption(args, "office", options.office);
  if (booleanOption(options, "force", false)) args.push("--force");
  const manifest = runPipeline("ingest", args, options);
  const cropPlanPath = join(output, "crop-plan.json");
  if (!existsSync(cropPlanPath)) {
    const template = cropPlanTemplate();
    template.crops = [];
    writeJson(cropPlanPath, template);
  }
  printJson({
    ok: true,
    sourceManifest: join(output, "source.json"),
    pageCount: manifest.pageCount,
    pages: manifest.pages.map((page) => join(output, page.image)),
    conversionBackend: manifest.conversionBackend,
  });
  return manifest;
}

function commandCrop(options) {
  const job = resolve(requireOption(options, "job"));
  const args = ["--job", job];
  appendOption(args, "plan", options.plan ? resolve(String(options.plan)) : undefined);
  if (booleanOption(options, "force", false)) args.push("--force");
  const report = runPipeline("crop", args, options);
  printJson({
    ok: true,
    count: report.count,
    report: join(job, "crop-results.json"),
    outputs: report.crops.map((crop) => join(job, crop.output)),
  });
  return report;
}

function normalizeOptions(rawOptions) {
  const source =
    Array.isArray(rawOptions) && rawOptions.length >= 2
      ? rawOptions
      : ["A", "B", "C", "D"];
  return source.map((option, index) => {
    if (typeof option === "string" || typeof option === "number") {
      const content = String(option);
      return { id: content || String.fromCharCode(65 + index), content };
    }
    const id = String(option.id ?? String.fromCharCode(65 + index));
    const normalized = {
      id,
      content: String(option.content ?? id),
    };
    if (option.latex) normalized.latex = String(option.latex);
    if (option.image) normalized.image = String(option.image);
    if (option.imageAlt) normalized.imageAlt = String(option.imageAlt);
    return normalized;
  });
}

function resolveAnswerId(rawAnswer, options) {
  if (rawAnswer === undefined || rawAnswer === null || rawAnswer === "") return null;
  if (Number.isInteger(rawAnswer)) {
    return options[rawAnswer]?.id ?? null;
  }
  const value = String(rawAnswer).trim();
  const direct = options.find(
    (option) => option.id.toLowerCase() === value.toLowerCase()
  );
  if (direct) return direct.id;
  if (/^\d+$/.test(value)) {
    const index = Number(value);
    return options[index]?.id ?? options[index - 1]?.id ?? null;
  }
  return null;
}

function commandAssemble(options) {
  const job = resolve(requireOption(options, "job"));
  const cropResultsPath = options.crops
    ? resolve(String(options.crops))
    : join(job, "crop-results.json");
  const sourcePath = join(job, "source.json");
  const jobMetadataPath = join(job, "job.json");
  const cropResults = readJson(cropResultsPath);
  const source = readJson(sourcePath);
  const jobMetadata = existsSync(jobMetadataPath) ? readJson(jobMetadataPath) : {};
  const title = String(options.title ?? jobMetadata.title ?? "未命名數學測驗");
  const subject = String(options.subject ?? "數學");
  const gradeStart = options.gradeStart ?? 7;
  const gradeEnd = options.gradeEnd ?? gradeStart;
  const output = options.out ? resolve(String(options.out)) : join(job, "quiz.json");
  const force = booleanOption(options, "force", false);
  ensureWritableTarget(output, force);

  if (!Array.isArray(cropResults.crops) || cropResults.crops.length === 0) {
    throw new CliError("crop-results.json contains no crops");
  }
  const questions = cropResults.crops.map((crop, index) => {
    const metadata = crop.metadata ?? {};
    const questionOptions = normalizeOptions(metadata.options);
    const answerId = resolveAnswerId(metadata.answer, questionOptions);
    const question = {
      id: String(crop.id ?? `q${String(index + 1).padStart(3, "0")}`),
      type: "image-mcq",
      cognitiveLevel: String(metadata.cognitiveLevel ?? "未分類"),
      stem: {
        type: "image",
        image: String(crop.output),
        alt: String(metadata.alt ?? `第 ${index + 1} 題題目與選項圖片`),
      },
      options: questionOptions,
      correctOptionIds: answerId ? [answerId] : [],
      source: {
        documentId: String(source.id ?? "source"),
        page: Number(crop.page),
        bbox: crop.sourceBbox ?? {},
        reference: String(metadata.sourceRef ?? ""),
      },
      explanation: String(metadata.explanation ?? ""),
      tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [],
    };
    if (metadata.prompt) question.stem.text = String(metadata.prompt);
    return question;
  });

  const quiz = {
    schemaVersion: SCHEMA_VERSION,
    id: String(
      options.id ??
        `${slug(title)}-${sha256Text(`${source.originalSha256}:${title}`).slice(0, 8)}`
    ),
    title,
    subject,
    grade: {
      start: /^\d+$/.test(String(gradeStart)) ? Number(gradeStart) : String(gradeStart),
      end: /^\d+$/.test(String(gradeEnd)) ? Number(gradeEnd) : String(gradeEnd),
    },
    language: String(options.language ?? "zh-TW"),
    settings: {
      shuffleQuestions: booleanOption(options, "shuffle-questions", false),
      shuffleOptions: booleanOption(options, "shuffle-options", false),
      balancedAnswerPositions: booleanOption(
        options,
        "balanced-answer-positions",
        true
      ),
    },
    sourceDocuments: [
      {
        id: String(source.id ?? "source"),
        name: String(source.originalName ?? basename(source.originalInput ?? "source")),
        path: String(source.originalInput ?? ""),
        sha256: String(source.originalSha256 ?? ""),
        normalizedPdfSha256: String(source.normalizedPdfSha256 ?? ""),
      },
    ],
    questions,
    createdAt: new Date().toISOString(),
  };
  writeJson(output, quiz);
  printJson({
    ok: true,
    quiz: output,
    questionCount: questions.length,
    incompleteAnswers: questions.filter(
      (question) => question.correctOptionIds.length !== 1
    ).map((question) => question.id),
  });
  return quiz;
}

function findForbiddenKeys(value, currentPath = "$", found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      findForbiddenKeys(item, `${currentPath}[${index}]`, found)
    );
    return found;
  }
  if (!value || typeof value !== "object") return found;
  const forbidden = /^(cookie|cookies|sessionToken|accessToken|refreshToken|password|apiKey|authorization)$/i;
  for (const [key, item] of Object.entries(value)) {
    const itemPath = `${currentPath}.${key}`;
    if (forbidden.test(key)) found.push(itemPath);
    findForbiddenKeys(item, itemPath, found);
  }
  return found;
}

function validateQuizData(quiz, baseDir, strict = false) {
  const issues = [];
  const add = (severity, code, path, message) =>
    issues.push({ severity, code, path, message });
  const requiredStrings = ["schemaVersion", "id", "title", "subject", "language"];
  for (const key of requiredStrings) {
    if (typeof quiz?.[key] !== "string" || !quiz[key].trim()) {
      add("error", "required-string", `$.${key}`, `${key} must be a non-empty string`);
    }
  }
  if (quiz?.schemaVersion && quiz.schemaVersion !== SCHEMA_VERSION) {
    add(
      "error",
      "schema-version",
      "$.schemaVersion",
      `Expected ${SCHEMA_VERSION}, received ${quiz.schemaVersion}`
    );
  }
  if (!quiz?.grade || quiz.grade.start === undefined || quiz.grade.end === undefined) {
    add("error", "grade", "$.grade", "grade.start and grade.end are required");
  }
  const settings = quiz?.settings;
  for (const key of [
    "shuffleQuestions",
    "shuffleOptions",
    "balancedAnswerPositions",
  ]) {
    if (typeof settings?.[key] !== "boolean") {
      add("error", "setting", `$.settings.${key}`, `${key} must be boolean`);
    }
  }
  if (!Array.isArray(quiz?.sourceDocuments)) {
    add("error", "sources", "$.sourceDocuments", "sourceDocuments must be an array");
  }
  const sourceIds = new Set();
  for (const [index, source] of (quiz?.sourceDocuments ?? []).entries()) {
    const sourcePath = `$.sourceDocuments[${index}]`;
    if (!source?.id) add("error", "source-id", `${sourcePath}.id`, "Source id is required");
    if (source?.id) sourceIds.add(String(source.id));
    if (!/^[a-f0-9]{64}$/i.test(String(source?.sha256 ?? ""))) {
      add(
        strict ? "error" : "warning",
        "source-hash",
        `${sourcePath}.sha256`,
        "Source SHA-256 should contain 64 hexadecimal characters"
      );
    }
  }
  if (!Array.isArray(quiz?.questions) || quiz.questions.length === 0) {
    add("error", "questions", "$.questions", "At least one question is required");
  }

  const questionIds = new Set();
  const answerPositions = [];
  let maximumOptionCount = 0;
  let hasImageQuestion = false;
  for (const [index, question] of (quiz?.questions ?? []).entries()) {
    const qPath = `$.questions[${index}]`;
    const id = String(question?.id ?? "");
    if (!id) add("error", "question-id", `${qPath}.id`, "Question id is required");
    if (questionIds.has(id)) {
      add("error", "duplicate-question-id", `${qPath}.id`, `Duplicate id: ${id}`);
    }
    questionIds.add(id);
    if (!["image-mcq", "text-mcq"].includes(question?.type)) {
      add("error", "question-type", `${qPath}.type`, "Unsupported question type");
    }
    if (
      typeof question?.cognitiveLevel !== "string" ||
      !question.cognitiveLevel.trim() ||
      question.cognitiveLevel === "未分類"
    ) {
      add(
        strict ? "error" : "warning",
        "cognitive-level",
        `${qPath}.cognitiveLevel`,
        "Set an explicit cognitive level"
      );
    }
    if (!Array.isArray(question?.options) || question.options.length < 2) {
      add("error", "options", `${qPath}.options`, "At least two options are required");
      continue;
    }
    maximumOptionCount = Math.max(maximumOptionCount, question.options.length);
    const optionIds = new Set();
    question.options.forEach((option, optionIndex) => {
      const optionPath = `${qPath}.options[${optionIndex}]`;
      const optionId = String(option?.id ?? "");
      if (!optionId) add("error", "option-id", `${optionPath}.id`, "Option id is required");
      if (optionIds.has(optionId)) {
        add(
          "error",
          "duplicate-option-id",
          `${optionPath}.id`,
          `Duplicate option id: ${optionId}`
        );
      }
      optionIds.add(optionId);
      if (
        typeof option?.content !== "string" ||
        (!option.content.trim() && !option.image && !option.latex)
      ) {
        add(
          "error",
          "option-content",
          `${optionPath}.content`,
          "Option content, image, or LaTeX is required"
        );
      }
      if (option?.image) {
        validateAssetPath(option.image, baseDir, `${optionPath}.image`, add);
        if (!String(option.imageAlt ?? "").trim()) {
          add(
            strict ? "error" : "warning",
            "option-image-alt",
            `${optionPath}.imageAlt`,
            "Option images need concise alt text"
          );
        }
      }
    });
    const correctIds = question?.correctOptionIds;
    if (!Array.isArray(correctIds) || correctIds.length === 0) {
      add(
        "error",
        "correct-answer",
        `${qPath}.correctOptionIds`,
        "At least one correct option is required"
      );
    } else {
      for (const correctId of correctIds) {
        if (!optionIds.has(String(correctId))) {
          add(
            "error",
            "unknown-correct-option",
            `${qPath}.correctOptionIds`,
            `Correct option does not exist: ${correctId}`
          );
        }
      }
      if (correctIds.length === 1) {
        answerPositions.push(
          question.options.findIndex(
            (option) => String(option.id) === String(correctIds[0])
          )
        );
      } else {
        add(
          "warning",
          "multiple-correct",
          `${qPath}.correctOptionIds`,
          "Answer-position balancing applies only to single-answer questions"
        );
      }
    }
    if (question?.visualSpec) {
      const visualPath = `${qPath}.visualSpec`;
      if (isAbsolute(String(question.visualSpec))) {
        add("error", "absolute-visual-spec", visualPath, "visualSpec must be relative to quiz.json");
      } else {
        try {
          const resolvedVisualSpec = safeResolve(baseDir, String(question.visualSpec));
          if (!existsSync(resolvedVisualSpec) || !statSync(resolvedVisualSpec).isFile()) {
            add("error", "missing-visual-spec", visualPath, `Visual spec not found: ${resolvedVisualSpec}`);
          } else if (extname(resolvedVisualSpec).toLowerCase() !== ".json") {
            add("error", "visual-spec-format", visualPath, "visualSpec must point to a JSON file");
          }
        } catch (error) {
          add("error", "unsafe-visual-spec", visualPath, error.message);
        }
      }
    }

    if (!question?.source?.documentId) {
      add("error", "source-link", `${qPath}.source`, "source.documentId is required");
    } else if (
      sourceIds.size > 0 &&
      !sourceIds.has(String(question.source.documentId))
    ) {
      add(
        "error",
        "unknown-source",
        `${qPath}.source.documentId`,
        "Question references an unknown source document"
      );
    }
    if (!question?.source?.reference) {
      add(
        "warning",
        "source-reference",
        `${qPath}.source.reference`,
        "Add a human-readable source reference"
      );
    }

    if (question?.type === "image-mcq") {
      hasImageQuestion = true;
      if (question?.stem?.type !== "image" || !question.stem.image) {
        add(
          "error",
          "image-stem",
          `${qPath}.stem`,
          "image-mcq requires stem.type=image and stem.image"
        );
      } else {
        validateAssetPath(question.stem.image, baseDir, `${qPath}.stem.image`, add);
      }
      if (!question?.stem?.alt || !String(question.stem.alt).trim()) {
        add("error", "image-alt", `${qPath}.stem.alt`, "Image alt text is required");
      }
    } else if (
      question?.type === "text-mcq" &&
      !String(question?.stem?.text ?? "").trim() &&
      !String(question?.stem?.latex ?? "").trim()
    ) {
      add(
        "error",
        "text-stem",
        `${qPath}.stem`,
        "text-mcq requires stem.text or stem.latex"
      );
    }
  }

  if (hasImageQuestion && settings?.shuffleOptions !== false) {
    add(
      "error",
      "image-option-shuffle",
      "$.settings.shuffleOptions",
      "Image questions with embedded choices require shuffleOptions=false"
    );
  }
  if (
    settings?.balancedAnswerPositions === true &&
    answerPositions.length === (quiz?.questions?.length ?? 0) &&
    maximumOptionCount > 0
  ) {
    const counts = Array.from({ length: maximumOptionCount }, () => 0);
    for (const position of answerPositions) {
      if (position >= 0) counts[position] += 1;
    }
    const difference = Math.max(...counts) - Math.min(...counts);
    if (difference > 1) {
      add(
        "error",
        "answer-balance",
        "$.questions",
        `Answer positions are not balanced: ${counts.join(", ")}`
      );
    }
  }
  for (const keyPath of findForbiddenKeys(quiz)) {
    add("error", "secret-field", keyPath, "Secret/session fields are not allowed");
  }

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const distribution = Array.from({ length: maximumOptionCount }, (_, index) => ({
    position: index + 1,
    label: String.fromCharCode(65 + index),
    count: answerPositions.filter((position) => position === index).length,
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    valid: errors.length === 0,
    strict,
    questionCount: quiz?.questions?.length ?? 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    answerDistribution: distribution,
    issues,
  };
}

function validateAssetPath(asset, baseDir, issuePath, add) {
  if (typeof asset !== "string" || !asset.trim()) {
    add("error", "asset-path", issuePath, "Asset path must be a non-empty string");
    return;
  }
  if (isAbsolute(asset)) {
    add(
      "error",
      "absolute-asset-path",
      issuePath,
      "Canonical asset paths must be relative to quiz.json"
    );
    return;
  }
  let path;
  try {
    path = safeResolve(baseDir, asset);
  } catch (error) {
    add("error", "unsafe-asset-path", issuePath, error.message);
    return;
  }
  if (!existsSync(path) || !statSync(path).isFile()) {
    add("error", "missing-asset", issuePath, `Asset not found: ${path}`);
    return;
  }
  const extension = extname(path).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp", ".svg"].includes(extension)) {
    add("warning", "asset-format", issuePath, `Unusual image format: ${extension}`);
  }
  const size = statSync(path).size;
  if (size > 5 * 1024 * 1024) {
    add(
      "warning",
      "asset-size",
      issuePath,
      `Image is ${(size / 1024 / 1024).toFixed(1)} MB; upload may be slow`
    );
  }
}

function printValidation(report) {
  process.stdout.write(
    `${report.valid ? "PASS" : "FAIL"}: ${report.questionCount} questions, ` +
      `${report.errorCount} errors, ${report.warningCount} warnings\n`
  );
  if (report.answerDistribution.length) {
    process.stdout.write(
      `Answer positions: ${report.answerDistribution
        .map((item) => `${item.label}=${item.count}`)
        .join(", ")}\n`
    );
  }
  for (const issue of report.issues) {
    process.stdout.write(
      `[${issue.severity.toUpperCase()}] ${issue.code} ${issue.path}: ${issue.message}\n`
    );
  }
}

function commandValidate(options) {
  const quizPath = resolve(requireOption(options, "quiz"));
  const quiz = readJson(quizPath);
  const report = validateQuizData(
    quiz,
    dirname(quizPath),
    booleanOption(options, "strict", false)
  );
  if (options.report) writeJson(resolve(String(options.report)), report);
  printValidation(report);
  if (!report.valid) throw new CliError("Quiz validation failed.", 1);
  return report;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function mimeFor(path) {
  const extension = extname(path).toLowerCase();
  return {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  }[extension] ?? "application/octet-stream";
}

function fileDataUri(path) {
  return `data:${mimeFor(path)};base64,${readFileSync(path).toString("base64")}`;
}

function renderQuestionHtml(question, index, baseDir) {
  let stem;
  if (question.type === "image-mcq") {
    const imagePath = safeResolve(baseDir, question.stem.image);
    stem = `<img class="question-image" src="${fileDataUri(
      imagePath
    )}" alt="${escapeHtml(question.stem.alt ?? "")}">`;
  } else {
    const text = question.stem?.text ?? question.stem?.latex ?? "";
    stem = `<div class="text-stem">${escapeHtml(text).replaceAll("\n", "<br>")}</div>`;
  }
  const optionsHtml = question.options
    .map((option) => {
      let content = escapeHtml(option.content ?? option.id);
      if (option.latex) {
        content += `<code class="latex">${escapeHtml(option.latex)}</code>`;
      }
      if (option.image) {
        const optionPath = safeResolve(baseDir, option.image);
        content += `<img class="option-image" src="${fileDataUri(
          optionPath
        )}" alt="${escapeHtml(option.imageAlt ?? "")}">`;
      }
      return `<li><span class="option-label">${escapeHtml(
        option.id
      )}</span><span>${content}</span></li>`;
    })
    .join("");
  return `
    <article class="question-card">
      <header>
        <span>第 ${index + 1} 題</span>
        <span>${escapeHtml(question.cognitiveLevel)}</span>
        <span>${escapeHtml(question.source?.reference ?? "")}</span>
      </header>
      ${stem}
      <ol class="options">${optionsHtml}</ol>
      <div class="answer-row">
        <button type="button" onclick="this.nextElementSibling.hidden = !this.nextElementSibling.hidden">顯示／隱藏答案</button>
        <strong hidden>正確答案：${escapeHtml(
          question.correctOptionIds.join(", ")
        )}</strong>
      </div>
    </article>`;
}

function commandPreview(options) {
  const quizPath = resolve(requireOption(options, "quiz"));
  const output = resolve(requireOption(options, "out"));
  ensureWritableTarget(output, booleanOption(options, "force", false));
  const quiz = readJson(quizPath);
  const report = validateQuizData(quiz, dirname(quizPath), false);
  if (!report.valid) {
    printValidation(report);
    throw new CliError("Fix validation errors before creating a preview.", 1);
  }
  const cards = quiz.questions
    .map((question, index) => renderQuestionHtml(question, index, dirname(quizPath)))
    .join("\n");
  const distribution = report.answerDistribution
    .map((item) => `${item.label}: ${item.count}`)
    .join("　");
  const html = `<!doctype html>
<html lang="${escapeHtml(quiz.language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(quiz.title)}｜出題預覽</title>
  <style>
    :root { color-scheme: light; font-family: "Segoe UI", "Noto Sans TC", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f6fb; color: #172033; }
    .page { width: min(1040px, calc(100% - 32px)); margin: 32px auto 80px; }
    .summary, .question-card { background: white; border: 1px solid #dde2ef; border-radius: 16px; box-shadow: 0 8px 30px rgba(25, 36, 64, .06); }
    .summary { padding: 24px; margin-bottom: 20px; }
    h1 { margin: 0 0 10px; font-size: clamp(24px, 4vw, 38px); }
    .meta { color: #55627a; line-height: 1.8; }
    .question-card { padding: 20px; margin: 18px 0; break-inside: avoid; }
    .question-card header { display: flex; flex-wrap: wrap; gap: 8px 18px; color: #5d6880; margin-bottom: 16px; font-size: 14px; }
    .question-image { width: 100%; height: auto; max-height: 720px; object-fit: contain; object-position: left top; border: 1px solid #e3e7f0; border-radius: 10px; background: white; }
    .text-stem { font-size: 20px; line-height: 1.7; }
    .options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; list-style: none; padding: 0; margin: 18px 0; }
    .options li { display: flex; align-items: center; gap: 10px; border: 1px solid #d9dfec; border-radius: 10px; padding: 12px; min-height: 54px; }
    .option-label { display: inline-grid; place-items: center; flex: 0 0 32px; height: 32px; border-radius: 50%; background: #6c4df6; color: white; font-weight: 700; }
    .option-image { display: block; max-width: 100%; max-height: 160px; margin-top: 8px; }
    .latex { display: block; margin-top: 4px; }
    .answer-row { display: flex; gap: 14px; align-items: center; }
    button { border: 0; border-radius: 9px; padding: 10px 14px; color: white; background: #233a77; cursor: pointer; }
    @media (max-width: 680px) { .options { grid-template-columns: 1fr; } .page { width: min(100% - 18px, 1040px); margin-top: 10px; } }
    @media print { body { background: white; } .page { width: 100%; margin: 0; } .summary, .question-card { box-shadow: none; } button { display: none; } }
  </style>
</head>
<body>
  <main class="page">
    <section class="summary">
      <h1>${escapeHtml(quiz.title)}</h1>
      <div class="meta">
        ${escapeHtml(quiz.subject)}｜年級 ${escapeHtml(
    quiz.grade.start
  )}–${escapeHtml(quiz.grade.end)}｜共 ${quiz.questions.length} 題<br>
        答案位置分布：${escapeHtml(distribution)}<br>
        選項洗牌：${quiz.settings.shuffleOptions ? "開啟" : "關閉"}
      </div>
    </section>
    ${cards}
  </main>
</body>
</html>
`;
  writeText(output, html);
  printJson({ ok: true, preview: output, questionCount: quiz.questions.length });
  return output;
}

function seededRandom(seedText) {
  let seed = 1779033703 ^ seedText.length;
  for (let index = 0; index < seedText.length; index += 1) {
    seed = Math.imul(seed ^ seedText.charCodeAt(index), 3432918353);
    seed = (seed << 13) | (seed >>> 19);
  }
  return () => {
    seed = Math.imul(seed ^ (seed >>> 16), 2246822507);
    seed = Math.imul(seed ^ (seed >>> 13), 3266489909);
    seed ^= seed >>> 16;
    return (seed >>> 0) / 4294967296;
  };
}

function commandAnswerPlan(options) {
  const count = numberOption(options, "count", NaN);
  const optionCount = numberOption(options, "options", 4);
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    throw new CliError("--count must be an integer from 1 to 1000");
  }
  if (!Number.isInteger(optionCount) || optionCount < 2 || optionCount > 26) {
    throw new CliError("--options must be an integer from 2 to 26");
  }
  const seed = String(options.seed ?? `${count}-${optionCount}`);
  const labels = Array.from({ length: optionCount }, (_, index) =>
    String.fromCharCode(65 + index)
  );
  const random = seededRandom(seed);
  const extraOrder = [...labels];
  for (let index = extraOrder.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [extraOrder[index], extraOrder[swap]] = [extraOrder[swap], extraOrder[index]];
  }
  const sequence = [];
  const base = Math.floor(count / optionCount);
  const remainder = count % optionCount;
  const extraLabels = new Set(extraOrder.slice(0, remainder));
  labels.forEach((label) => {
    const labelCount = base + (extraLabels.has(label) ? 1 : 0);
    for (let item = 0; item < labelCount; item += 1) sequence.push(label);
  });
  for (let index = sequence.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [sequence[index], sequence[swap]] = [sequence[swap], sequence[index]];
  }
  const result = {
    schemaVersion: SCHEMA_VERSION,
    count,
    optionCount,
    seed,
    balanced: true,
    distribution: labels.map((label) => ({
      label,
      count: sequence.filter((item) => item === label).length,
    })),
    sequence: sequence.map((answer, index) => ({
      question: index + 1,
      answer,
    })),
  };
  if (options.out) {
    const output = resolve(String(options.out));
    ensureWritableTarget(output, booleanOption(options, "force", false));
    writeJson(output, result);
  }
  printJson(result);
  return result;
}

function connectorPayload(quiz) {
  const invalid = quiz.questions.filter(
    (question) =>
      question.type !== "text-mcq" ||
      question.stem?.image ||
      question.options.some((option) => option.image)
  );
  if (invalid.length) {
    throw new CliError(
      `wayground-mcp supports text-only MCQ in the current connector. Use wayground-browser for: ${invalid
        .map((question) => question.id)
        .join(", ")}`
    );
  }
  return {
    title: quiz.title,
    subject: quiz.subject,
    grade: {
      start: quiz.grade.start,
      end: quiz.grade.end,
    },
    questions: quiz.questions.map((question) => ({
      query: String(question.stem.text ?? question.stem.latex ?? ""),
      options: question.options.map((option) =>
        String(option.content || option.latex || "")
      ),
      answer: question.correctOptionIds.map((correctId) =>
        question.options.findIndex(
          (option) => String(option.id) === String(correctId)
        )
      ),
    })),
  };
}

function browserPayload(quiz, quizPath, validation) {
  const baseDir = dirname(quizPath);
  return {
    schemaVersion: SCHEMA_VERSION,
    adapter: "wayground-browser",
    generatedAt: new Date().toISOString(),
    sourceQuiz: quizPath,
    sourceQuizSha256: sha256File(quizPath),
    strictValidation: {
      passed: true,
      validatedAt: new Date().toISOString(),
      questionCount: quiz.questions.length,
      errorCount: validation.errorCount,
      warningCount: validation.warningCount,
    },
    publicationApproval: {
      explicitPublicationAuthorizationRequired: true,
      accountConfirmationRequired: true,
      allowedAction: "create-resource",
      assignmentOrLiveSessionAuthorized: false,
    },
    resource: {
      title: quiz.title,
      subject: quiz.subject,
      grade: quiz.grade,
      language: quiz.language,
    },
    settings: {
      ...quiz.settings,
      required: {
        shuffleOptions: false,
      },
    },
    browserPolicy: {
      useExistingLoggedInSession: true,
      launchPersistentContext: false,
      copyOrReuseBrowserProfile: false,
      persistSessionInJob: false,
      accessibilitySnapshotBeforeAction: true,
      hardCodedSelectors: false,
      removeDomOverlays: false,
      forceClicks: false,
    },
    executionProtocol: {
      mode: "checkpointed-state-machine",
      stateCommand: "publication-state",
      stopOnFirstUnverifiedStep: true,
      resumeFromFirstPendingQuestion: true,
      requireVisibleModalDismissal: true,
      requireQuestionCountIncrementAfterSave: true,
      requireResourceSpecificUrlBeforeFinalize: true,
      preferCorrectAnswerIds: true,
      correctAnswerIndexBase: 0,
      titleDoesNotOverrideRuntimeShuffleSettings: true,
    },
    questions: quiz.questions.map((question, index) => ({
      order: index + 1,
      id: question.id,
      expectedQuestionCountAfterSave: index + 1,
      type: "multiple-choice",
      prompt:
        question.stem?.text ??
        (question.type === "image-mcq" ? "請看圖作答。" : ""),
      image: question.stem?.image
        ? safeResolve(baseDir, question.stem.image)
        : null,
      imageSha256: question.stem?.image
        ? sha256File(safeResolve(baseDir, question.stem.image))
        : null,
      imageAlt: question.stem?.alt ?? "",
      options: question.options.map((option) => ({
        id: option.id,
        content: option.content,
        latex: option.latex ?? null,
        image: option.image ? safeResolve(baseDir, option.image) : null,
        imageSha256: option.image
          ? sha256File(safeResolve(baseDir, option.image))
          : null,
        imageAlt: option.imageAlt ?? "",
      })),
      correctAnswerIds: question.correctOptionIds.map(String),
      correctAnswerIndices: question.correctOptionIds.map((correctId) =>
        question.options.findIndex(
          (option) => String(option.id) === String(correctId)
        )
      ),
      explanation: question.explanation ?? "",
      sourceReference: question.source?.reference ?? "",
    })),
    verification: {
      expectedQuestionCount: quiz.questions.length,
      expectedQuestionOrder: quiz.questions.map((question) => question.id),
      compareCorrectAnswers: true,
      confirmImagesLoaded: true,
      confirmResourceReopened: true,
      requireResourceSpecificUrl: true,
      requireDistinctScreenshots: true,
      evidenceFile: "publication-evidence.json",
      stateFile: "publication-state.json",
    },
  };
}

function copyPortablePackage(quiz, quizPath, output, force) {
  if (existsSync(output)) {
    const entries = readdirSync(output);
    if (entries.length > 0 && !force) {
      throw new CliError(
        `Package directory is not empty: ${output}. Use --force to update known files.`
      );
    }
  }
  mkdirSync(output, { recursive: true });
  const baseDir = dirname(quizPath);
  const cloned = structuredClone(quiz);
  cloned.sourceDocuments = cloned.sourceDocuments.map((source) => ({
    ...source,
    path: source.name || basename(source.path || "source"),
  }));
  const copiedAssets = [];
  const assetPaths = new Set();
  for (const question of cloned.questions) {
    if (question.stem?.image) assetPaths.add(question.stem.image);
    for (const option of question.options ?? []) {
      if (option.image) assetPaths.add(option.image);
    }
    if (question.visualSpec) {
      const visualSpecPath = safeResolve(baseDir, question.visualSpec);
      assetPaths.add(question.visualSpec);
      const visualSpec = readJson(visualSpecPath);
      for (const layer of visualSpec.layers ?? []) {
        if (layer?.type !== "image" || !layer.path) continue;
        const dependency = safeResolve(dirname(visualSpecPath), String(layer.path));
        const dependencyRelative = relative(baseDir, dependency);
        if (
          dependencyRelative === ".." ||
          dependencyRelative.startsWith(`..${sep}`) ||
          isAbsolute(dependencyRelative)
        ) {
          throw new CliError(
            `Visual spec dependency escapes the quiz package: ${layer.path}`
          );
        }
        assetPaths.add(dependencyRelative.split(sep).join("/"));
      }
    }
  }
  for (const asset of assetPaths) {
    if (isAbsolute(asset)) {
      throw new CliError(`Portable package cannot include absolute asset path: ${asset}`);
    }
    const source = safeResolve(baseDir, asset);
    const destination = safeResolve(output, asset);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    copiedAssets.push(relative(output, destination).split(sep).join("/"));
  }
  writeJson(join(output, "quiz.json"), cloned);
  copyFileSync(QUIZ_SCHEMA, join(output, "quiz.schema.json"));
  copyFileSync(VISUAL_SCHEMA, join(output, "visual-spec.schema.json"));
  writeJson(join(output, "package-manifest.json"), {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    quiz: "quiz.json",
    schema: "quiz.schema.json",
    visualSchema: "visual-spec.schema.json",
    assets: copiedAssets,
    containsCredentials: false,
  });
  return {
    package: output,
    assets: copiedAssets,
  };
}

function commandPublish(options) {
  const adapter = String(options.adapter ?? "export-only");
  const quizPath = resolve(requireOption(options, "quiz"));
  const quizDir = dirname(quizPath);
  const quiz = readJson(quizPath);
  const validation = validateQuizData(quiz, quizDir, true);
  if (!validation.valid) {
    printValidation(validation);
    throw new CliError("Strict validation must pass before publication.", 1);
  }
  const force = booleanOption(options, "force", false);
  if (adapter === "wayground-mcp") {
    const output = resolve(requireOption(options, "out"));
    ensureWritableTarget(output, force);
    const payload = connectorPayload(quiz);
    writeJson(output, payload);
    printJson({ ok: true, adapter, output, questionCount: quiz.questions.length });
    return payload;
  }
  if (adapter === "wayground-browser") {
    const output = resolve(requireOption(options, "out"));
    const stateOutput = options.state ? resolve(String(options.state)) : null;
    ensureWritableTarget(output, force);
    if (stateOutput) ensureWritableTarget(stateOutput, force);
    const payload = browserPayload(quiz, quizPath, validation);
    if (stateOutput) payload.verification.stateFile = stateOutput;
    writeJson(output, payload);
    if (stateOutput) writeJson(stateOutput, createPublicationState(payload, output));
    printJson({
      ok: true,
      adapter,
      output,
      state: stateOutput,
      questionCount: quiz.questions.length,
    });
    return payload;
  }
  if (adapter === "export-only") {
    const output = resolve(requireOption(options, "out"));
    const result = copyPortablePackage(quiz, quizPath, output, force);
    printJson({ ok: true, adapter, ...result });
    return result;
  }
  throw new CliError(
    "--adapter must be wayground-mcp, wayground-browser, or export-only"
  );
}

function resourceSpecificWaygroundUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || !/(^|\.)wayground\.com$/i.test(url.hostname)) {
      return null;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (
      segments.length === 0 ||
      segments.includes("login") ||
      segments.includes("my-library") ||
      segments.at(-1) === "create"
    ) {
      return null;
    }
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (!["quiz", "assessment"].includes(segments[index].toLowerCase())) continue;
      const resourceId = segments[index + 1];
      if (/^[A-Za-z0-9_-]{8,}$/.test(resourceId)) {
        return { url: url.toString(), resourceId };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function createPublicationState(plan, planPath) {
  if (plan?.adapter !== "wayground-browser" || !Array.isArray(plan.questions)) {
    throw new CliError("Publication state requires a wayground-browser plan.");
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    adapter: "wayground-browser",
    status: "not-started",
    plan: planPath,
    planSha256: sha256File(planPath),
    sourceQuiz: plan.sourceQuiz,
    sourceQuizSha256: plan.sourceQuizSha256 ?? null,
    strictValidation: plan.strictValidation ?? null,
    publicationApproval: {
      confirmed: false,
      resourceOnly: true,
      accountConfirmed: false,
      authorizedAt: null,
    },
    resourceMode: "create-new",
    abandonedResourceUrls: [],
    expectedTitle: plan.resource?.title ?? "",
    expectedQuestionCount: plan.questions.length,
    resourceUrl: null,
    startedAt: null,
    updatedAt: new Date().toISOString(),
    questions: plan.questions.map((question) => ({
      order: question.order,
      id: question.id,
      expectedQuestionCountAfterSave: Number(
        question.expectedQuestionCountAfterSave ?? question.order
      ),
      hasImage: Boolean(question.image),
      imageSha256: question.imageSha256 ?? null,
      correctAnswerIds: Array.isArray(question.correctAnswerIds)
        ? question.correctAnswerIds.map(String)
        : [],
      status: "pending",
      observedQuestionCount: 0,
      imageLoaded: false,
      correctAnswerConfirmed: false,
      screenshot: null,
      savedAt: null,
    })),
  };
}

function commandPublicationState(options) {
  const action = String(options.action ?? "").trim().toLowerCase();
  if (action === "init") {
    const planPath = resolve(requireOption(options, "plan"));
    const output = resolve(requireOption(options, "out"));
    ensureWritableTarget(output, booleanOption(options, "force", false));
    const state = createPublicationState(readJson(planPath), planPath);
    writeJson(output, state);
    printJson({ ok: true, action, output, questionCount: state.questions.length });
    return state;
  }

  const statePath = resolve(requireOption(options, "state"));
  const state = readJson(statePath);
  if (state?.adapter !== "wayground-browser" || !Array.isArray(state.questions)) {
    throw new CliError("Invalid wayground-browser publication state.");
  }
  const stateDir = dirname(statePath);

  if (action === "authorize") {
    if (!booleanOption(options, "resource-only", false)) {
      throw new CliError("--resource-only true is required; assignment/live-session actions are not authorized.");
    }
    if (!booleanOption(options, "account-confirmed", false)) {
      throw new CliError("--account-confirmed true is required after checking the visible teacher account.");
    }
    const now = new Date().toISOString();
    state.publicationApproval = {
      confirmed: true,
      resourceOnly: true,
      accountConfirmed: true,
      authorizedAt: now,
    };
    state.status = "authorized";
    state.updatedAt = now;
    writeJson(statePath, state);
    printJson({ ok: true, action, resourceOnly: true, accountConfirmed: true });
    return state;
  }

  if (action === "mark") {
    if (state.status === "published") {
      throw new CliError("Published state cannot be changed.");
    }
    if (
      state.publicationApproval?.confirmed !== true ||
      state.publicationApproval?.resourceOnly !== true ||
      state.publicationApproval?.accountConfirmed !== true
    ) {
      throw new CliError("Authorize resource-only publication and confirm the visible account before marking questions.");
    }
    const questionId = requireOption(options, "question");
    const question = state.questions.find((item) => String(item.id) === questionId);
    if (!question) throw new CliError(`Question not found in publication state: ${questionId}`);
    const previous = state.questions.filter((item) => item.order < question.order);
    if (previous.some((item) => item.status !== "saved")) {
      throw new CliError(`Cannot mark ${questionId}; an earlier question is still pending.`);
    }
    const observedCount = numberOption(options, "observed-count", Number.NaN);
    if (observedCount !== question.expectedQuestionCountAfterSave) {
      throw new CliError(
        `Expected saved question count ${question.expectedQuestionCountAfterSave}, received ${observedCount}.`
      );
    }
    if (!booleanOption(options, "image-loaded", false)) {
      throw new CliError("--image-loaded true is required after visually confirming the image.");
    }
    if (!booleanOption(options, "answer-confirmed", false)) {
      throw new CliError("--answer-confirmed true is required after checking the correct option.");
    }
    const screenshot = storedPath(stateDir, requireOption(options, "screenshot"));
    if (options.resourceUrl) {
      const resource = resourceSpecificWaygroundUrl(String(options.resourceUrl));
      if (!resource) throw new CliError("--resource-url must identify a specific Wayground resource.");
      state.resourceUrl = resource.url;
    }
    const now = new Date().toISOString();
    Object.assign(question, {
      status: "saved",
      observedQuestionCount: observedCount,
      imageLoaded: true,
      correctAnswerConfirmed: true,
      screenshot,
      savedAt: now,
    });
    state.status = "in-progress";
    state.startedAt ??= now;
    state.updatedAt = now;
    writeJson(statePath, state);
    printJson({ ok: true, action, question: questionId, observedCount });
    return state;
  }

  if (action === "finalize") {
    const pending = state.questions.filter((question) => question.status !== "saved");
    if (pending.length) {
      throw new CliError(`Cannot finalize; pending questions: ${pending.map((item) => item.id).join(", ")}`);
    }
    const resource = resourceSpecificWaygroundUrl(requireOption(options, "resource-url"));
    if (!resource) {
      throw new CliError("--resource-url must be a resource-specific Wayground quiz/assessment URL.");
    }
    const observedTitle = requireOption(options, "observed-title");
    if (observedTitle !== state.expectedTitle) {
      throw new CliError(`Published title mismatch. Expected "${state.expectedTitle}".`);
    }
    const observedCount = numberOption(options, "question-count", Number.NaN);
    if (observedCount !== state.expectedQuestionCount) {
      throw new CliError(
        `Published question count mismatch. Expected ${state.expectedQuestionCount}, received ${observedCount}.`
      );
    }
    if (!booleanOption(options, "reopened", false)) {
      throw new CliError("--reopened true is required after reopening the saved resource.");
    }
    if (!booleanOption(options, "images-loaded", false)) {
      throw new CliError("--images-loaded true is required after checking every question image.");
    }
    if (!booleanOption(options, "answers-confirmed", false)) {
      throw new CliError("--answers-confirmed true is required after checking every correct answer.");
    }
    const overview = storedPath(stateDir, requireOption(options, "overview-screenshot"));
    const representative = storedPath(stateDir, requireOption(options, "question-screenshot"));
    const overviewPath = isAbsolute(overview) ? overview : safeResolve(stateDir, overview);
    const representativePath = isAbsolute(representative)
      ? representative
      : safeResolve(stateDir, representative);
    if (overviewPath === representativePath || sha256File(overviewPath) === sha256File(representativePath)) {
      throw new CliError("Overview and representative question screenshots must be different images.");
    }
    const verifiedAt = new Date().toISOString();
    const evidence = {
      schemaVersion: SCHEMA_VERSION,
      status: "published",
      adapter: "wayground-browser",
      sourceQuiz: state.sourceQuiz,
      sourceQuizSha256: state.sourceQuizSha256,
      planSha256: state.planSha256,
      publicationApproval: state.publicationApproval,
      resourceUrl: resource.url,
      resourceId: resource.resourceId,
      title: observedTitle,
      titleConfirmed: true,
      questionCount: observedCount,
      questionOrder: state.questions.map((question) => question.id),
      resourceReopened: true,
      imagesLoaded: true,
      correctAnswersVerified: true,
      assignmentCreated: false,
      verifiedAt,
      screenshots: [overview, representative],
      questions: state.questions.map((question) => ({
        order: question.order,
        id: question.id,
        status: question.status,
        observedQuestionCount: question.observedQuestionCount,
        imageLoaded: question.imageLoaded,
        imageSha256: question.imageSha256,
        correctAnswerConfirmed: question.correctAnswerConfirmed,
        correctAnswerIds: question.correctAnswerIds,
        screenshot: question.screenshot,
        savedAt: question.savedAt,
      })),
    };
    const output = resolve(requireOption(options, "out"));
    ensureWritableTarget(output, booleanOption(options, "force", false));
    writeJson(output, evidence);
    state.status = "published";
    state.resourceUrl = resource.url;
    state.updatedAt = verifiedAt;
    state.finalizedAt = verifiedAt;
    state.evidenceFile = storedPath(stateDir, output);
    writeJson(statePath, state);
    printJson({ ok: true, action, output, resourceUrl: resource.url });
    return evidence;
  }

  throw new CliError("--action must be init, authorize, mark, or finalize");
}
function commandVerify(options) {
  const quizPath = resolve(requireOption(options, "quiz"));
  const quizDir = dirname(quizPath);
  const quiz = readJson(quizPath);
  const validation = validateQuizData(quiz, quizDir, true);
  const issues = [...validation.issues];
  const add = (severity, code, path, message) =>
    issues.push({ severity, code, path, message });
  const browserEvidenceRequired = quiz.questions.some(
    (question) => question.type === "image-mcq"
  );
  let evidence = null;
  if (options.evidence) {
    const evidencePath = resolve(String(options.evidence));
    const evidenceDir = dirname(evidencePath);
    evidence = readJson(evidencePath);
    const resource = resourceSpecificWaygroundUrl(evidence.resourceUrl);
    if (!resource) {
      add(
        "error",
        "resource-url",
        "$evidence.resourceUrl",
        "Evidence must contain a resource-specific Wayground quiz/assessment URL, not a dashboard, draft list, login, or create URL"
      );
    }
    if (evidence.status !== "published") {
      add("error", "publication-status", "$evidence.status", "Evidence status must be published");
    }
    if (evidence.title !== quiz.title || evidence.titleConfirmed !== true) {
      add(
        "error",
        "published-title",
        "$evidence.title",
        "Evidence must confirm the exact canonical quiz title"
      );
    }
    if (Number(evidence.questionCount) !== quiz.questions.length) {
      add(
        "error",
        "question-count",
        "$evidence.questionCount",
        `Expected ${quiz.questions.length}, received ${evidence.questionCount}`
      );
    }
    if (!evidence.verifiedAt || Number.isNaN(Date.parse(evidence.verifiedAt))) {
      add(
        "error",
        "verified-at",
        "$evidence.verifiedAt",
        "Evidence needs a valid verifiedAt timestamp"
      );
    }

    const expectedOrder = quiz.questions.map((question) => String(question.id));
    const observedOrder = Array.isArray(evidence.questionOrder)
      ? evidence.questionOrder.map(String)
      : [];
    if (JSON.stringify(observedOrder) !== JSON.stringify(expectedOrder)) {
      add(
        "error",
        "question-order",
        "$evidence.questionOrder",
        "Evidence must contain every canonical question id in exact order"
      );
    }

    if (browserEvidenceRequired) {
      if (evidence.sourceQuizSha256 !== sha256File(quizPath)) {
        add(
          "error",
          "source-quiz-hash",
          "$evidence.sourceQuizSha256",
          "Publication evidence does not match the current quiz.json"
        );
      }
      if (
        evidence.publicationApproval?.confirmed !== true ||
        evidence.publicationApproval?.resourceOnly !== true ||
        evidence.publicationApproval?.accountConfirmed !== true
      ) {
        add(
          "error",
          "publication-authorization",
          "$evidence.publicationApproval",
          "Evidence must confirm resource-only authorization and the visible teacher account"
        );
      }
      if (evidence.resourceReopened !== true) {
        add(
          "error",
          "resource-reopened",
          "$evidence.resourceReopened",
          "Re-open the saved resource before verification"
        );
      }
      if (evidence.imagesLoaded !== true) {
        add(
          "error",
          "images-loaded",
          "$evidence.imagesLoaded",
          "Evidence must confirm every question image loaded"
        );
      }
      if (evidence.correctAnswersVerified !== true) {
        add(
          "error",
          "answers-verified",
          "$evidence.correctAnswersVerified",
          "Evidence must confirm every correct answer"
        );
      }
      if (evidence.assignmentCreated !== false) {
        add(
          "error",
          "assignment-boundary",
          "$evidence.assignmentCreated",
          "Resource-only publication evidence must confirm that no assignment or live session was created"
        );
      }
      if (!Array.isArray(evidence.questions) || evidence.questions.length !== quiz.questions.length) {
        add(
          "error",
          "question-checkpoints",
          "$evidence.questions",
          "One saved checkpoint is required for every question"
        );
      } else {
        evidence.questions.forEach((checkpoint, index) => {
          const expected = quiz.questions[index];
          const checkpointPath = `$evidence.questions[${index}]`;
          const expectedAnswerIds = expected.correctOptionIds.map(String);
          const observedAnswerIds = Array.isArray(checkpoint.correctAnswerIds)
            ? checkpoint.correctAnswerIds.map(String)
            : [];
          const expectedImageSha256 = expected.stem?.image
            ? sha256File(safeResolve(quizDir, expected.stem.image))
            : null;
          if (
            String(checkpoint.id) !== String(expected.id) ||
            Number(checkpoint.order) !== index + 1 ||
            checkpoint.status !== "saved" ||
            Number(checkpoint.observedQuestionCount) !== index + 1 ||
            checkpoint.imageLoaded !== true ||
            checkpoint.imageSha256 !== expectedImageSha256 ||
            checkpoint.correctAnswerConfirmed !== true ||
            JSON.stringify(observedAnswerIds) !== JSON.stringify(expectedAnswerIds)
          ) {
            add(
              "error",
              "question-checkpoint",
              checkpointPath,
              `Question ${expected.id} lacks a complete saved checkpoint`
            );
          }
          if (typeof checkpoint.screenshot !== "string" || checkpoint.screenshot === "") {
            add(
              "error",
              "question-screenshot",
              `${checkpointPath}.screenshot`,
              `Question ${expected.id} needs a post-save screenshot`
            );
          } else {
            const screenshotPath = isAbsolute(checkpoint.screenshot)
              ? resolve(checkpoint.screenshot)
              : safeResolve(evidenceDir, checkpoint.screenshot);
            if (!existsSync(screenshotPath) || !statSync(screenshotPath).isFile()) {
              add(
                "error",
                "missing-question-screenshot",
                `${checkpointPath}.screenshot`,
                `Question screenshot not found: ${screenshotPath}`
              );
            }
          }
        });
      }
    }

    if (!Array.isArray(evidence.screenshots) || evidence.screenshots.length < 2) {
      add(
        "error",
        "screenshots",
        "$evidence.screenshots",
        "An overview screenshot and a representative question screenshot are required"
      );
    } else {
      const screenshotPaths = [];
      evidence.screenshots.forEach((screenshot, index) => {
        const screenshotPath = isAbsolute(String(screenshot))
          ? resolve(String(screenshot))
          : safeResolve(evidenceDir, String(screenshot));
        if (!existsSync(screenshotPath) || !statSync(screenshotPath).isFile()) {
          add(
            "error",
            "missing-screenshot",
            `$evidence.screenshots[${index}]`,
            `Screenshot not found: ${screenshotPath}`
          );
        } else {
          screenshotPaths.push(screenshotPath);
        }
      });
      if (
        screenshotPaths.length >= 2 &&
        new Set(screenshotPaths.map((path) => sha256File(path))).size !== screenshotPaths.length
      ) {
        add(
          "error",
          "duplicate-screenshots",
          "$evidence.screenshots",
          "Verification screenshots must be different images"
        );
      }
    }
    for (const keyPath of findForbiddenKeys(evidence, "$evidence")) {
      add("error", "secret-field", keyPath, "Secret/session fields are not allowed");
    }
  } else {
    add(
      "warning",
      "no-publication-evidence",
      "$evidence",
      "Only local quiz validation was performed"
    );
  }
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const report = {
    schemaVersion: SCHEMA_VERSION,
    valid: errors.length === 0,
    quiz: quizPath,
    evidenceChecked: Boolean(evidence),
    errorCount: errors.length,
    warningCount: warnings.length,
    issues,
  };
  if (options.report) writeJson(resolve(String(options.report)), report);
  printValidation({
    ...report,
    questionCount: quiz.questions.length,
    answerDistribution: validation.answerDistribution,
  });
  if (!report.valid) throw new CliError("Verification failed.", 1);
  return report;
}

function help() {
  process.stdout.write(`Wayground Math Quiz CLI

Usage:
  node scripts/quiz.mjs <command> [options]

Commands:
  doctor       Check Node, Python, Pillow, pdftoppm, and Word conversion
  init         Create a new job directory and crop-plan template
  ingest       Convert PDF/Word to normalized PDF and rendered page images
  crop         Crop question images from crop-plan.json
  assemble     Build canonical quiz.json from crop results
  visual-init  Create a deterministic, source-crop, or AI-composite visual spec
  compose      Render visual-spec.json to a screen-ready PNG
  visual-validate Validate locked facts, assets, review flags, and final image
  prompt-pack  Export an AI-image prompt and locked-fact handoff document
  answer-plan  Generate a deterministic balanced answer-position plan
  validate     Validate quiz structure, assets, sources, and answer balance
  preview      Create a self-contained teacher preview HTML
  publish      Create a connector payload, browser plan, or portable package
  publication-state Create, checkpoint, or finalize a browser publication run
  verify       Validate local quiz plus publication evidence

Run commands from any directory; paths may be absolute. Use --force only to
replace generated outputs that belong to the current job.
`);
}

async function main() {
  const { command, options } = parseArgv(process.argv.slice(2));
  switch (command) {
    case "doctor":
      commandDoctor(options);
      break;
    case "init":
      commandInit(options);
      break;
    case "ingest":
      commandIngest(options);
      break;
    case "crop":
      commandCrop(options);
      break;
    case "assemble":
      commandAssemble(options);
      break;
    case "visual-init":
      commandVisualInit(options);
      break;
    case "compose":
      commandCompose(options);
      break;
    case "visual-validate":
      commandVisualValidate(options);
      break;
    case "prompt-pack":
      commandPromptPack(options);
      break;
    case "answer-plan":
      commandAnswerPlan(options);
      break;
    case "validate":
      commandValidate(options);
      break;
    case "preview":
      commandPreview(options);
      break;
    case "publish":
      commandPublish(options);
      break;
    case "publication-state":
      commandPublicationState(options);
      break;
    case "verify":
      commandVerify(options);
      break;
    case "help":
    case "--help":
    case "-h":
      help();
      break;
    default:
      help();
      throw new CliError(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  const exitCode = error instanceof CliError ? error.exitCode : 1;
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = exitCode;
});
