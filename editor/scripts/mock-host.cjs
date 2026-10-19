// Shared isolated synthetic host fixture; never connects to an application or user profile.
async function installMock(page, options = {}) {
  await page.addInitScript(options => {
    const listeners = [];
    window.__mockOptions=options; window.__failNext={}; window.__messages = []; window.__heldMethods = []; window.__holdMethod = null; window.__recoveries = {}; window.__captureBackend = 'gdi';
    window.__heldDecodes = []; window.__heldReady = []; window.__holdReady = false; window.__currentCaptureId = null; window.__hotkey={enabled:true,ctrl:true,alt:false,shift:true,key:'S'};window.__snapSettings={snapWindows:true,windowArea:'window'};window.__providerRevision='a'.repeat(64);
    window.__emit = data => {
      if (data.event === 'image.loaded' && data.payload.overlay) window.__currentCaptureId = data.payload.overlay.captureId;
      if (data.event === 'presentation.changed' && (!data.payload.timedOutCaptureId || data.payload.timedOutCaptureId === window.__currentCaptureId)) window.__currentCaptureId = null;
      listeners.forEach(listener => listener({ data }));
    };
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(HTMLImageElement.prototype, 'src', { ...descriptor, set(value) {
      if (value === window.__holdNextDecodeURL) { window.__holdNextDecodeURL = null; window.__heldDecodes.push(() => descriptor.set.call(this, value)); }
      else descriptor.set.call(this, value);
    } });
    const webview = {
      addEventListener(type, listener) { if (type === 'message') listeners.push(listener); },
      removeEventListener(type, listener) { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1); },
      postMessage(request) {
        window.__messages.push(request);
        const failure=window.__failNext[request.method];
        if(failure){delete window.__failNext[request.method];setTimeout(()=>window.__emit({id:request.id,ok:false,error:failure}),0);return;}

        if (request.method === window.__holdMethod) { window.__heldMethods.push(request); return; }
        if (request.method === 'presentation.ready' && window.__holdReady) { window.__heldReady.push(request); return; }
        const results = { 'settings.read': { providers: [{ id: 'synthetic', name: '模拟服务', kind: 'ollama', model: 'test', baseUrl: 'http://127.0.0.1:0', hasApiKey: false, revision:window.__providerRevision }], defaultProviderId: 'synthetic' }, 'image.open': window.__openImage, 'image.copy': { copied: true }, 'text.copy': { copied:true }, 'image.save': { saved: true }, 'project.save': { saved: true }, 'ai.ocr': { text: '仅用于无头测试的合成文字' } };
        let result = request.method==='settings.read'&&options.settings?options.settings:request.method==='project.open'?window.__projectDocument:results[request.method];
        if (request.method === 'ocr.status') result = options.localStatus || { available: true, modelVersion: 'synthetic', message: 'synthetic only', missingFiles: [] };
        if (request.method === 'ai.cancel') result={cancelled:true};
        if (request.method === 'ocr.cancel') result = { cancelled: true };
        if (request.method === 'ocr.local') result = window.__ocrResult || { modelVersion: 'synthetic', imageWidth: 80, imageHeight: 60, blocks: [{ id: 'block-a', polygon: [{x:1,y:1},{x:38,y:1},{x:38,y:20},{x:1,y:20}], text:'<b>原文</b>', confidence:.9, order:0 }, { id:'block-b', polygon:[{x:42,y:22},{x:78,y:22},{x:78,y:45},{x:42,y:45}], text:'second', confidence:null, order:1 }] };
        if (request.method === 'ai.translate') {
          if(window.__failBlockB&&request.payload.text==='second'&&!window.__failedBlockB){window.__failedBlockB=true;setTimeout(()=>window.__emit({id:request.id,ok:false,error:{code:'provider_rate_limited',message:'synthetic rate limit'}}),0);return;}

          if(window.__chunkMode && request.payload.text.startsWith('乙') && !window.__failedChunk){window.__failedChunk=true;setTimeout(()=>window.__emit({id:request.id,ok:false,error:{code:'provider_rate_limited',message:'模拟429限流'}}),0);return;}
          result = { text:window.__chunkMode?'translated-'+request.payload.text.slice(0,1):'synthetic translation' };
        }
        if(request.method==='ai.test')result={text:'PROBE_OK'};
        if(request.method==='ai.usage')result={items:[]};
        if (request.method === 'capture.settings') result = { backend:window.__captureBackend,...window.__snapSettings };
        if(request.method==='capture.monitors')result={monitors:[{handle:'9007199254740993',label:'Synthetic left',bounds:{x:-1920,y:-240,width:1920,height:1080},primary:false,current:true},{handle:'2',label:'Synthetic right',bounds:{x:0,y:0,width:2560,height:1440},primary:true,current:false}]};
        if(request.method==='capture.current'||request.method==='capture.screen')result={cancelled:true};
        if(request.method==='hotkey.read')result={binding:window.__hotkey,registered:true,applied:true,message:'synthetic current'};
        if(request.method==='hotkey.configure'){const conflict=request.payload.key==='Q';if(!conflict)window.__hotkey=request.payload;result={binding:window.__hotkey,registered:window.__hotkey.enabled,applied:!conflict,message:conflict?'synthetic conflict; original retained':'synthetic saved'};}

        if (request.method === 'capture.configure') { window.__captureBackend = request.payload.backend;for(const name of ['snapWindows','windowArea'])if(request.payload[name]!==undefined)window.__snapSettings[name]=request.payload[name]; result = { backend:window.__captureBackend,...window.__snapSettings }; }
        if (request.method === 'recovery.save') {
          const existing = window.__recoveries[request.payload.documentId], stale = Boolean(existing && existing.revision >= request.payload.revision);
          if (!stale) window.__recoveries[request.payload.documentId] = request.payload;
          result = { saved:!stale, stale };
        }
        if (request.method === 'recovery.list') result = { items:Object.values(window.__recoveries).map(item => ({ documentId:item.documentId, revision:item.revision, name:item.document.image?.name || 'synthetic text', updatedAtUtc:'2026-10-19T00:00:00Z' })) };
        if(request.method==='recovery.usage') result={documents:Object.keys(window.__recoveries).length,referencedAssetBytes:128,maxDocuments:20,maxAssetBytes:268435456};
        if(request.method==='recovery.deleteMany'){let deleted=0;for(const id of request.payload.documentIds){if(window.__recoveries[id]){delete window.__recoveries[id];deleted++;}}result={deleted,cleanupPending:false};}
        if (request.method === 'recovery.load') result = window.__recoveries[request.payload.documentId];
        if (request.method === 'recovery.delete') { delete window.__recoveries[request.payload.documentId]; result = { deleted:true }; }

        if (request.method.startsWith('presentation.')) {
          const active = window.__currentCaptureId;
          const accepted = active ? request.payload.captureId === active : request.payload.captureId === undefined;
          const target = request.method === 'presentation.ready' ? 'overlay' : request.method === 'presentation.workbench' ? 'workbench' : 'hidden';
          if (accepted && target !== 'overlay') window.__currentCaptureId = null; window.__hotkey={enabled:true,ctrl:true,alt:false,shift:true,key:'S'};window.__snapSettings={snapWindows:true,windowArea:'window'};window.__providerRevision='a'.repeat(64);
          result = { accepted, presentation: accepted ? target : active ? 'overlay' : 'workbench', captureId: window.__currentCaptureId };
        }
        setTimeout(() => window.__emit(result ? { id: request.id, ok: true, result } : { id: request.id, ok: false, error: { code: 'MOCK', message: '测试未模拟此操作' } }), ['image.copy','project.save'].includes(request.method)?75:0);
      },
    };
    window.chrome = window.chrome || {};
    Object.defineProperty(window.chrome, 'webview', { value: webview });
    Object.defineProperty(navigator, 'clipboard', { value: { read() { throw new Error('测试禁止读取剪贴板'); }, readText(){throw new Error('测试禁止读取剪贴板');}, writeText(){throw new Error('测试禁止写入剪贴板');}, write() { throw new Error('测试禁止写入剪贴板'); } } });
  }, options);
}

module.exports = { installMock };
