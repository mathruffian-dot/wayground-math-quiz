# Wayground capability map

Last reviewed: 2026-07-23.

## Confirmed platform capabilities

Wayground's editor supports question media and equations. Its help center documents adding images to questions and answer options, inserting math equations, and publishing after review:

- https://support.wayground.com/hc/en-us/articles/4408491205389-Create-an-Assessment-Quiz-on-Quizizz
- https://support.wayground.com/hc/en-us/articles/4408709982233-Edit-Questions

Wayground can import PDF, PPT/PPTX, DOC/DOCX, JPG, and PNG through its own AI workflow, but its documentation warns that tables and images may be processed less successfully than plain text. This skill therefore performs its own crops instead of trusting automatic mathematical transcription:

- https://support.wayground.com/hc/en-us/articles/21615394077337

Wayground has a session setting that shuffles answer options. Turn it off when the printed options are embedded in the question image:

- https://support.wayground.com/hc/en-us/articles/115000923931

## Adapter matrix

| Requirement | `wayground-mcp` | `wayground-browser` | `export-only` |
|---|---:|---:|---:|
| Text MCQ | Yes | Yes | Yes |
| Question image upload | No in the current connector schema | Yes | Packaged only |
| Equation-editor interaction | No in the current connector schema | Yes | Source retained |
| Fixed A/B/C/D order | Connector-dependent | Yes, then verify | Declared in JSON |
| Final resource URL | Yes after tool call | Yes after browser save | No |
| Login/session storage | Managed by connector | Existing browser only | None |

## Public API status

No documented public authoring API or official authoring MCP was located in Wayground's public help material during the review above. Official integrations are primarily classroom/LMS oriented. Treat this as a changeable finding: re-check official documentation before building against an undocumented endpoint.

Never reverse-engineer private endpoints into the shared skill. A thin custom MCP may wrap this CLI, but browser publication should remain a separate adapter so the canonical quiz workflow survives UI or API changes.

## LaTeX policy

The platform documentation confirms an equation insertion feature, but does not establish that every editor path or connector accepts raw LaTeX. Keep LaTeX in the canonical JSON when available. For high-fidelity source questions, the rendered crop is authoritative; it preserves the correctly typeset mathematics even when the adapter cannot accept raw LaTeX.
