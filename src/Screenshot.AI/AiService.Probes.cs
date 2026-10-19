namespace Screenshot.AI;
public sealed partial class AiService
{
    /// <summary>仅用户显式点击才探测，使用固定合成输入并绕过缓存；返回文字不等于OCR准确率。</summary>
    public Task<AiTextResult> ProbeAsync(string providerId,string kind,CancellationToken token=default)=>ExecuteAsync(async ct=>{
        if(kind is not ("text" or "image"))throw new AiProviderException("invalid_probe","请选择文字或图片测试。");
        var provider=await GetProviderAsync(providerId,ct);
        const string image="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
        const string prompt="Describe the image color briefly.";
        object messages=kind=="text"?new[]{new{role="user",content="Reply briefly with PROBE_OK."}}
            :provider.Kind=="ollama"?new[]{new{role="user",content=prompt,images=new[]{image}}}
            :new[]{new{role="user",content=new object[]{new{type="text",text=prompt},new{type="image_url",image_url=new{url="data:image/png;base64,"+image}}}}};
        var result=await SendAsync(provider,messages,ct);
        lock(_cacheSync)Record("probe-"+kind,result);
        return result;
    },token);
}
