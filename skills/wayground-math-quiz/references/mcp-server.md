# Thin MCP wrapper

The optional MCP server exposes the same CLI workflow without duplicating business logic:

```powershell
node ".\mcp\server.mjs"
```

It uses newline-delimited JSON-RPC over standard input/output and requires no npm dependencies. Available tools cover runtime checks, job initialization, ingest, crop, assemble, answer planning, validation, preview, publication-plan export, and verification.

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
