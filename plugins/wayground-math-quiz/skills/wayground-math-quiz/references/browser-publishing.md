# Browser publishing protocol

Use this protocol only after strict validation passes and the user has authorized publishing.

## Safety boundary

- Use the user's already logged-in browser session.
- Never export or copy cookies, local storage, passwords, or browser-profile folders.
- Never put account data in `quiz.json`.
- Do not publish student names or response records.
- Create a new resource unless the user clearly identifies an existing resource to edit.
- Stop before any paid upgrade, public-visibility change, class assignment, live session, or deletion unless explicitly authorized.

## Why the browser adapter is agent-driven

Wayground's editor UI may change. Hard-coded selectors become unsafe and brittle. Use fresh accessibility snapshots and visible labels for each run. The generated `wayground-browser.json` is the stable input; UI references are temporary.

## Publishing sequence

1. Open Wayground in the logged-in browser.
2. Create an Assessment/Quiz from scratch.
3. Set the title, subject, grade, and language from the plan.
4. For each question in order:
   1. Add a multiple-choice question.
   2. Upload the exact local image in `question.image`.
   3. Use a short prompt such as `請看圖作答。` only if the editor requires text.
   4. Enter the fixed choices `A`, `B`, `C`, `D`.
   5. Mark the correct choice from `correctAnswerIndices`.
   6. Save the question.
   7. Confirm the displayed thumbnail before continuing.
5. Publish/save the resource.
6. Ensure answer-option shuffle is off for the intended session or assignment.
   - The resource editor does not expose a resource-wide shuffle switch.
   - In the assignment/homework setup, both `隨機出題` and `隨機播放答案` may default to on.
   - Turn both switches off before clicking the final Assign/Start button when image questions contain printed `A/B/C/D` choices.
   - If the user authorized resource publication but not a class assignment or live session, inspect and capture the settings, then exit without assigning. Re-check both switches when a real assignment or session is created later.
7. Re-open the resource and verify it rather than trusting the save confirmation.

Take a fresh browser snapshot before using any element reference. If a button, uploader, or editor is ambiguous, inspect the current page and proceed by visible label; do not guess coordinates.

## Image fit check

Wayground may serve preview images inside an approximately 400 px media box. Very wide worksheet screenshots can become too small to read even when the source crop is correct.

- Inspect the student preview after upload, not only the editor thumbnail.
- If the image is too wide, create a screen-optimized variant by rearranging exact screenshot fragments into a less extreme aspect ratio.
- Do not retype, redraw, paraphrase, or alter mathematical content while making the screen variant.
- Keep the original crop beside the screen variant for provenance, and make `quiz.json` point to the exact image that was published.

## Required verification

Compare the saved resource with `quiz.json`:

- title, subject, grade, and language;
- exact question count and order;
- every question image loads and is readable;
- all four answer labels are present in fixed order;
- each correct answer matches the canonical JSON;
- no crop contains an answer-key mark;
- answer shuffling is off where the session requires fixed image choices.

Capture at least one overview screenshot and one representative question screenshot. Record the final URL, count, settings, timestamp, and screenshot paths in `publication-evidence.json`, then run the CLI `verify` command.

## Recovery

If publication stops midway:

1. Do not restart blindly.
2. Inspect the resource and count saved questions.
3. Compare saved question IDs/order with the browser plan.
4. Continue from the first missing question or create a fresh resource if the partial state cannot be verified.
5. Record the abandoned resource URL in job notes so another agent does not mistake it for the final version.
