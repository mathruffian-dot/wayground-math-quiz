# Thin MCP wrapper

The optional MCP server exposes the same CLI workflow without duplicating business logic:

```powershell
node ".\mcp\server.mjs"
```

It uses newline-delimited JSON-RPC over standard input/output and requires no npm dependencies. Available tools cover runtime checks, job initialization, ingest, crop, assemble, visual-spec initialization, deterministic composition, strict visual validation, AI prompt-pack export, answer planning, quiz validation, preview, publication-plan export, and verification.

Visual-question tools:

- `wayground_visual_init`: create a `visual-spec.json` template;
- `wayground_visual_compose`: render the reviewed spec to PNG;
- `wayground_visual_validate`: check locked facts, assets, review flags, and final dimensions;
- `wayground_visual_prompt_pack`: export the final AI prompt and deterministic handoff rules.

The server does not generate AI backgrounds itself. An image-capable agent creates the background, saves it beside the visual spec, and records the final prompt. Any agent with Node, Python, and Pillow can then compose, validate, preview, package, and publish the confirmed image.

The server does not log in to Wayground and does not expose a browser profile. `wayground_quiz_publish_plan` creates one of three outputs:

- `wayground-mcp`: text-only connector arguments;
- `wayground-browser`: an agent-executed image upload plan;
- `export-only`: a portable package without credentials.

For a standalone installation, set `WAYGROUND_MATH_QUIZ_CLI` to the absolute `scripts\quiz.mjs` path if the server is not beside the skill.

Example MCP configuration:

```json
{
  "mcpServers": {
    "wayground-math-quiz": {
      "command": "node",
      "args": ["./mcp/server.mjs"],
      "cwd": "."
    }
  }
}
```

Do not place Python paths, source-bank paths, cookies, or account tokens in a shared `.mcp.json`. Each installation may set local runtime paths through environment configuration.
