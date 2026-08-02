#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const SERVER_VERSION = "0.2.0";
const PROTOCOL_VERSION = "2025-06-18";
const MCP_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_CANDIDATES = [
  process.env.WAYGROUND_MATH_QUIZ_CLI,
  resolve(MCP_DIR, "..", "scripts", "quiz.mjs"),
  resolve(
    MCP_DIR,
    "..",
    "skills",
    "wayground-math-quiz",
    "scripts",
    "quiz.mjs"
  ),
].filter(Boolean);
const CLI_PATH = CLI_CANDIDATES.find((candidate) => existsSync(candidate));

const stringProperty = (description) => ({ type: "string", description });
const booleanProperty = (description) => ({ type: "boolean", description });
const numberProperty = (description) => ({ type: "number", description });

const TOOLS = [
  {
    name: "wayground_quiz_doctor",
    description:
      "Check the local Node, Python, Pillow, PDF renderer, and Word conversion runtime.",
    inputSchema: {
      type: "object",
      properties: {
        python: stringProperty("Optional absolute path to Python."),
        pdftoppm: stringProperty("Optional absolute path to pdftoppm."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "wayground_quiz_init",
    description:
      "Create a new image-first quiz job directory and crop-plan template.",
    inputSchema: {
      type: "object",
      required: ["jobPath"],
      properties: {
        jobPath: stringProperty("Job directory to create."),
        title: stringProperty("Quiz title."),
        force: booleanProperty("Update generated job metadata if it exists."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "wayground_quiz_ingest",
    description:
      "Convert a PDF or Word source to normalized PDF and high-resolution page images.",
    inputSchema: {
      type: "object",
      required: ["inputPath", "jobPath"],
      properties: {
        inputPath: stringProperty("Absolute PDF, DOC, or DOCX source path."),
        jobPath: stringProperty("Quiz job directory."),
        dpi: numberProperty("Render DPI, normally 180 to 300."),
        python: stringProperty("Optional absolute path to Python."),
        pdftoppm: stringProperty("Optional absolute path to pdftoppm."),
        force: booleanProperty("Replace generated source/page outputs."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "wayground_quiz_crop",
    description:
      "Crop question images according to a visually reviewed crop-plan JSON file.",
    inputSchema: {
      type: "object",
      required: ["jobPath"],
      properties: {
        jobPath: stringProperty("Quiz job directory."),
        planPath: stringProperty("Optional crop-plan JSON path."),
        python: stringProperty("Optional absolute path to Python."),
        force: booleanProperty("Replace generated crop images."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "wayground_quiz_assemble",
    description:
      "Assemble canonical quiz.json from crop results and source metadata.",
    inputSchema: {
      type: "object",
      required: ["jobPath"],
      properties: {
        jobPath: stringProperty("Quiz job directory."),
        title: stringProperty("Quiz title."),
        subject: stringProperty("Subject, normally 數學."),
        gradeStart: numberProperty("Lowest grade level."),
        gradeEnd: numberProperty("Highest grade level."),
        language: stringProperty("BCP-47 language code, normally zh-TW."),
        force: booleanProperty("Replace an existing quiz.json."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "wayground_visual_init",
    description:
      "Create a visual-spec JSON template for a deterministic, source-crop, or AI-composite math question.",
    inputSchema: {
      type: "object",
      required: ["outputPath"],
      properties: {
        outputPath: stringProperty("visual-spec.json output path."),
        id: stringProperty("Stable question ID."),
        title: stringProperty("Visual-question title."),
        mode: {
          type: "string",
          enum: ["deterministic", "source-crop", "ai-composite"],
        },
        width: numberProperty("Canvas width, normally 1200."),
        height: numberProperty("Canvas height, normally 900."),
        force: booleanProperty("Replace an existing generated spec."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "wayground_visual_compose",
    description:
      "Render a reviewed visual-spec JSON file into a deterministic screen-ready PNG.",
    inputSchema: {
      type: "object",
      required: ["specPath", "outputPath"],
      properties: {
        specPath: stringProperty("visual-spec.json path."),
        outputPath: stringProperty("Final PNG output path."),
        python: stringProperty("Optional absolute path to Python."),
        force: booleanProperty("Replace an existing generated PNG."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "wayground_visual_validate",
    description:
      "Validate locked math facts, AI provenance, assets, review flags, and final image dimensions.",
    inputSchema: {
      type: "object",
      required: ["specPath"],
      properties: {
        specPath: stringProperty("visual-spec.json path."),
        imagePath: stringProperty("Optional final PNG path."),
        python: stringProperty("Optional absolute path to Python."),
        strict: booleanProperty("Require completed math, visual, and ambiguity review."),
        reportPath: stringProperty("Optional JSON validation report path."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "wayground_visual_prompt_pack",
    description:
      "Export the selected AI prompt, locked facts, and deterministic overlay handoff notes.",
    inputSchema: {
      type: "object",
      required: ["specPath", "outputPath"],
      properties: {
        specPath: stringProperty("visual-spec.json path."),
        outputPath: stringProperty("Markdown prompt-pack output path."),
        force: booleanProperty("Replace an existing prompt pack."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "wayground_quiz_answer_plan",
    description:
      "Generate a deterministic balanced answer-position sequence such as 4/4/4/3 for 15 questions.",
    inputSchema: {
      type: "object",
      required: ["count"],
      properties: {
        count: { type: "integer", minimum: 1, maximum: 1000 },
        options: { type: "integer", minimum: 2, maximum: 26 },
        seed: stringProperty("Stable seed for reproducible order."),
        outputPath: stringProperty("Optional JSON output path."),
        force: booleanProperty("Replace an existing output file."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "wayground_quiz_validate",
    description:
      "Validate quiz structure, assets, source traceability, answer keys, and answer-position balance.",
    inputSchema: {
      type: "object",
      required: ["quizPath"],
      properties: {
        quizPath: stringProperty("Canonical quiz.json path."),
        strict: booleanProperty("Require publication-ready metadata."),
        reportPath: stringProperty("Optional JSON validation report path."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "wayground_quiz_preview",
    description:
      "Create a self-contained HTML teacher preview with embedded question images.",
    inputSchema: {
      type: "object",
      required: ["quizPath", "outputPath"],
      properties: {
        quizPath: stringProperty("Canonical quiz.json path."),
        outputPath: stringProperty("HTML preview output path."),
        force: booleanProperty("Replace an existing preview."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "wayground_quiz_publish_plan",
    description:
      "Create a text connector payload, image-question browser plan, or portable export package. This tool does not store browser credentials.",
    inputSchema: {
      type: "object",
      required: ["adapter", "quizPath", "outputPath"],
      properties: {
        adapter: {
          type: "string",
          enum: ["wayground-mcp", "wayground-browser", "export-only"],
        },
        quizPath: stringProperty("Canonical quiz.json path."),
        outputPath: stringProperty("Payload file or package directory."),
        force: booleanProperty("Replace generated output."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "wayground_quiz_verify",
    description:
      "Verify the canonical quiz and optional post-publication Wayground evidence.",
    inputSchema: {
      type: "object",
      required: ["quizPath"],
      properties: {
        quizPath: stringProperty("Canonical quiz.json path."),
        evidencePath: stringProperty("Publication evidence JSON path."),
        reportPath: stringProperty("Optional verification report path."),
      },
      additionalProperties: false,
    },
  },
];

function requireString(args, key) {
  const value = args?.[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function addValue(commandArgs, flag, value) {
  if (value !== undefined && value !== null && value !== "") {
    commandArgs.push(flag, String(value));
  }
}

function addBoolean(commandArgs, flag, value) {
  if (value === true) commandArgs.push(flag);
}

function buildCliCall(toolName, args = {}) {
  switch (toolName) {
    case "wayground_quiz_doctor": {
      const result = ["doctor"];
      addValue(result, "--python", args.python);
      addValue(result, "--pdftoppm", args.pdftoppm);
      return result;
    }
    case "wayground_quiz_init": {
      const result = ["init", "--out", requireString(args, "jobPath")];
      addValue(result, "--title", args.title);
      addBoolean(result, "--force", args.force);
      return result;
    }
    case "wayground_quiz_ingest": {
      const result = [
        "ingest",
        "--input",
        requireString(args, "inputPath"),
        "--out",
        requireString(args, "jobPath"),
      ];
      addValue(result, "--dpi", args.dpi);
      addValue(result, "--python", args.python);
      addValue(result, "--pdftoppm", args.pdftoppm);
      addBoolean(result, "--force", args.force);
      return result;
    }
    case "wayground_quiz_crop": {
      const result = ["crop", "--job", requireString(args, "jobPath")];
      addValue(result, "--plan", args.planPath);
      addValue(result, "--python", args.python);
      addBoolean(result, "--force", args.force);
      return result;
    }
    case "wayground_quiz_assemble": {
      const result = ["assemble", "--job", requireString(args, "jobPath")];
      addValue(result, "--title", args.title);
      addValue(result, "--subject", args.subject);
      addValue(result, "--grade-start", args.gradeStart);
      addValue(result, "--grade-end", args.gradeEnd);
      addValue(result, "--language", args.language);
      addBoolean(result, "--force", args.force);
      return result;
    }
    case "wayground_visual_init": {
      const result = ["visual-init", "--out", requireString(args, "outputPath")];
      addValue(result, "--id", args.id);
      addValue(result, "--title", args.title);
      addValue(result, "--mode", args.mode);
      addValue(result, "--width", args.width);
      addValue(result, "--height", args.height);
      addBoolean(result, "--force", args.force);
      return result;
    }
    case "wayground_visual_compose": {
      const result = [
        "compose",
        "--spec",
        requireString(args, "specPath"),
        "--out",
        requireString(args, "outputPath"),
      ];
      addValue(result, "--python", args.python);
      addBoolean(result, "--force", args.force);
      return result;
    }
    case "wayground_visual_validate": {
      const result = ["visual-validate", "--spec", requireString(args, "specPath")];
      addValue(result, "--image", args.imagePath);
      addValue(result, "--python", args.python);
      addBoolean(result, "--strict", args.strict);
      addValue(result, "--report", args.reportPath);
      return result;
    }
    case "wayground_visual_prompt_pack": {
      const result = [
        "prompt-pack",
        "--spec",
        requireString(args, "specPath"),
        "--out",
        requireString(args, "outputPath"),
      ];
      addBoolean(result, "--force", args.force);
      return result;
    }
    case "wayground_quiz_answer_plan": {
      const result = ["answer-plan", "--count", String(args.count)];
      addValue(result, "--options", args.options);
      addValue(result, "--seed", args.seed);
      addValue(result, "--out", args.outputPath);
      addBoolean(result, "--force", args.force);
      return result;
    }
    case "wayground_quiz_validate": {
      const result = ["validate", "--quiz", requireString(args, "quizPath")];
      addBoolean(result, "--strict", args.strict);
      addValue(result, "--report", args.reportPath);
      return result;
    }
    case "wayground_quiz_preview": {
      const result = [
        "preview",
        "--quiz",
        requireString(args, "quizPath"),
        "--out",
        requireString(args, "outputPath"),
      ];
      addBoolean(result, "--force", args.force);
      return result;
    }
    case "wayground_quiz_publish_plan": {
      const result = [
        "publish",
        "--adapter",
        requireString(args, "adapter"),
        "--quiz",
        requireString(args, "quizPath"),
        "--out",
        requireString(args, "outputPath"),
      ];
      addBoolean(result, "--force", args.force);
      return result;
    }
    case "wayground_quiz_verify": {
      const result = ["verify", "--quiz", requireString(args, "quizPath")];
      addValue(result, "--evidence", args.evidencePath);
      addValue(result, "--report", args.reportPath);
      return result;
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

function runCli(commandArgs) {
  return new Promise((resolvePromise) => {
    if (!CLI_PATH) {
      resolvePromise({
        ok: false,
        stdout: "",
        stderr:
          "quiz.mjs was not found. Set WAYGROUND_MATH_QUIZ_CLI to its absolute path.",
        code: 2,
      });
      return;
    }
    const child = spawn(process.execPath, [CLI_PATH, ...commandArgs], {
      cwd: dirname(CLI_PATH),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolvePromise({
        ok: false,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        code: 1,
      });
    });
    child.on("close", (code) => {
      resolvePromise({
        ok: code === 0,
        stdout,
        stderr,
        code: code ?? 1,
      });
    });
  });
}

function parseStructuredOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

async function callTool(name, args) {
  const commandArgs = buildCliCall(name, args);
  const result = await runCli(commandArgs);
  const text = [result.stdout.trim(), result.stderr.trim()]
    .filter(Boolean)
    .join("\n");
  const response = {
    content: [
      {
        type: "text",
        text: text || (result.ok ? "Completed." : `Failed with code ${result.code}.`),
      },
    ],
  };
  const structured = parseStructuredOutput(result.stdout);
  if (structured !== undefined) response.structuredContent = structured;
  if (!result.ok) response.isError = true;
  return response;
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  send({ jsonrpc: "2.0", id, error });
}

async function handle(message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    if (message?.id !== undefined) {
      sendError(message.id, -32600, "Invalid Request");
    }
    return;
  }
  const hasId = message.id !== undefined;
  try {
    switch (message.method) {
      case "initialize":
        if (hasId) {
          sendResult(message.id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: false },
            },
            serverInfo: {
              name: "wayground-math-quiz",
              version: SERVER_VERSION,
            },
            instructions:
              "Use quiz.json as the quiz source of truth and visual-spec.json for designed visual questions. Keep AI limited to narrative backgrounds, validate strictly, and use the browser adapter for images.",
          });
        }
        return;
      case "notifications/initialized":
      case "notifications/cancelled":
        return;
      case "ping":
        if (hasId) sendResult(message.id, {});
        return;
      case "tools/list":
        if (hasId) sendResult(message.id, { tools: TOOLS });
        return;
      case "tools/call": {
        if (!hasId) return;
        const name = message.params?.name;
        if (!TOOLS.some((tool) => tool.name === name)) {
          sendError(message.id, -32602, `Unknown tool: ${name}`);
          return;
        }
        const result = await callTool(name, message.params?.arguments ?? {});
        sendResult(message.id, result);
        return;
      }
      default:
        if (hasId) sendError(message.id, -32601, "Method not found");
    }
  } catch (error) {
    if (hasId) {
      sendError(message.id, -32602, error.message);
    } else {
      process.stderr.write(`${error.stack ?? error.message}\n`);
    }
  }
}

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

input.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch (error) {
    process.stderr.write(`Invalid JSON-RPC input: ${error.message}\n`);
    return;
  }
  void handle(message);
});
