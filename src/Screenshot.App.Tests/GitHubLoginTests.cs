using Screenshot.App.Updates;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

// 内存 HTTP 与可推进时钟；不连接 GitHub，不创建真实授权或凭据文件。
internal static class GitHubLoginTests
{
    private const string Access = "ghu_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Next = "ghu_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private const string Refresh = "ghr_cccccccccccccccccccccccccccccccccccccccc", Device = "dddddddddddddddddddddddddddddddddddddddd";
    internal static async Task<int> RunAsync()
    {
        var checks = 0;
        void Check(bool value, string message) { if (!value) throw new Exception("GitHub 登录测试：" + message); checks++; }
        async Task Reject(Func<Task> work, string? code = null)
        {
            try { await work(); }
            catch (GitHubLoginException e) { Check(code is null || code == e.Code, "错误分类"); Check(!new[] {Access,Refresh,Device}.Any(s=>e.ToString().Contains(s)), "错误不泄露秘密"); return; }
            catch (OperationCanceledException) when (code == "cancelled") { checks++; return; }
            throw new Exception("GitHub 登录测试未拒绝无效操作。");
        }
        var fake = new Server();
        using (var login = fake.Login(""))
        {
            Check(!login.IsConfigured && login.Status.State == "unconfigured", "缺失 Client ID 明确未配置");
            await Reject(()=>login.LoginAsync(new Prompt(),default),"unconfigured");
            await Reject(async()=>{using var lease=await login.GetLeaseAsync(default);},"unconfigured");
            Check(fake.Requests==0,"未配置不联网");
        }
        fake = new();
        using (var login = fake.Login())
        {
            fake.Errors.Enqueue("authorization_pending"); fake.Errors.Enqueue("slow_down"); GitHubDevicePrompt? prompt=null;
            await login.LoginAsync(new Prompt(p=>prompt=p),default);
            Check(login.HasSession && login.Status.Account=="Notesae","核对账号和仓库读取权限");
            Check(fake.Delays.SequenceEqual(new[]{5d,5d,10d}),"pending/slow_down 遵循官方间隔");
            Check(prompt?.UserCode=="ABCD-EFGH" && prompt.VerificationUri.AbsoluteUri=="https://github.com/login/device","只公开短码和官方页面");
            Check(!new[]{Access,Refresh,Device}.Any(JsonSerializer.Serialize(new{status=login.Status,prompt}).Contains),"公开状态无秘密");
            Check(fake.Forms.All(f=>!f.ContainsKey("client_secret")) && fake.Forms[0]["scope"]=="offline_access","无 client secret 或 repo scope");
            Check(fake.Forms[1]["repository_id"]=="1425162253","固定仓库 ID");
            using var lease=await login.GetLeaseAsync(default);
            using var request=new HttpRequestMessage(HttpMethod.Get,"https://api.github.com/repos/Notesae/screenshot/releases");lease.Authorize(request);
            Check(request.Headers.Authorization?.Parameter==Access,"固定 API 使用内存 Bearer");
            foreach(var url in new[]{"https://evil.example/a","http://api.github.com/repos/Notesae/screenshot/releases","https://api.github.com/repos/other/repo/releases","https://github.com/Notesae/screenshot/releases","https://api.github.com:444/repos/Notesae/screenshot/releases"})
            {
                try { using var r=new HttpRequestMessage(HttpMethod.Get,url);lease.Authorize(r);throw new Exception("越界认证未拒绝"); }
                catch(GitHubLoginException e){Check(e.Code=="unsafe_auth_target","不向其他域、仓库或端口发送认证");}
            }
            login.SignOut();Check(!login.HasSession && lease.Token.IsCancellationRequested,"退出清除会话并取消请求");
            await Reject(async()=>{using var x=await login.GetLeaseAsync(default);},"login_required");
        }
        foreach(var pair in new[]{("access_denied","denied"),("expired_token","expired"),("device_flow_disabled","device_flow_disabled"),("incorrect_client_credentials","client_id_mismatch"),("bad_verification_code","device_code_rejected"),("incorrect_device_code","device_code_rejected"),("unsupported_grant_type","grant_type_rejected"),("unverified_user_email","email_unverified"),("application_suspended","application_suspended"),("unknown","oauth_unrecognized_error"),(Access,"oauth_unrecognized_error")})
        {
            fake=new();fake.Errors.Enqueue(pair.Item1);using var login=fake.Login();
            await Reject(()=>login.LoginAsync(new Prompt(),default),pair.Item2);Check(!login.HasSession,"授权失败不保留会话");
        }
        fake=new(){DeviceExpires=5};using(var login=fake.Login()){await Reject(()=>login.LoginAsync(new Prompt(),default),"expired");Check(fake.Polls==0,"过期设备码不交换");}
        fake=new();using(var login=fake.Login())
        {
            using var cancellation=new CancellationTokenSource();
            await Reject(()=>login.LoginAsync(new Prompt(_=>cancellation.Cancel()),cancellation.Token),"cancelled");Check(!login.HasSession && fake.Polls==0,"等待授权可取消");
        }
        fake=new();using(var login=fake.Login())
        {
            var held=new TaskCompletionSource<HttpResponseMessage>(TaskCreationOptions.RunContinuationsAsynchronously);var started=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            fake.Override=(request,_)=>request.RequestUri!.AbsolutePath.EndsWith("access_token")?Hold():null;
            Task<HttpResponseMessage> Hold(){started.TrySetResult();return held.Task;}
            var task=login.LoginAsync(new Prompt(),default);await started.Task;login.SignOut();held.SetResult(fake.Token());
            await Reject(()=>task,"cancelled");Check(!login.HasSession && login.Status.State=="signed-out","迟到授权不能恢复已退出会话");
        }
        foreach(var fault in new[]{"redirect","wrong-uri","malformed","timeout","network","rate","repo-id","no-contents","bad-token","no-expiry","broad-scope","wide-installations","all-repos","write-permission","extra-permission","wide-repositories","wrong-install-repo","device-disabled-initial"})
        {
            fake=new(){Fault=fault};using var login=fake.Login();await Reject(()=>login.LoginAsync(new Prompt(),default));Check(!login.HasSession,"坏响应、限流或权限失败不建立会话");
            if(fault is "redirect" or "wrong-uri" or "rate" or "device-disabled-initial")Check(fake.Requests==1,"恶意地址/限流不继续请求");
        }
        fake=new();using(var login=fake.Login())
        {
            await login.LoginAsync(new Prompt(),default);using var old=await login.GetLeaseAsync(default);fake.Now=fake.Now.AddHours(9);
            Check(login.Status.State=="expired","到期状态明确");using var next=await login.GetLeaseAsync(default);
            Check(fake.Refreshes==1 && !fake.Forms.Last().ContainsKey("client_secret"),"按需刷新无 secret");login.Reject(old);Check(login.HasSession,"旧请求 401 不清除新令牌");
            using var request=new HttpRequestMessage(HttpMethod.Get,"https://api.github.com/repos/Notesae/screenshot/releases");next.Authorize(request);Check(request.Headers.Authorization?.Parameter==Next,"只使用新令牌");
            login.Reject(next);Check(!login.HasSession && next.Token.IsCancellationRequested,"撤销清除当前会话");
        }
        fake=new();using(var login=fake.Login())
        {await login.LoginAsync(new Prompt(),default);fake.Now=fake.Now.AddHours(9);fake.Fault="bad-refresh";await Reject(async()=>{using var x=await login.GetLeaseAsync(default);},"expired");Check(!login.HasSession,"refresh 失效需重新登录");}
        // 旋转响应损坏时清除内存会话，不把上游正文传进异常；退出期间迟到刷新不能复活登录。
        fake=new();using(var login=fake.Login())
        {
            await login.LoginAsync(new Prompt(),default);fake.Now=fake.Now.AddHours(9);fake.Fault="malformed-refresh";
            await Reject(async()=>{using var x=await login.GetLeaseAsync(default);},"invalid_response");Check(!login.HasSession,"损坏刷新响应清除会话");
        }
        fake=new();using(var login=fake.Login())
        {
            await login.LoginAsync(new Prompt(),default);fake.Now=fake.Now.AddHours(9);
            var held=new TaskCompletionSource<HttpResponseMessage>(TaskCreationOptions.RunContinuationsAsynchronously);var started=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            fake.Override=(request,_)=>request.RequestUri!.AbsolutePath.EndsWith("access_token")?Hold():null;
            Task<HttpResponseMessage> Hold(){started.TrySetResult();return held.Task;}
            var refresh=login.GetLeaseAsync(default);await started.Task;login.SignOut();held.SetResult(fake.Token(true));
            await Reject(async()=>{using var x=await refresh;},"cancelled");Check(!login.HasSession,"迟到刷新不能恢复已退出会话");
        }
        fake=new();using(var login=fake.Login())
        {
            await login.LoginAsync(new Prompt(),default);fake.Now=fake.Now.AddHours(9);var held=new TaskCompletionSource<HttpResponseMessage>(TaskCreationOptions.RunContinuationsAsynchronously);var started=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            fake.Override=(request,_)=>request.RequestUri!.AbsolutePath.EndsWith("access_token")?Hold():null;
            Task<HttpResponseMessage> Hold(){fake.Refreshes++;started.TrySetResult();return held.Task;}
            var first=login.GetLeaseAsync(default);await started.Task;var second=login.GetLeaseAsync(default);held.SetResult(fake.Token(true));using var a=await first;using var b=await second;Check(fake.Refreshes==1,"并发操作只刷新一次");
        }
        // 已登录后安装权限变宽，也必须在交出任何 API lease 前阻止并清除会话。
        fake=new();using(var login=fake.Login())
        {
            await login.LoginAsync(new Prompt(),default);fake.Fault="extra-permission";
            await Reject(async()=>{using var x=await login.GetLeaseAsync(default);},"permission_scope_mismatch");Check(!login.HasSession,"后续权限扩大时停止使用会话");
        }
        var directory=Path.Combine(Path.GetTempPath(),"Screenshot-auth-tests-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(directory);
        try
        {
            fake=new();using var login=fake.Login();await login.LoginAsync(new Prompt(),default);using var source=new GitHubUpdateSource(fake.Client(),login);
            var release=await source.CheckAsync(ReleaseVersion.Parse("0.4.6"),false,default);Check(release?.AssetId==42,"元数据绑定官方资产 API");
            await source.DownloadAsync(release!,Path.Combine(directory,"valid.zip"),null,default);Check(fake.AuthenticatedAsset && fake.CdnWithoutAuth,"私有 API 带认证，CDN 去认证与 Cookie");
            await Reject(()=>source.DownloadAsync(release!,Path.Combine(directory,"cancelled.zip"),new Transfer(_=>login.SignOut()),default),"cancelled");Check(!File.Exists(Path.Combine(directory,"cancelled.zip")) && !login.HasSession,"下载中退出清理部分包");
            await login.LoginAsync(new Prompt(),default);fake.Fault="revoked";await Reject(()=>source.CheckAsync(ReleaseVersion.Parse("0.4.6"),false,default),"expired");Check(!login.HasSession,"更新 API 401 清除登录");
        }
        finally{if(Path.GetFullPath(directory).StartsWith(Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))Directory.Delete(directory,true);}
        Console.WriteLine($"PASS {checks} synthetic GitHub device login, scope, expiry, refresh, logout/races, safe errors and private asset checks (no real OAuth)");return checks;
    }
    private sealed class Prompt(Action<GitHubDevicePrompt>? report=null):IProgress<GitHubDevicePrompt>{public void Report(GitHubDevicePrompt value)=>report?.Invoke(value);}
    private sealed class Transfer(Action<UpdateProgress> report):IProgress<UpdateProgress>{public void Report(UpdateProgress value)=>report(value);}
    private sealed class Server
    {
        internal DateTimeOffset Now=new(2026,10,20,0,0,0,TimeSpan.Zero);internal readonly List<double> Delays=new();internal readonly List<Dictionary<string,string>> Forms=new();internal readonly Queue<string> Errors=new();
        internal int Requests,Polls,Refreshes,DeviceExpires=900;internal string Fault="";internal bool AuthenticatedAsset,CdnWithoutAuth;internal Func<HttpRequestMessage,CancellationToken,Task<HttpResponseMessage>?>? Override;
        internal HttpClient Client()=>new(new Http(Handle));
        internal GitHubLogin Login(string id="Iv1.synthetic-public-client")=>new(id,Client(),()=>Now,(time,token)=>{token.ThrowIfCancellationRequested();Delays.Add(time.TotalSeconds);Now+=time;return Task.CompletedTask;});
        internal HttpResponseMessage Token(bool refreshed=false)=>Json(new{access_token=Fault=="bad-token"?"ghp_"+new string('a',40):refreshed?Next:Access,refresh_token=Refresh,expires_in=Fault=="no-expiry"?0:28800,refresh_token_expires_in=15897600,token_type="bearer",scope=Fault=="broad-scope"?"repo":""});
        private async Task<HttpResponseMessage> Handle(HttpRequestMessage request,CancellationToken token)
        {
            Requests++;token.ThrowIfCancellationRequested();if(Override?.Invoke(request,token) is {} held)return await held;var path=request.RequestUri!.AbsolutePath;
            if(path=="/login/device/code")
            {
                NoAuth(request);Forms.Add(Form(await request.Content!.ReadAsStringAsync(token)));
                if(Fault=="device-disabled-initial")return Json(new{error="device_flow_disabled",error_description=Access+Device});
                if(Fault=="timeout")throw new OperationCanceledException(Access);if(Fault=="network")throw new HttpRequestException(Access+Refresh);if(Fault=="rate")return new(HttpStatusCode.TooManyRequests){Content=new StringContent(Access)};
                if(Fault=="redirect"){var r=new HttpResponseMessage(HttpStatusCode.Redirect);r.Headers.Location=new("https://evil.example/"+Access);return r;}if(Fault=="malformed")return new(HttpStatusCode.OK){Content=new StringContent("{bad:"+Access)};
                return Json(new{device_code=Device,user_code="ABCD-EFGH",verification_uri=Fault=="wrong-uri"?"https://evil.example/device":"https://github.com/login/device",expires_in=DeviceExpires,interval=5});
            }
            if(path=="/login/oauth/access_token")
            {
                NoAuth(request);var form=Form(await request.Content!.ReadAsStringAsync(token));Forms.Add(form);if(form["grant_type"]=="refresh_token"){Refreshes++;if(Fault=="malformed-refresh")return Json(new{access_token=Next,token_type=12});return Fault=="bad-refresh"?Json(new{error="bad_refresh_token",error_description=Refresh}):Token(true);}Polls++;return Errors.Count>0?Json(new{error=Errors.Dequeue(),error_description=Access+Device}):Token();
            }
            if(request.RequestUri.Host=="release-assets.githubusercontent.com"){CdnWithoutAuth=request.Headers.Authorization is null && !request.Headers.Contains("Cookie");return new(HttpStatusCode.OK){Content=new ByteArrayContent(Encoding.UTF8.GetBytes("test"))};}
            if(request.Headers.Authorization?.Scheme!="Bearer")throw new Exception("模拟私有 API 缺少认证。");if(Fault=="revoked")return new(HttpStatusCode.Unauthorized){Content=new StringContent(Access)};
            if(path=="/user/installations")return Json(new{total_count=Fault=="wide-installations"?2:1,installations=new[]{new{id=42,account=new{login="Notesae"},repository_selection=Fault=="all-repos"?"all":"selected",permissions=Fault=="extra-permission"?new Dictionary<string,string>{{"contents","read"},{"metadata","read"},{"issues","write"}}:new Dictionary<string,string>{{"contents",Fault=="write-permission"?"write":"read"},{"metadata","read"}}}}});
            if(path=="/user/installations/42/repositories")return Json(new{total_count=Fault=="wide-repositories"?2:1,repositories=new[]{new{id=Fault=="wrong-install-repo"?1:GitHubUpdateIdentity.RepositoryId,full_name="Notesae/screenshot"}}});
            if(path=="/user")return Json(new{login="Notesae",id=124855207});if(path=="/repos/Notesae/screenshot")return Json(new{id=Fault=="repo-id"?1:GitHubUpdateIdentity.RepositoryId,full_name="Notesae/screenshot",@private=true});
            if(path=="/repos/Notesae/screenshot/releases")
            {
                if(Fault=="no-contents")return new(HttpStatusCode.Forbidden){Content=new StringContent(Access)};if(request.RequestUri.Query=="?per_page=1")return Json(Array.Empty<object>());
                return Json(new[]{new{tag_name="v0.4.8",draft=false,prerelease=false,body="synthetic",assets=new[]{new{id=42,name="Screenshot-0.4.8-win-x64.zip",size=4,digest="sha256:"+Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes("test"))),url="https://api.github.com/repos/Notesae/screenshot/releases/assets/42",browser_download_url="https://github.com/Notesae/screenshot/releases/download/v0.4.8/Screenshot-0.4.8-win-x64.zip"}}}});
            }
            if(path=="/repos/Notesae/screenshot/releases/assets/42"){AuthenticatedAsset=true;var r=new HttpResponseMessage(HttpStatusCode.Redirect);r.Headers.Location=new("https://release-assets.githubusercontent.com/synthetic?signature=temporary");return r;}throw new Exception("模拟测试出现范围外请求。");
        }
        private static void NoAuth(HttpRequestMessage request){if(request.Headers.Authorization is not null || request.Headers.Contains("Cookie"))throw new Exception("OAuth 请求不能带已有认证。");}
        private static Dictionary<string,string> Form(string text)=>text.Split('&').Select(s=>s.Split('=',2)).ToDictionary(p=>Uri.UnescapeDataString(p[0]),p=>Uri.UnescapeDataString(p[1]));
        private static HttpResponseMessage Json(object value)=>new(HttpStatusCode.OK){Content=new StringContent(JsonSerializer.Serialize(value),Encoding.UTF8,"application/json")};
    }
    private sealed class Http(Func<HttpRequestMessage,CancellationToken,Task<HttpResponseMessage>> handle):HttpMessageHandler{protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token)=>handle(request,token);}
}
