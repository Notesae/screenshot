using Screenshot.App;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal static class TermsTests
{
    // 使用专属临时目录、合成条款和假能力计数；不创建窗口或真实用户同意记录。
    internal static int Run()
    {
        var checks = 0;
        void Check(bool value, string message) { if (!value) throw new Exception(message); checks++; }
        var root = Path.Combine(Path.GetTempPath(), "Screenshot-terms-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var files = new[] { "legal/TERMS.zh-CN.txt", "legal/COPYRIGHT.txt", "THIRD-PARTY-NOTICES.md", "licenses/Windows-SDK-LICENSE.rtf", "licenses/Windows-SDK-REDIST.md", "licenses/Windows-SDK-NOTICE.zh-CN.txt", "licenses/CsWinRT-LICENSE.txt", "licenses/cswinrt-license-sources.json" };
            foreach (var file in files) { var p = Path.Combine(root, file); Directory.CreateDirectory(Path.GetDirectoryName(p)!); File.WriteAllText(p, "synthetic-only " + file); }
            var manifestPath = Path.Combine(root, "legal/terms-manifest.json");
            void Manifest(string version = "test.1", string? badPath = null)
            {
                File.WriteAllText(manifestPath, JsonSerializer.Serialize(new { schemaVersion = 1, version,
                    documents = files.Select((f, i) => new { title = "合成告知", file = i == 0 && badPath is not null ? badPath : f, sha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(Path.Combine(root, f)))).ToLowerInvariant() }) }));
            }
            Manifest();
            var agreement = TermsAgreement.Load(root);
            Check(agreement.Documents.Count == 8, "all required legal documents exposed");
            Check(agreement.Digest == TermsAgreement.Load(root).Digest, "stable catalog digest");
            var path = Path.Combine(root, "user", "terms-acceptance.json");
            var store = new TermsAcceptanceStore(path);
            var startup = new TermsStartup(agreement, store, "0.4.6-test");
            var actions = new Dictionary<string, int> { ["host"] = 0, ["hotkey"] = 0, ["capture"] = 0, ["clipboard"] = 0, ["cloud"] = 0 };
            void FakeHost() { foreach (var action in actions.Keys.ToArray()) actions[action]++; }
            Check(!startup.IsAuthorized && !startup.Start(FakeHost), "missing receipt never constructs host");
            Check(!startup.TryAccept(false, out var error) && error.Length > 0, "unchecked consent rejected");
            Check(!File.Exists(path), "unchecked consent creates no receipt");
            Check(!startup.Start(FakeHost) && actions.Values.All(v => v == 0), "unchecked branch cannot touch any capability");
            // 退出和关闭窗口都不调用TryAccept，入口必须保持拒绝状态。
            foreach (var choice in new[] { "decline", "window-close" })
                Check(!startup.Start(FakeHost) && actions.Values.All(v => v == 0), choice + " keeps capabilities off");
            Check(startup.TryAccept(true, out error) && error == "", "synthetic explicit consent persists");
            Check(startup.IsAuthorized && startup.Start(FakeHost) && actions.Values.All(v => v == 1), "only persisted explicit branch constructs host");
            var receipt = File.ReadAllText(path);
            using (var json = JsonDocument.Parse(receipt))
            {
                Check(json.RootElement.EnumerateObject().Count() == 5, "receipt contains only schema version digest time and app version");
                Check(json.RootElement.GetProperty("digest").GetString() == agreement.Digest, "exact digest recorded");
            }
            Check(new TermsStartup(agreement, store, "next-build").IsAuthorized, "same terms skip repeat confirmation across app builds");
            Manifest("test.2"); var changedVersion = TermsAgreement.Load(root);
            Check(!new TermsStartup(changedVersion, store, "0.4.6-test").IsAuthorized, "changed terms version needs new confirmation");
            Manifest();
            File.WriteAllText(Path.Combine(root, "licenses", "additional-NOTICE.txt"), "new synthetic notice");
            var pendingStore = new TermsAcceptanceStore(Path.Combine(root, "pending-user", "record.json"));
            var pending = new TermsStartup(agreement, pendingStore, "test");
            Check(!pending.TryAccept(true, out error) && !pending.IsAuthorized && error.Length > 0, "changed files during prompt cannot be accepted against old digest");
            var changedNotice = TermsAgreement.Load(root);
            Check(changedNotice.Digest != agreement.Digest && !store.IsCurrent(changedNotice), "changed ancillary notice also needs confirmation");
            File.Delete(Path.Combine(root, "licenses", "additional-NOTICE.txt"));
            File.WriteAllText(path, "{broken");
            Check(!store.IsCurrent(agreement), "corrupt receipt fails closed");
            File.WriteAllText(path, receipt.Replace(agreement.Digest, new string('0', 64)));
            Check(!store.IsCurrent(agreement), "wrong receipt digest fails closed");
            File.WriteAllText(path, new string('x', 4097));
            Check(!store.IsCurrent(agreement), "oversize receipt fails closed");
            File.WriteAllText(path, receipt.Replace("\"schemaVersion\":1", "\"schemaVersion\":2"));
            Check(!store.IsCurrent(agreement), "unknown receipt schema fails closed");
            File.WriteAllText(path, receipt);
            var future = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(receipt)!;
            future["acceptedAtUtc"] = JsonSerializer.SerializeToElement(DateTimeOffset.UtcNow.AddDays(2));
            File.WriteAllText(path, JsonSerializer.Serialize(future));
            Check(!store.IsCurrent(agreement), "future receipt fails closed");
            var blocked = Path.Combine(root, "blocked-record"); Directory.CreateDirectory(blocked);
            var failure = new TermsStartup(agreement, new TermsAcceptanceStore(blocked), "test");
            Check(!failure.TryAccept(true, out error) && error.Length > 0 && !failure.IsAuthorized && !failure.Start(FakeHost), "failed receipt save cannot start host");
            Check(!Directory.EnumerateFiles(root, "terms-*.tmp", SearchOption.AllDirectories).Any(), "failed atomic save removes private temp file");
            File.AppendAllText(Path.Combine(root, files[0]), "tampered");
            try { TermsAgreement.Load(root); throw new Exception("tampered legal file accepted"); } catch (InvalidDataException) { checks++; }
            Manifest();
            Manifest(badPath: "../outside.txt");
            try { TermsAgreement.Load(root); throw new Exception("traversal accepted"); } catch (InvalidDataException) { checks++; }
            Manifest(); File.Delete(Path.Combine(root, files[3]));
            try { TermsAgreement.Load(root); throw new Exception("missing SDK original accepted"); } catch (IOException) { checks++; }
        }
        finally
        {
            // 仅删除本测试刚创建的GUID目录，绝不清理用户配置或实际接受记录。
            var full = Path.GetFullPath(root);
            if (!full.StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase) || !Path.GetFileName(full).StartsWith("Screenshot-terms-test-", StringComparison.Ordinal)) throw new Exception("Unexpected test cleanup path");
            Directory.Delete(full, true);
        }
        Console.WriteLine($"PASS {checks} synthetic first-start consent, receipt integrity and capability-denial checks (no desktop or real user consent)");
        return checks;
    }
}
