using Screenshot.AI;
using System.Net;
using System.Text;
using System.Text.Json;

// 离线检查集：HTTP 全部由替身处理，配置临时目录在退出时删除。
var tests = new List<(string, Func<Task>)>();
var temporaryDirectory = Path.Combine(AppContext.BaseDirectory, "Screenshot-AI-Tests-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(temporaryDirectory);
int sequence = 0;
AiSettingsStore Store() => new(Path.Combine(temporaryDirectory, $"settings-{++sequence}.json"));
void Check(bool value, string message) { if (!value) throw new Exception(message); }
async Task Error(Func<Task> work, string code) { try { await work(); } catch (AiProviderException e) { Check(e.Code == code, $"Expected {code}, got {e.Code}"); return; } throw new Exception("Expected error " + code); }
// 无配置时应提示用户设置，不能触发网络请求。
tests.Add(("Empty settings require explicit configuration", async () => {
    var service = new AiService(Store(), new HttpClient(new Handler(_ => throw new Exception("Network must not run"))));
    Check((await service.ReadSettingsAsync()).Providers.Count == 0, "Unexpected provider");
    await Error(() => service.TranslateAsync("missing", "Hello", "简体中文"), "provider_not_configured");
}));
// 在保存或携带密钥请求前拒绝非安全远程地址。
tests.Add(("Reject insecure remote URLs before saving or sending keys", async () => {
    var service = new AiService(Store());
    await Error(() => service.UpdateProviderAsync(new("id", "Remote", "openai-compatible", "http://example.com/v1", "vision", "SECRET")), "invalid_provider_url");
    await Error(() => service.UpdateProviderAsync(new("id", "Remote", "openai-compatible", "https://user:pass@example.com", "vision")), "invalid_provider_url");
}));
// 验证当前账户加密、重新加载、保留/清除及公开摘要隐私。
tests.Add(("DPAPI settings preserve/clear key and public DTO never contains it", async () => {
    var store = Store(); var service = new AiService(store);
    await service.UpdateProviderAsync(new("id", "Example", "openai-compatible", "https://example.com/v1", "vision", "TOP-SECRET-123"));
    Check(!(await File.ReadAllTextAsync(store.FilePath)).Contains("TOP-SECRET-123"), "Plaintext key on disk");
    var reloaded = new AiService(new AiSettingsStore(store.FilePath));
    Check((await reloaded.ReadSettingsAsync()).Providers.Single().HasApiKey, "Encrypted key lost");
    Check(!JsonSerializer.Serialize(await reloaded.ReadSettingsAsync()).Contains("TOP-SECRET-123"), "Key in public DTO");
    await reloaded.UpdateProviderAsync(new("id", "Renamed", "openai-compatible", "https://example.com/v1", "new-model"));
    Check((await reloaded.ReadSettingsAsync()).Providers.Single().HasApiKey, "Empty edit removed stored key");
    await reloaded.UpdateProviderAsync(new("id", "Renamed", "openai-compatible", "https://example.com/v1", "new-model", ClearApiKey: true));
    Check(!(await reloaded.ReadSettingsAsync()).Providers.Single().HasApiKey, "Clear did not remove key");
}));
// 检查 OpenAI 视觉消息、端点与原生授权头，不调用真实服务。
tests.Add(("OpenAI OCR request has native bearer key and vision content", async () => {
    var handler = new Handler(request => {
        Check(request.RequestUri!.AbsoluteUri == "https://example.com/v1/chat/completions", "Wrong endpoint");
        Check(request.Headers.Authorization?.Parameter == "secret", "Missing bearer key");
        using var json = JsonDocument.Parse(request.Content!.ReadAsStringAsync().Result);
        Check(json.RootElement.GetProperty("model").GetString() == "vision", "Wrong model");
        var content = json.RootElement.GetProperty("messages")[0].GetProperty("content");
        Check(content[1].GetProperty("image_url").GetProperty("url").GetString() == "data:image/png;base64,aGVsbG8=", "Wrong image");
        return Json("{\"choices\":[{\"message\":{\"content\":\"识别文字\"}}]}");
    });
    var service = new AiService(Store(), new HttpClient(handler));
    await service.UpdateProviderAsync(new("id", "OpenAI", "openai-compatible", "https://example.com/v1/", "vision", "secret"));
    Check((await service.OcrAsync("id", "data:image/png;base64,aGVsbG8=")).Text == "识别文字", "Wrong OCR result");
}));
// 检查 Ollama 图片使用裸 base64 且关闭流式响应。
tests.Add(("Ollama OCR uses base64 images and nonstreaming chat", async () => {
    var service = new AiService(Store(), new HttpClient(new Handler(request => {
        Check(request.RequestUri!.AbsoluteUri == "http://localhost:11434/api/chat", "Wrong Ollama endpoint");
        using var json = JsonDocument.Parse(request.Content!.ReadAsStringAsync().Result);
        Check(!json.RootElement.GetProperty("stream").GetBoolean(), "Streaming unexpectedly enabled");
        Check(json.RootElement.GetProperty("messages")[0].GetProperty("images")[0].GetString() == "aGVsbG8=", "Invalid Ollama image format");
        return Json("{\"message\":{\"content\":\"Hello\"}}");
    })));
    await service.UpdateProviderAsync(new("id", "Local", "ollama", "http://localhost:11434", "vision"));
    Check((await service.OcrAsync("id", "data:image/png;base64,aGVsbG8=")).Text == "Hello", "Wrong result");
}));
// 保持待译文字并传递目标语言，支持数组形式的文字响应。
tests.Add(("Translation encodes target and text as data", async () => {
    var service = new AiService(Store(), new HttpClient(new Handler(request => {
        using var json = JsonDocument.Parse(request.Content!.ReadAsStringAsync().Result);
        var messages = json.RootElement.GetProperty("messages");
        Check(messages[0].GetProperty("content").GetString()!.Contains("简体中文"), "Target omitted");
        Check(messages[1].GetProperty("content").GetString() == "Hello\nworld", "Input changed");
        return Json("{\"choices\":[{\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"你好\"}]}}]}");
    })));
    await service.UpdateProviderAsync(new("id", "Translate", "openai-compatible", "https://example.com/v1", "text", "secret"));
    Check((await service.TranslateAsync("id", "Hello\nworld", "简体中文")).Text == "你好", "Wrong translation");
}));
// 服务商即使返回含敏感内容的错误体，也不能把原文带给用户。
tests.Add(("Provider errors never expose body, keys, or URL query", async () => {
    var service = new AiService(Store(), new HttpClient(new Handler(_ => new(HttpStatusCode.Unauthorized) { Content = new StringContent("SECRET response detail") })));
    await service.UpdateProviderAsync(new("id", "Remote", "openai-compatible", "https://example.com/v1", "text", "SECRET"));
    try { await service.TranslateAsync("id", "Hi", "Chinese"); throw new Exception("Expected error"); }
    catch (AiProviderException e) { Check(e.Code == "provider_http_error" && !e.Message.Contains("SECRET") && e.Message.Contains("401"), "Unsafe error"); }
}));
// 缺字段、空结果和无效 JSON 均应转为可读结构错误。
tests.Add(("Malformed/empty responses are readable errors", async () => {
    foreach (var body in new[] { "not json", "{}", "{\"choices\":[]}", "{\"choices\":[{\"message\":{\"content\":null}}]}" }) {
        var service = new AiService(Store(), new HttpClient(new Handler(_ => Json(body))));
        await service.UpdateProviderAsync(new("id", "Remote", "openai-compatible", "https://example.com/v1", "text", "secret"));
        await Error(() => service.TranslateAsync("id", "Hi", "Chinese"), "invalid_provider_response");
    }
}));
// 无效图片和预先取消的请求必须保持零发送。
tests.Add(("Cancellation and invalid image do not send requests", async () => {
    int sent = 0; var service = new AiService(Store(), new HttpClient(new Handler(_ => { sent++; return Json("{}"); })));
    await service.UpdateProviderAsync(new("id", "Local", "ollama", "http://127.0.0.1:11434", "vision"));
    await Error(() => service.OcrAsync("id", "https://private.invalid/image.png"), "invalid_image");
    using var cts = new CancellationTokenSource(); cts.Cancel();
    await Error(() => service.TranslateAsync("id", "Hi", "Chinese", cts.Token), "cancelled");
    Check(sent == 0, "Sent invalid/cancelled request");
}));

// 未配置密钥、不支持协议与请求头控制字符应在发送前被拒绝。
tests.Add(("Missing key, invalid kind, and control characters are rejected", async () => {
    int sent = 0; var service = new AiService(Store(), new HttpClient(new Handler(_ => { sent++; return Json("{}"); })));
    await Error(() => service.UpdateProviderAsync(new("id", "Remote", "unknown", "https://example.com", "vision")), "invalid_provider");
    await Error(() => service.UpdateProviderAsync(new("id", "Remote", "openai-compatible", "https://example.com/v1?key=secret", "vision")), "invalid_provider_url");
    await Error(() => service.UpdateProviderAsync(new("id", "Remote", "openai-compatible", "https://example.com/v1", "vision", "key\r\ninjection")), "invalid_api_key");
    await service.UpdateProviderAsync(new("id", "Remote", "openai-compatible", "https://example.com/v1", "vision"));
    await Error(() => service.TranslateAsync("id", "Hello", "Chinese"), "api_key_required");
    Check(sent == 0, "Sent unconfigured request");
}));
// 模拟连接和超时异常，验证错误码及底层诊断清洗。
tests.Add(("Connection failures and timeout messages exclude low-level details", async () => {
    foreach (var pair in new[] { (new HttpRequestException("SECRET URL") as Exception, "provider_connection_failed"), (new TaskCanceledException("SECRET URL") as Exception, "provider_timeout") }) {
        var service = new AiService(Store(), new HttpClient(new Handler(_ => throw pair.Item1)));
        await service.UpdateProviderAsync(new("id", "Local", "ollama", "http://[::1]:11434", "vision"));
        try { await service.TranslateAsync("id", "Hello", "Chinese"); throw new Exception("Expected error"); }
        catch (AiProviderException e) { Check(e.Code == pair.Item2 && !e.Message.Contains("SECRET"), "Unsafe connection error"); }
    }
}));
// 检查响应上限和损坏配置，防止无限读取或泄漏解析细节。
tests.Add(("Oversized responses and corrupted settings fail safely", async () => {
    var store = Store();
    var service = new AiService(store, new HttpClient(new Handler(_ => Json(new string('x', 2 * 1024 * 1024 + 1)))));
    await service.UpdateProviderAsync(new("id", "Local", "ollama", "http://localhost:11434", "vision"));
    await Error(() => service.TranslateAsync("id", "Hello", "Chinese"), "invalid_provider_response");
    await File.WriteAllTextAsync(store.FilePath, "invalid-json");
    await Error(() => service.ReadSettingsAsync(), "invalid_settings");
}));
// 删除默认服务后选择剩余服务，并从持久化配置移除其密文。
tests.Add(("Deleting default provider selects remaining provider and removes secret", async () => {
    var store = Store(); var service = new AiService(store);
    await service.UpdateProviderAsync(new("a", "A", "openai-compatible", "https://example.com/v1", "vision", "SECRET-A"));
    await service.UpdateProviderAsync(new("b", "B", "ollama", "http://localhost:11434", "local", MakeDefault: false));
    Check((await service.ReadSettingsAsync()).DefaultProviderId == "a", "Default overwritten");
    var after = await service.DeleteProviderAsync("a");
    Check(after.DefaultProviderId == "b" && after.Providers.Count == 1, "Delete/default invalid");
    Check(!(await File.ReadAllTextAsync(store.FilePath)).Contains("protectedApiKey\": \""), "Deleted encrypted secret remains");
}));
// 响应读取中断也应使用安全的连接错误提示。
tests.Add(("Interrupted response streams return a safe connection error", async () => {
    var service = new AiService(Store(), new HttpClient(new Handler(_ => new(HttpStatusCode.OK) { Content = new BrokenContent() })));
    await service.UpdateProviderAsync(new("id", "Local", "ollama", "http://localhost:11434", "vision"));
    await Error(() => service.TranslateAsync("id", "Hello", "Chinese"), "provider_connection_failed");
}));
// 逐项运行并汇总退出码，确保失败时仍清理测试配置。
int failed = 0;
try {
    foreach (var (name, test) in tests) {
        try { await test(); Console.WriteLine("PASS " + name); }
        catch (Exception e) { failed++; Console.WriteLine("FAIL " + name + ": " + e.Message); }
    }
} finally { Directory.Delete(temporaryDirectory, true); }
Console.WriteLine($"AI checks: {tests.Count - failed}/{tests.Count} passed");
return failed == 0 ? 0 : 1;

static HttpResponseMessage Json(string body) => new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
// 捕获协议请求并返回确定响应的 HTTP 替身，禁止真实出网。
sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> handle) : HttpMessageHandler {
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => Task.FromResult(handle(request));
}

// 在响应体读取阶段模拟传输失败，覆盖连接错误清洗路径。
sealed class BrokenContent : HttpContent {
    protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) => Task.FromException(new IOException("SECRET transport details"));
    protected override bool TryComputeLength(out long length) { length = 0; return false; }
}