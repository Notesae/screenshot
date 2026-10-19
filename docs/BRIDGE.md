# Native bridge v1

The trusted editor is served only from `https://app.screenshot.local/`. No remote page may invoke native actions. All commands use `window.chrome.webview.postMessage`.

Request: `{ id: string, method: string, payload?: object }`.
Success: `{ id: string, ok: true, result: unknown }`.
Failure: `{ id: string, ok: false, error: { code: string, message: string } }`.
Unsolicited capture: `{ event: "image.loaded", payload: LoadedImage }`.

`LoadedImage = { dataUrl: string, name: string, width: number, height: number }`.
User cancellation returns null (or saved:false); it is not an exception.

| Method | Payload | Result |
|---|---|---|
| app.info | {} | { version, platform, capture:{backend,colorMode,supportsHdr}, capabilities: string[] } |
| image.open | {} | LoadedImage or null |
| image.paste | {} | LoadedImage or null |
| capture.screen | {} | LoadedImage or null |
| capture.region | {} | LoadedImage or null |
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

Project documents use `{ schemaVersion:1, image:LoadedImage|null, editor:object }`. The editor validates its own version and value bounds before restoring. No executable code or network image URLs are accepted as project image sources.

The current native capture backend reports `backend:"gdi", colorMode:"sdr", supportsHdr:false`. Local UI/capture operations share one gate; AI requests use a separate gate. Public metadata/settings reads remain available. A running AI request does not prevent saving/copying an existing document or importing another image; the editor rejects stale AI results after a document switch or text edit.
