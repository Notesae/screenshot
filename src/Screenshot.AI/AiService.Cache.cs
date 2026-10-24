using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Screenshot.AI;

public sealed partial class AiService
{
    private sealed record CachedResult(string Key,AiTextResult Result,DateTimeOffset Expires);
    private readonly object _cacheSync=new();
    private readonly LinkedList<CachedResult> _cache=new();
    private readonly Queue<AiUsageEntry> _usage=new();
    private int _cachedCharacters;
    public IReadOnlyList<AiUsageEntry> ReadUsage(){lock(_cacheSync)return _usage.ToArray();}
    // 配置、协议、模型、密钥密文、操作及输入共同定义缓存身份，键仅保存 SHA256。
    private async Task<AiTextResult> CachedAsync(StoredProvider provider,string operation,string input,Func<Task<AiTextResult>> work,CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        // JSON 身份字节保持不变，省去整份 UTF-16 中间串。
        var identity=JsonSerializer.SerializeToUtf8Bytes(new[]{provider.Id,provider.Kind,provider.BaseUrl,provider.Model,provider.ProtectedApiKey,operation,input});
        var key=Convert.ToHexString(SHA256.HashData(identity));
        lock(_cacheSync)
        {
            var node=_cache.First;
            while(node is not null){var next=node.Next;if(node.Value.Expires<=DateTimeOffset.UtcNow){_cachedCharacters-=node.Value.Result.Text.Length;_cache.Remove(node);}node=next;}
            for(node=_cache.First;node is not null;node=node.Next)if(node.Value.Key==key){var cached=node.Value;_cache.Remove(node);_cache.AddLast(cached);var result=cached.Result with {Cached=true,Usage=null};Record(operation,result);return result;}
        }
        try
        {
            var result=await work();token.ThrowIfCancellationRequested();
            lock(_cacheSync)
            {
                if(result.Text.Length<=20000)
                {
                    _cache.AddLast(new CachedResult(key,result,DateTimeOffset.UtcNow.AddMinutes(15)));_cachedCharacters+=result.Text.Length;
                    while(_cache.Count>32||_cachedCharacters>200000){_cachedCharacters-=_cache.First!.Value.Result.Text.Length;_cache.RemoveFirst();}
                }
                Record(operation,result);
            }
            return result;
        }
        catch(AiProviderException error){lock(_cacheSync){_usage.Enqueue(new(DateTimeOffset.UtcNow,operation,false,null,error.Code));TrimUsage();}throw;}
    }
    // 调用方持锁；缓存命中不计入服务商新 token 用量，最多保留128条。
    private void Record(string operation,AiTextResult result){_usage.Enqueue(new(DateTimeOffset.UtcNow,operation,result.Cached,result.Usage,null));TrimUsage();}
    private void TrimUsage(){while(_usage.Count>128)_usage.Dequeue();}
}
