# Browser publishing protocol

Use this protocol only after strict validation passes and the user authorizes resource publication.

## Safety boundary

- Control an already open, logged-in browser surface provided by the agent environment.
- Do not call `launch_persistent_context`, open the user's default browser profile a second time, copy a profile, or store session data in the job.
- If the controlled browser is signed out, pause and ask the user to sign in there. Do not switch to a blank temporary profile and claim it is equivalent.
- Create a new resource unless the user identifies an existing resource to edit.
- Do not create an assignment, start a live session, change public visibility, send notifications, or delete resources without explicit authorization.

## Interaction rules

Wayground's editor is stateful and changes over time. Before every major action, inspect the current visible page or accessibility tree.

- Locate controls by current visible label, role, and nearby context. Do not depend on a selector discovered in an older run.
- Dismiss onboarding and help dialogs through their visible Close, Skip, Got it, or equivalent control.
- Never remove `#layer-*`, `.v-popper`, `.modal-backdrop`, or other DOM nodes. They may contain the active dialog and its Save action.
- Never use forced clicks to bypass an overlay. A blocked click means the current UI state has not been handled.
- Trigger file upload only from the visible image-upload workflow. Confirm the preview and click the modal's visible Save action before continuing.
- After saving a question, wait until the resource overview visibly reports the expected question count. Do not infer success from a click or toast alone.

## Initialize a checkpointed run

Generate a fresh browser plan and matching publication state in one command. The plan records strict-validation time, `quiz.json` and image hashes, explicit answer IDs, and the exact state-file path:

```powershell
$job = ".\jobs\unit-01"
$cli = ".\skills\wayground-math-quiz\scripts\quiz.mjs"

node $cli publish `
  --adapter wayground-browser `
  --quiz "$job\quiz.json" `
  --out "$job\export\wayground-browser.json" `
  --state "$job\publication-state.json" `
  --force
```

If `publication-state.json` already exists, inspect it first. Resume at the first `pending` question instead of creating another resource.

## Publishing state machine

### 1. Confirm authentication

1. Open Wayground in the controlled browser.
2. Confirm the teacher dashboard is visible and the expected account is active.
3. If redirected to login, stop for user sign-in.
4. Confirm that the user's current request explicitly authorizes creating a resource, then record the boundary:

```powershell
node $cli publication-state `
  --action authorize `
  --state "$job\publication-state.json" `
  --resource-only true `
  --account-confirmed true
```

This authorizes resource creation only. It does not authorize an assignment or live session.

### 2. Create and identify the resource

1. Create an Assessment/Quiz from scratch through visible UI controls.
2. Enter the canonical title.
3. Blur or confirm the title, then re-read it from the editor header.
4. Once the URL identifies a specific quiz or assessment, retain that URL in later checkpoints.

A dashboard, login page, create page, or My Library draft-list URL is not a resource URL.

### 3. Save one question atomically

For each plan question in order:

1. Inspect the current editor state.
2. Add a multiple-choice question.
3. Upload the exact `question.image` through the visible media dialog.
4. Confirm the image preview, then click the dialog's Save action.
5. Enter fixed choices `A`, `B`, `C`, `D`.
6. Mark the answer from `correctAnswerIds`; use `correctAnswerIndices` only as a zero-based cross-check.
7. Save the question.
8. Return to the question overview and confirm all of the following:
   - the displayed question count increased to `expectedQuestionCountAfterSave`;
   - the new question thumbnail is present and its image loaded;
   - the correct option matches the plan.
9. Capture a post-save screenshot and record the checkpoint:

```powershell
node $cli publication-state `
  --action mark `
  --state "$job\publication-state.json" `
  --question "q001" `
  --observed-count 1 `
  --image-loaded true `
  --answer-confirmed true `
  --screenshot "$job\evidence\q001-saved.png" `
  --resource-url "<current resource-specific URL>"
```

Do not start the next question unless this command succeeds. The command rejects skipped questions and count mismatches.

### 4. Publish and re-open

After every question is checkpointed:

1. Click the visible Publish action and complete only the resource metadata required to save.
2. Do not proceed into assignment or live-session creation.
3. Open the saved resource again from its resource-specific URL.
4. Confirm exact title, count, order, images, and correct answers against `quiz.json`.
5. Capture two different images:
   - an overview showing the saved resource and question count;
   - a representative question showing its loaded image and answer state.

Finalize evidence:

```powershell
node $cli publication-state `
  --action finalize `
  --state "$job\publication-state.json" `
  --resource-url "<resource-specific URL>" `
  --observed-title "<exact canonical title>" `
  --question-count 10 `
  --reopened true `
  --images-loaded true `
  --answers-confirmed true `
  --overview-screenshot "$job\evidence\published-overview.png" `
  --question-screenshot "$job\evidence\published-question.png" `
  --out "$job\publication-evidence.json" `
  --force

node $cli verify `
  --quiz "$job\quiz.json" `
  --evidence "$job\publication-evidence.json"
```

`verify` rejects list/dashboard URLs, missing per-question checkpoints, wrong title/order/count, unconfirmed images or answers, and duplicate screenshots.

## Recovery

When an interaction fails:

1. Stop at the current state; do not force-click or delete DOM layers.
2. Inspect the editor and `publication-state.json`.
3. Count the questions actually saved in Wayground.
4. Resume from the first `pending` question only when the visible count equals the last saved checkpoint.
5. If the remote resource count and checkpoint disagree, stop and reconcile before adding anything.
6. If a partial resource cannot be verified, record its URL as abandoned and create a fresh resource. Do not overwrite successful evidence with the abandoned URL.

## Session settings

Answer and question shuffling belong to assignment or live-session setup, not resource publication. For image questions with printed choices, turn both off when a session is later created. If only resource publication is authorized, exit without assigning or starting.
