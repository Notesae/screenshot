namespace Screenshot.AI;
public sealed partial class AiService
{
    /// <summary>仅用户显式点击才探测，使用固定合成输入并绕过缓存；返回文字不等于OCR准确率。</summary>
    public Task<AiTextResult> ProbeAsync(string providerId,string kind,CancellationToken token=default)=>ProbeCoreAsync(providerId,kind,null,token);

    /// <summary>测试原生表单草稿，空密钥沿用本机已存密钥；不会保存草稿或把密钥返回前端。</summary>
    public Task<AiTextResult> ProbeDraftAsync(ProviderUpdate draft,CancellationToken token=default,IProgress<string>? progress=null)=>ProbeCoreAsync(draft.Id,"text",draft,token,progress);

    // 已保存配置与未保存草稿共用固定输入和协议，始终绕过缓存，避免旧成功伪装为当前可连接。
    private Task<AiTextResult> ProbeCoreAsync(string providerId,string kind,ProviderUpdate? draft,CancellationToken token,IProgress<string>? progress=null)=>ExecuteAsync(async ct=>{
        if(kind is not ("text" or "image"))throw new AiProviderException("invalid_probe","请选择文字或图片测试。");
        StoredProvider provider;
        if(draft is null)provider=await GetProviderAsync(providerId,ct);
        else
        {
            Validate(draft);
            provider=await _store.AccessAsync(settings=>
            {
                var previous=settings.Providers.FirstOrDefault(item=>item.Id==providerId);
                var secret=draft.ClearApiKey?null:string.IsNullOrWhiteSpace(draft.ApiKey)?previous?.ProtectedApiKey:AiSettingsStore.Protect(draft.ApiKey.Trim());
                var temporary=new StoredProvider(providerId,draft.Name.Trim(),draft.Kind,draft.Model.Trim(),draft.BaseUrl.Trim().TrimEnd('/'),secret);
                return Task.FromResult<(StoredProvider,StoredSettings?)>((temporary,null));
            },ct);
            if(provider.Kind=="openai-compatible"&&string.IsNullOrEmpty(provider.ProtectedApiKey))throw new AiProviderException("api_key_required","请填写 API 密钥后再测试连接。");
        }
        const string image="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
        const string prompt="Describe the image color briefly.";
        object messages=kind=="text"?new[]{new{role="user",content="Reply briefly with PROBE_OK."}}
            :provider.Kind=="ollama"?new[]{new{role="user",content=prompt,images=new[]{image}}}
            :new[]{new{role="user",content=new object[]{new{type="text",text=prompt},new{type="image_url",image_url=new{url="data:image/png;base64,"+image}}}}};
        // 设置里的连接测试使用实际翻译示例，兼容只接受 user 文本的专用翻译模型。
        if(draft is not null)messages=new[]{new{role="user",content="把下面的文本翻译成简体中文，不要额外解释。\n\nHello."}};
        // 探测只需要短响应，避免固定短句也等待服务默认的长输出预算。
        var result=await SendAsync(provider,messages,ct,outputLimit:64,progress:progress);
        ct.ThrowIfCancellationRequested();
        lock(_cacheSync)Record("probe-"+kind,result);
        return result;
    },token,TimeSpan.FromSeconds(30));
}
