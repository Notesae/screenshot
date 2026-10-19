# P0 capture, editing, OCR and recovery implementation plan

> **For agentic workers:** implement assigned modules independently, then integrate and review each verified slice. The user authorized continued parallel work, staged commits and pushes. Desktop interaction tests remain prohibited.

**Goal:** Add the next P0 capabilities while retaining the delivered frozen-desktop in-place editing flow.

**Architecture:** WPF retains OS capture, secrets and local services; a versioned React document drives canvas/export/history. OCR runs native ONNX CPU, while SQLite stores immutable assets and recoverable document snapshots.

**Tech Stack:** .NET 10/WPF/WebView2, React/TypeScript/Fabric 7, Windows Graphics Capture, ONNX Runtime CPU/OpenCvSharp, SQLite.

## Global Constraints

- Follow AGENTS.md and docs/superpowers/specs/2026-10-19-p0-design.md.
- No actual capture, GUI windows, focus, keys, clipboard or global hotkeys during validation.
- Build to isolated artifacts directories; simultaneous local MSBuild processes each use `-m:1`; OCR uses intra-op 2/inter-op 1.
- Freeze/background pixels stay native. No runtime model downloads, external AI calls or credentials in projects/logs.
- Check fixed model SHA256; distribute applicable licenses/notices. User explicitly approved Microsoft Windows SDK standard terms for the WGC targeting pack and CI restore.

### Task 1: WGC backend — native_host

**Files:** src/Screenshot.App/CaptureService.cs, new WGC interop/frame reader modules, MainWindow.xaml.cs, Screenshot.App.csproj; src/Screenshot.App.Tests.

**Interfaces:** `Task<CapturedFrame?> ICaptureBackend.CaptureAsync(CaptureRequest request,CancellationToken token)`; CaptureRequest selects backend/desktop-monitor-window target/region/deadline; CapturedFrame retains native frozen desktop and sends only cropped image/geometry.

- [ ] Write fake-session assertions for timeout/cancel/resize/frame ownership; verify failure before implementing.
- [ ] Implement WGC CreateFreeThreaded frame pool and SoftwareBitmap deep copy; release frame before pool recreation, and dispose session/pool/device on every exit.
- [ ] Compose physical monitor frames and preserve negative coordinates. Add explicit GDI choice with truthful backend metadata; never silently fallback.
- [ ] Accept project schema 1/2 and retain existing origin/request/presentation guards.
- [ ] Run isolated App build and console assertions without constructing a capture session against real hardware.

### Task 2: Editing/history — editor

**Files:** editor/src/document.ts, history.ts, render.ts, EditorCanvas.tsx, App.tsx, CompactOverlay.tsx, related tests and headless script.

**Interfaces:** schemaVersion 2 reads v1; `imageForProcessing(document:ProjectDocument):Promise<LoadedImage>` applies crop/resize only; history `reset/commit/undo/redo/currentRevision` shares image references.

- [ ] Add failing transaction/history tests for redo invalidation, coalesced edits and immutable image reuse.
- [ ] Implement text/rectangle/arrow/highlight/solid cover white-list serialization and history across object changes and AI results.
- [ ] Add original-image crop plus proportional resize with bounds validation and matching annotation transforms.
- [ ] Preserve compact default, raw/beauty anchor and focused text/IME keyboard routing.
- [ ] Run Vitest/build and safe synthetic headless regressions, then report exact coverage/limits.

### Task 3: ONNX OCR — ai_providers

**Files:** src/Screenshot.Ocr, tests/Screenshot.Ocr.Tests. Integrator owns model manifest/preparation, license files and host bridge wiring.

**Interfaces:** `LocalOcrService(string modelDirectory)`, `GetStatus():LocalOcrStatus`, `RecognizeAsync(byte[] png,CancellationToken):Task<OcrDocument>`. Document includes modelVersion/imageWidth/imageHeight/text/blocks; each block has stable ID, polygon, text, nullable confidence and order. Errors expose LocalOcrException.Code.

- [ ] Assert missing/invalid models and invalid/oversized image rejection before implementation.
- [ ] Verify det/rec model SHA256 and recognizer metadata character dictionary; use matching blank/space class indices.
- [ ] Test DB bitmap/box postprocessing, source-coordinate restoration, CTC repeated/blank decoding and cancellation with deterministic data.
- [ ] Implement limited CPU ONNX sessions and bounded image/block processing; keep image/text out of diagnostic logs.
- [ ] Generate owned English/Chinese bitmap fixtures entirely in memory; run actual local inference and record observed recognition/errors and timing.

### Task 4: OCR correction/bilingual — editor + integrator after E1/O1

**Files:** new editor OCR document/validation components and tests; native local feature bridge; docs/BRIDGE.md.

**Interfaces:** `ocr.status`, `ocr.local {imageDataUrl}`, `ocr.cancel`; local output joins the current document only when its request revision still matches. Corrections keep original text, block IDs and source geometry, translation uses existing native adapters with revision checks.

- [ ] Test stale recognition/translation cannot replace user corrections or a new document.
- [ ] Add block correction, original/translated text and bilingual rendering without sending frozen background or secrets.
- [ ] Include OCR/AI edits in undo/redo and project validation; headless exports must retain complete long text.

### Task 5: SQLite recovery — integrator/next available worker

**Files:** src/Screenshot.Storage, tests/Screenshot.Storage.Tests, host feature bridge and editor recovery/autosave integration.

**Interfaces:** save snapshots by document ID/revision using immutable PNG assets keyed by SHA256; list/load/delete recoveries. Reject stale revisions and corrupt/missing assets; do not automatically open recovered private content.

- [ ] Add failing tests for interrupted writes, duplicate assets, stale revision rejection and corruption.
- [ ] Write immutable asset atomically, then update SQLite snapshot transaction; keep prior valid snapshot on failure.
- [ ] Bound retained documents/storage and prune orphan assets safely within the store root.
- [ ] Connect debounced autosave and explicit restore/list/delete UI; mark in-memory changes unsaved on error rather than claiming success.

### Task 6: Slice verification and saving — integrator

- [ ] Update root solution/verify/publish/CI for new projects, pinned models and licenses.
- [ ] Independently run relevant tests/builds, review module boundaries and check credentials/private images/temporary files.
- [ ] Commit each coherent validated slice and push normally to Notesae/screenshot; follow its CI and verify remote SHA.
- [ ] Retain stage-specific artifacts and evidence, separately label hardware/UI/real-provider tests not performed.
