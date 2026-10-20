using Screenshot.App.Updates;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;

// 内存 HTTP 与假时钟；没有 OAuth、真实网络、用户安装或桌面操作。
internal static class PublicUpdateTests
{
    internal static async Task<int> RunAsync()
    {
        var checks = 0;
        void Check(bool value, string message) { if (!value) throw new Exception("公开更新测试：" + message); checks++; }
        async Task Reject(Func<Task> action, string? code = null)
        {
            try { await action(); }
            catch (UpdateSourceException e) { Check(code is null || e.Code == code, "受控错误分类"); Check(!e.ToString().Contains("secret-marker"), "响应正文不进入错误"); return; }
            catch (Exception e) when (code is null && e is System.IO.InvalidDataException or InvalidOperationException or OperationCanceledException) { checks++; return; }
            throw new Exception("公开更新测试未拒绝不安全操作。");
        }
        var current = ReleaseVersion.Parse("0.4.8");
        var identity = JsonSerializer.Serialize(new { id=1425162253, full_name="Notesae/screenshot", @private=false, visibility="public" });
        string Release(bool preview=false, string version="0.4.9", long id=42, string? api=null, string? digest=null, bool duplicate=false)
        {
            var asset = new { id, name=$"Screenshot-{version}-win-x64.zip", size=4, digest=digest??"sha256:"+new string('a',64), url=api??"https://api.github.com/repos/Notesae/screenshot/releases/assets/42", browser_download_url=$"https://github.com/Notesae/screenshot/releases/download/v{version}/Screenshot-{version}-win-x64.zip" };
            return JsonSerializer.Serialize(new[]{new{tag_name="v"+version,draft=false,prerelease=preview,body="公开版本说明",assets=duplicate?new[]{asset,asset}:new[]{asset}}});
        }
        var requests = 0;
        using(var source=Source((r,_)=>
        {
            requests++;Check(r.Headers.Authorization is null&&!r.Headers.Contains("Cookie"),"API 始终匿名且无 Cookie");
            Check(r.RequestUri!.Host=="api.github.com"&&r.Method==HttpMethod.Get,"只访问官方只读 API");
            return Task.FromResult(Json(r.RequestUri.AbsolutePath=="/repos/Notesae/screenshot"?identity:Release()));
        }))
        {
            Check((await source.CheckAsync(current,false,default))?.Version.ToString()=="0.4.9","无登录和 Client ID 即可检查");
            Check(requests==2,"先核验不可变仓库身份再列版本");
            Check(await source.CheckAsync(ReleaseVersion.Parse("0.4.9"),false,default) is null,"相同版本不成为候选");
        }
        foreach(var bad in new[]{identity.Replace("1425162253","42"),identity.Replace("Notesae/screenshot","other/screenshot"),identity.Replace("false","true"),identity.Replace("public","private"),"[]"})
        {
            requests=0;using var source=Source((_,_)=>{requests++;return Task.FromResult(Json(bad));});
            await Reject(()=>source.CheckAsync(current,false,default));Check(requests==1,"坏身份不继续读取版本");
        }
        foreach(var badRelease in new[]{Release(id:0),Release(api:"https://api.github.com/repos/evil/repo/releases/assets/42"),Release(api:"https://api.github.com:444/repos/Notesae/screenshot/releases/assets/42"),Release(digest:""),Release(digest:"sha256:secret-marker")})
        {
            using var source=Source((r,_)=>Task.FromResult(Json(r.RequestUri!.AbsolutePath=="/repos/Notesae/screenshot"?identity:badRelease)));
            await Reject(()=>source.CheckAsync(current,false,default));
        }
        using(var source=Source((r,_)=>Task.FromResult(Json(r.RequestUri!.AbsolutePath=="/repos/Notesae/screenshot"?identity:Release(duplicate:true)))))
            await Reject(()=>source.CheckAsync(current,true,default));
        using(var source=Source((r,_)=>Task.FromResult(Json(r.RequestUri!.AbsolutePath=="/repos/Notesae/screenshot"?identity:Release(version:"0.5.0-rc.1")))))
        {
            Check(await source.CheckAsync(current,false,default) is null,"SemVer 预发布不混入默认稳定通道");
            Check(source.HasPreviewReleases&&!source.HasStableReleases,"只有预发布可明确提示而非误报最新版");
            Check((await source.CheckAsync(current,true,default))?.Preview==true,"主动选择才返回预发布");
        }
        foreach(var status in new[]{HttpStatusCode.Unauthorized,HttpStatusCode.Forbidden,HttpStatusCode.NotFound})
        {
            requests=0;using var source=Source((_,_)=>{requests++;return Task.FromResult(new HttpResponseMessage(status){Content=new StringContent("secret-marker")});});
            await Reject(()=>source.CheckAsync(current,false,default),"source_unavailable");Check(requests==1,"访问失败不登录、不重试或切换来源");
        }
        var now=new DateTimeOffset(2026,10,20,0,0,0,TimeSpan.Zero);requests=0;
        using(var source=Source((r,_)=>
        {
            requests++;if(requests==1){var response=new HttpResponseMessage(HttpStatusCode.TooManyRequests);response.Headers.RetryAfter=new(TimeSpan.FromSeconds(30));return Task.FromResult(response);}
            return Task.FromResult(Json(r.RequestUri!.AbsolutePath=="/repos/Notesae/screenshot"?identity:"[]"));
        },()=>now))
        {
            await Reject(()=>source.CheckAsync(current,false,default),"rate_limited");
            await Reject(()=>source.CheckAsync(current,false,default),"rate_limited");Check(requests==1,"限流截止前重复点击零新请求");
            now=now.AddSeconds(31);Check(await source.CheckAsync(current,false,default) is null&&requests==3,"限流后手动重试恢复");
        }
        // 悬挂的首笔读取用于验证重入和取消；取消后原 source 仍能重新检查。
        var started=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);var block=true;
        using(var source=Source(async(r,token)=>
        {
            if(block){started.TrySetResult();await Task.Delay(Timeout.InfiniteTimeSpan,token);}
            return Json(r.RequestUri!.AbsolutePath=="/repos/Notesae/screenshot"?identity:"[]");
        }))
        {
            using var cancellation=new CancellationTokenSource();var first=source.CheckAsync(current,false,cancellation.Token);await started.Task;
            await Reject(()=>source.CheckAsync(current,false,default),"update_busy");cancellation.Cancel();await Reject(()=>first);
            block=false;Check(await source.CheckAsync(current,false,default) is null,"取消释放门控，可重新检查");
        }
        using(var http=new HttpClient(new Http((_,_)=>throw new Exception("不得联网"))))
        {
            http.DefaultRequestHeaders.Authorization=new("Bearer","secret-marker");
            try { using var source=new GitHubUpdateSource(http);throw new Exception("预设认证未拒绝"); }
            catch(ArgumentException){checks++;}
        }
        Console.WriteLine($"PASS {checks} public update identity, anonymous requests, channel, asset trust, throttling and repeated/cancelled operation checks (no real network)");return checks;
    }
    private static GitHubUpdateSource Source(Func<HttpRequestMessage,CancellationToken,Task<HttpResponseMessage>> handle,Func<DateTimeOffset>? now=null)=>new(new HttpClient(new Http(handle)),now);
    private static HttpResponseMessage Json(string text)=>new(HttpStatusCode.OK){Content=new StringContent(text,Encoding.UTF8,"application/json")};
    private sealed class Http(Func<HttpRequestMessage,CancellationToken,Task<HttpResponseMessage>> handle):HttpMessageHandler
    { protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token)=>handle(request,token); }
}
