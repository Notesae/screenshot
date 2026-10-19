# Screenshot application framework implementation plan

> For agentic workers: implement independently assigned paths, then integrate and review each deliverable. The user explicitly authorized parallel delegation and final commit/push.

**Goal:** Deliver the original authorized Windows application framework with a working local screenshot editing loop and truthful evidence.

**Architecture:** WPF owns OS access, file dialogs, clipboard, capture and secrets. WebView2 hosts a locally bundled React/TypeScript editor. A correlated JSON bridge connects the two; AI HTTP adapters are replaceable native services.

**Tech Stack:** .NET 10, WPF, WebView2, React, TypeScript, Vite, Fabric.js.

## Global constraints

- Follow docs/SCOPE.md and docs/BRIDGE.md; the complete evaluation is archived as source material, not a claim that the full product is implemented.
- Work in the isolated clone at D:\codex\2026-10-19\task\screenshot; preserve the original F: directory.
- Do not call real paid APIs, expose keys, or commit private captures or task exports.
- Build and test before stage commits; run the actual Windows host before final delivery.

## Task 1: Documentation and integration (integrator)

- [x] Persist the available source preview, then supplement it with the complete source received through the supported cloud conversation interface.
- [ ] Create solution, build/test scripts, CI, readme, validation matrix and task handoffs.
- [ ] Review every worker diff and verify native/editor contracts match.

## Task 2: Native host (native worker)

Files: src/Screenshot.App excluding Ai/ and ProviderSettingsWindow.*.
Consumes: docs/BRIDGE.md and Screenshot.AI provider service public contracts.
Produces: packaged WPF host, origin-restricted bridge, image import/export/clipboard, freeze-region capture, desktop capture, project persistence and global hotkey.

- [ ] Implement the host and OS workflows with explicit cancellation and error paths.
- [ ] Build the project against the local editor output and provider project.
- [ ] Report implemented behavior and unverified hardware cases to integrator.

## Task 3: Editor (editor worker)

Files: editor/.
Consumes: docs/BRIDGE.md.
Produces: locally bundled editor with raw/beautify/reflow modes, export, project IO, OCR/translation controls, safe state validation and useful tests.

- [ ] Implement the editor and bridge client with correlated requests and timeouts.
- [ ] Add tests for document validation, sizing/render behavior and bridge errors.
- [ ] Run npm test and npm run build; report browser validation needs.

## Task 4: Provider adapters (AI worker)

Files: src/Screenshot.AI/, src/Screenshot.App/ProviderSettingsWindow.*, tests/Screenshot.AI.Tests/.
Consumes: docs/BRIDGE.md.
Produces: public settings DTOs, DPAPI-backed native secret storage, two HTTP adapters and tests using fake HTTP handlers.

- [ ] Define the exact callable service contract with the native worker before integration.
- [ ] Test HTTP payload/response/error/cancellation behavior without external API calls.
- [ ] Show clear errors for unavailable local OCR and invalid configuration.

## Task 5: Verification and delivery (integrator)

- [ ] Run editor tests/build and dotnet test/build from scripts/verify.ps1.
- [ ] Run the real host; exercise import, mode changes, export, project roundtrip, capture and native error/configuration states.
- [ ] Inspect actual exported image pixels/dimensions and fix failures; record tested versus untested explicitly.
- [ ] Inspect staged files for credentials/captures/temp outputs, commit and push to verified Notesae/screenshot.
- [ ] Match remote SHA and follow GitHub Actions; publish runnable output location.
