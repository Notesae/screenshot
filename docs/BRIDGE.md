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

`OcrDocument = {modelVersion,imageWidth,imageHeight,blocks:{id,polygon:{x,y}[],text,confidence:number|null,order}[],text}`. Coordinates refer to the cropped/resized content PNG supplied to OCR, with no annotations, decoration or frozen desktop. Local OCR accepts only PNG, with a 20 MB / 32 million pixel limit and further bounded line/block limits. No network fallback or runtime model download occurs. available confirms fixed model hashes; native CPU runtime is loaded lazily at first explicit recognition.

Recovery has a dedicated serialized SQLite transaction queue and does not take the native dialog or inference lane. Revision is nonnegative and monotonically increasing per document ID; equal/older saves cannot overwrite a newer snapshot. Assets are addressed by SHA256 and reconstructed only after validation. Load/delete accept IDs, never paths. Recovery stores original images and OCR text in the user's local profile; it is not an encrypted vault. List shows metadata only; restoring content requires an explicit selection. Capacity cleanup may evict the oldest snapshots. A cleanupPending result means the snapshot committed successfully but asset deletion will be retried later.

Capture success prepares a hidden native overlay. The editor maps geometry using viewport width/desktop width and viewport height/desktop height independently, commits its compact canvas, then acknowledges captureId with presentation.ready. Stale acknowledgements must not show a dismissed overlay or replace a newer capture. Workbench/dismiss clear the frozen backdrop and pending capture. Cancelling a new selection preserves the prior presentation/document. The frontend consumes Escape for IME/text editing or an open property panel before requesting dismissal; native Escape must not preempt this routing.

If no matching ready arrives within 15 seconds, the native layer releases that backdrop, restores the workbench and sends `{ event:"presentation.changed", payload:{ presentation:"workbench", reason:"overlay_timeout", timedOutCaptureId:string } }`. The editor must not recreate an overlay for that expired ID if its image decode completes later. Presentation replies include the current capture ID so an old rejection cannot clear a newer frontend overlay. The desktop-test pause does not verify the real transparency or hidden-window layout behavior of this protocol.

While overlay/selection is active, workbench/dismiss without a capture ID are rejected too. An omitted ID is valid only when already in workbench/hidden mode and not selecting. The tray recovery entry emits presentation.changed with reason:"user_workbench" and invalidatedCaptureId for any released frame; it provides access to the in-memory document even if global hotkey registration failed. These are presentation events, not new document loads.
