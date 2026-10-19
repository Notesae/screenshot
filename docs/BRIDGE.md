# Native bridge v1

The trusted editor is served only from `https://app.screenshot.local/`. No remote page may invoke native actions. All commands use `window.chrome.webview.postMessage`.

Request: `{ id: string, method: string, payload?: object }`.
Success: `{ id: string, ok: true, result: unknown }`.
Failure: `{ id: string, ok: false, error: { code: string, message: string } }`.
Unsolicited capture: `{ event: "image.loaded", payload: CaptureEnvelope }`.

`LoadedImage = { dataUrl: string, name: string, width: number, height: number }`.
`PixelRect = { x:number, y:number, width:number, height:number }` uses absolute physical desktop pixels; x/y may be negative.
`CaptureEnvelope = { image:LoadedImage, overlay:{ captureId:string, desktopBounds:PixelRect, selection:PixelRect, screens:{bounds:PixelRect,primary:boolean}[] } }`.
The frozen full desktop remains native-only. Only the cropped image enters the editor document, project, export or AI payload. Ordinary image.open/paste results remain LoadedImage.
User cancellation returns null (or saved:false); it is not an exception.

| Method | Payload | Result |
|---|---|---|
| app.info | {} | { version, platform, capture:{backend,colorMode,supportsHdr}, capabilities: string[] } |
| image.open | {} | LoadedImage or null |
| image.paste | {} | LoadedImage or null |
| capture.screen | {} | CaptureEnvelope or null |
| capture.region | {} | CaptureEnvelope or null |
| presentation.ready | { captureId:string } | { presentation, accepted:boolean, captureId:string\|null }; only the matching pending capture may become visible |
| presentation.workbench | { captureId?:string } | same presentation result; a supplied obsolete ID cannot clear a newer capture |
| presentation.dismiss | { captureId?:string } | same presentation result; a supplied obsolete ID cannot hide a newer capture |
| image.save | { dataUrl, suggestedName } | { saved:boolean, path?:string } |
| image.copy | { dataUrl } | { copied:boolean } |
| text.copy | { text:string } | { copied:boolean }; explicit clipboard write, max100000 characters |
| project.open | {} | { name:string, document:object } or null |
| project.save | { document:object, suggestedName:string } | { saved:boolean, path?:string } |
| settings.read | {} | { providers: PublicProvider[], defaultProviderId?:string } |
| settings.configure | {} | same public settings; native dialog stores secrets |
| ai.ocr | { providerId, imageDataUrl } | { text:string } |
| ai.translate | { providerId, text, targetLanguage } | { text:string } |

`PublicProvider = { id, name, kind, model, baseUrl, hasApiKey }`.
Provider kinds are `openai-compatible` and `ollama`. No API key is returned to JavaScript or included in project documents. HTTP adapters execute only in the native process after explicit OCR/translate actions.

Project documents use `{ schemaVersion:2, image:LoadedImage|null, editor:object }`; v1 remains readable and is upgraded in memory. The editor validates its own version and value bounds before restoring. No executable code or network image URLs are accepted as project image sources.

The default native capture backend reports `backend:"wgc", colorMode:"sdr", supportsHdr:false`. GDI is an explicit compatibility option; failures never silently change backend. Local UI/capture operations share one gate; cloud AI and local OCR requests use a separate gate. Public metadata/settings reads and OCR cancellation remain available. A running inference request does not prevent saving/copying an existing document or importing another image; the editor rejects stale results after a document or revision change.

## P0 additions

Region selection retains the frozen frame after dragging: drag edges/corners or interior to adjust, arrows move one physical pixel, Shift+arrows resize, Ctrl uses ten pixels, Enter/double-click confirms, Escape/right-click cancels, M toggles the frozen-pixel magnifier. This interaction has only model validation until desktop testing resumes.

`capture.screen` and `capture.region` accept `{backend?:"wgc"|"gdi",target?:{kind:"desktop"|"monitor"|"window",handle?:string,area?:"window"|"client"},timeoutMs?:number}`. Native handles are nonzero decimal or `0x` strings, never JS numbers. Desktop is the default; monitor/window require an explicit valid handle. Timeout is 100–30000 ms (default 8000). Capture overlay metadata also reports the actual `backend`, `colorMode:"sdr"`, and `supportsHdr:false`. WGC uses BGRA8; HDR fidelity is not claimed. Availability is checked on capture without enumerating targets during app.info.

| Method | Payload | Result |
|---|---|---|
| capture.settings | {} | {backend:"wgc"\|"gdi"} |
| capture.configure | {backend:"wgc"\|"gdi"} | same; shared process default for toolbar, tray and hotkey, reset on app restart |
| ocr.status | {} | {available,modelVersion,message,missingFiles:string[]} |
| ocr.local | {imageDataUrl:string} | OcrDocument |
| ocr.cancel | {} | {cancelled:boolean}; inference request completes with cancelled error |
| recovery.save | {documentId:string,revision:number,document:ProjectDocument} | {saved,stale,documentId,revision,cleanupPending} |
| recovery.list | {} | {items:{documentId,revision,name,updatedAtUtc}[]} |
| recovery.load | {documentId:string} | {documentId,revision,document:ProjectDocument} |
| recovery.delete | {documentId:string} | {deleted:boolean,cleanupPending?:boolean} |

`OcrDocument = {modelVersion,imageWidth,imageHeight,blocks:{id,polygon:{x,y}[],text,confidence:number|null,order}[],text}`. Coordinates refer to the cropped/resized content PNG supplied to OCR. Solid cover privacy masks are applied before resizing; rotated covers conservatively redact their bounding rectangle plus a sampling margin. Other annotations, decoration and frozen desktop are excluded. Covers in reflow coordinates cannot be mapped safely and block OCR until the user returns to raw/beauty mode. Previously recognized text and editable project source images remain sensitive. Local OCR accepts only PNG, with a 20 MB / 32 million pixel limit and further bounded line/block limits. No network fallback or runtime model download occurs. available confirms fixed model hashes; native CPU runtime is loaded lazily at first explicit recognition.

Recovery has a dedicated serialized SQLite transaction queue and does not take the native dialog or inference lane. Storage revision is a nonnegative monotonic write sequence per document ID, independent of the editor's undo/history revision; retries allocate a newer write revision too. Equal/older saves cannot overwrite a newer snapshot. Assets are addressed by SHA256 and reconstructed only after validation. Load/delete accept IDs, never paths. Recovery stores original images and OCR text in the user's local profile; it is not an encrypted vault. List shows metadata only; restoring content requires an explicit selection. Capacity cleanup may evict the oldest snapshots. A cleanupPending result means the snapshot committed successfully but asset deletion will be retried later.

Capture success prepares a hidden native overlay. The editor maps geometry using viewport width/desktop width and viewport height/desktop height independently, commits its compact canvas, then acknowledges captureId with presentation.ready. Stale acknowledgements must not show a dismissed overlay or replace a newer capture. Workbench/dismiss clear the frozen backdrop and pending capture. Cancelling a new selection preserves the prior presentation/document. The frontend consumes Escape for IME/text editing or an open property panel before requesting dismissal; native Escape must not preempt this routing.

If no matching ready arrives within 15 seconds, the native layer releases that backdrop, restores the workbench and sends `{ event:"presentation.changed", payload:{ presentation:"workbench", reason:"overlay_timeout", timedOutCaptureId:string } }`. The editor must not recreate an overlay for that expired ID if its image decode completes later. Presentation replies include the current capture ID so an old rejection cannot clear a newer frontend overlay. The desktop-test pause does not verify the real transparency or hidden-window layout behavior of this protocol.

While overlay/selection is active, workbench/dismiss without a capture ID are rejected too. An omitted ID is valid only when already in workbench/hidden mode and not selecting. The tray recovery entry emits presentation.changed with reason:"user_workbench" and invalidatedCaptureId for any released frame; it provides access to the in-memory document even if global hotkey registration failed. These are presentation events, not new document loads.


## 0.3.0 task and storage additions

`ocr.local`, `ai.ocr`, `ai.translate` accept an optional bounded ASCII `taskId`; the editor always sends a fresh UUID. `ai.cancel {taskId}` cancels only that active identity, bypassing the inference gate. The older unscoped `ocr.cancel` is retained for v0.2 compatibility; the new editor uses scoped cancellation for OCR, translation and probes. A cancelled/obsolete result never joins a newer document/revision/configuration.

`ai.test {providerId,kind:"text"|"image",taskId}` performs an explicit noncached request with fixed synthetic input. Its text response proves only that this request returned text; it is not an accuracy/structure/general-capability claim. The UI warns that the provider may charge. Automatic validation uses mocked HTTP only.

`ai.usage {}` returns `{items:{atUtc,operation,cached,usage:{inputTokens:number|null,outputTokens:number|null}|null,errorCode:string|null}[]}`: last128 process-memory summaries, no user text/images/keys/URL. Missing provider usage remains unknown; no cost estimate. OCR/translation cache: max32 results, max200000 UTF16 characters, 15minute TTL, SHA256 identity over provider configuration/model/protected-key/operation/input; process-only, no persistent screenshot cache. Cache hits report no new token use. HTTP401/403,429,400/404/422 and5xx have distinct categories; no automatic paid retry or fallback occurs.

Long translations run sequentially in <=2000 Unicode-codepoint chunks and keep successful blocks in the editor task. Only failed blocks retry on explicit click; source document/revision/provider/target changes prevent reuse. No partial result overwrites current text. The overall20000-character output limit remains explicit.

`recovery.usage {}` returns `{documents,referencedAssetBytes,maxDocuments,maxAssetBytes}` for metadata and deduplicated currently referenced PNG bytes; SQLite/WAL and temporarily undeletable orphan files are separate. `recovery.deleteMany {documentIds:string[]}` accepts1–1000 validated IDs and deletes atomically, returning `{deleted:number,cleanupPending:boolean}`. The UI confirms selection and waits for active autosave before deleting; memory edits remain. A rollback preserves all selected records.

Schema2 gains optional `borderWidth/borderColor`, `lineSpacing/paragraphSpacing` and `translationSource` fields with bounded defaults. Translation source differs from the current text => stale; unknown legacy source remains unconfirmed. Presets contain only validated appearance fields, never document/AI content, and live in the local WebView store. Export waits for fonts and redraws text at target scale using shared layout and annotation construction.

## 0.4.0 capture and persisted translation

`capture.settings/configure` additionally expose optional `snapWindows:boolean` and `windowArea:"window"|"client"`; settings are shared for this process. Capture requests may override them. A region snap retains ordered visible-window physical geometry only, never titles or process names; the bounded snapshot is acquired only during an explicit region capture. W toggles snapping and C toggles full/client geometry, including an already snapped selection. Manual adjustment clears that association. No OS enumeration occurs in automated tests.

`capture.monitors {}` explicitly enumerates `{monitors:{handle:string,label:string,bounds:PixelRect,primary:boolean,current:boolean}[]}`. `current` is chosen by greatest overlap with active native selection or workbench bounds, with primary tie fallback. `capture.current {}` captures that WGC monitor. These methods are user-triggered; GDI keeps its existing desktop/region path. Monitor handles stay strings end to end.

`hotkey.read {}` and `hotkey.configure {enabled,ctrl,alt,shift,key}` return `{binding,registered,applied,message,cleanupPending}`. Enabled bindings need Ctrl or Alt; letters/digits/F1–F11 are accepted, Win/F12 combinations excluded. New binding registers on an alternate ID before atomic config save and old binding release. Conflict/save failure preserves prior binding. An unreleased ID cannot trigger a capture after replacement; cleanupPending requires attention/restart. Hotkey settings live under LocalApplicationData/Screenshot/capture-hotkey.json; unreadable files are warned about without automatic overwrite. Production alone calls Win32, tests use fakes.

In-place image drops retain the acknowledged captureId/backdrop, reuse shared image normalization/history/render/export, and remount without a second ready handshake. `contentScale` is frontend-only view metadata; it never changes document.resize or original export bytes. New captures/presentation invalidation take precedence over late file decoding. Editable JSON imports remain an explicit workbench action.

Public AI provider DTO gains `revision`, a SHA256 identity of native configuration (including protected-key identity), never raw credentials. `ai.ocr/ai.translate` may supply `providerRevision`; mismatch returns `provider_configuration_changed` before HTTP or cache lookup. Legacy omitted revisions remain supported; the new editor sends it and cannot resume persisted tasks without matching identity.

Schema2 adds optional `translationData:{schemaVersion:1,source,providerId,providerRevision,targetLanguage,chunks}`. Chunks retain stable id, sourceBlockId or null, exact source slice, generatedText, corrected text, status and bounded error. Sources concatenate exactly to source; all output and aggregate limits are validated, unknown fields discarded. Running state loads as pending. Completed chunks are reused only with identical source/ID/provider revision/target. OCR links exist only when whole text still equals source-block text. Full source edits suspend mapping and retries; new translations may reuse unchanged successful blocks. Each progress update joins shared undo/autosave history while validating the external request stamp. Explicit full translation deletion clears metadata. Saved project/SQLite contain sensitive source and text; they are not sanitized exports.

## 0.4.1 quality implementation

Bridge and project schemas remain unchanged. Recovery codec strips image.dataUrl while streaming bounded metadata, decodes Base64 without an entire-image substring, and restores its own generated ASCII Base64 without worst-case string escaping buffers. Duplicate top-level/image fields and oversized metadata are rejected; Unicode and unknown metadata remain roundtrippable. Existing schema1 recovery stores do not rewrite schema version on each read; actual load/GC still use write-reserved transactions. No new asset-ID IPC is claimed.

Portable diagnostics now consume native-dependencies.json and recheck external direct DLL requirements on the target host (including Visual C++ runtime); build-machine availability flags are not reused as target facts. Diagnostics do not load DLLs or install prerequisites.

Windows中断写入后观测到的SQLite IOERR_TRUNCATE（1546）仅对Load/List/Usage等幂等读取有限重开两次，额外等待共不超过75ms且可取消；写入、缺失资产、权限错误和损坏错误不自动重试，失败仍明确报告，不删除数据库/WAL/SHM。该异常的具体环境成因尚未确定；有旧版对照偶发通过/失败，不能宣称已证明某一底层原因。

## 0.4.2 native source profile

Bridge and project schemas are unchanged. CPU OCR uses the same fixed models and algorithms with a traceable minimal source-built OpenCvSharp native library. Production PNG decoding verifies the normal lazy loading path in tests; benchmarks select explicit native handles only inside an isolated Vendor-profile test executable. No desktop or provider inputs are added.

## 0.4.3 editor workflow

Bridge/project schemas remain unchanged. Workbench zoom/scroll is view-only; capture overlay keeps its physical mapping. Source/translation fields invisible in the current mode no longer rebuild the base image, while document history, autosave and export validation still use the current document. Empty OCR never clears prior corrected work.
