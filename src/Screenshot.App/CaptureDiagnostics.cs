using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Screenshot.App;

// 只记录固定阶段、几何和耗时；不含截图、RGB 像素、文字、窗口标题、路径或服务凭据。
internal sealed class CaptureDiagnostics
{
    public static readonly AsyncLocal<CaptureDiagnostics?> Current = new();
    private static readonly SemaphoreSlim Writer = new(1, 1);
    private static CaptureDiagnostics? _latest, _latestFailure;
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly List<object> _phases = new();
    private readonly DateTimeOffset _started = DateTimeOffset.UtcNow;
    private readonly string _logId = Guid.NewGuid().ToString("N");
    private string? _failure;
    private DateTimeOffset? _failedUtc;
    private bool _completed;
    public string? CaptureId { get; set; }

    public CaptureDiagnostics() { Volatile.Write(ref _latest, this); Current.Value = this; Mark("requested"); }
    public void Mark(string phase, int? count = null, object? details = null)
    {
        lock (_phases)
        {
            if (_phases.Count < 128) _phases.Add(new { phase, elapsedMs = Math.Round(_clock.Elapsed.TotalMilliseconds, 2), count, details });
            if (phase == "handoff_released") _completed = true;
        }
    }
    public void Fail(string reason, object? details = null)
    {
        lock (_phases) { _failure = reason; _failedUtc = DateTimeOffset.UtcNow; Mark(reason, details: details); }
        Volatile.Write(ref _latestFailure, this);
        Flush();
    }

    // 最新捕获可覆盖，失败另存且不受后续成功覆盖；最多保留 20 次失败，防止长期堆积。
    public void Flush() => _ = Task.Run(async () =>
    {
        await Writer.WaitAsync();
        try
        {
            string? failure; DateTimeOffset? failedUtc; bool completed; object[] phases;
            lock (_phases)
            {
                failure = _failure; failedUtc = _failedUtc; completed = _completed;
                if (failure is null && !ReferenceEquals(Volatile.Read(ref _latest), this)) return;
                phases = _phases.ToArray();
            }
            // 只在短锁内复制元数据；反射、JSON 编码和磁盘 I/O 不占用 UI 线程的阶段锁。
            var json = JsonSerializer.Serialize(new {
                build = "capture-ready-r6", version = typeof(CaptureDiagnostics).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,
                startedUtc = _started, captureId = CaptureId, failure, failedUtc,
                outcome = completed ? (failure is null ? "ready" : "recovered") : failure is null ? "pending" : "failed", phases
            });
            var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Screenshot", "diagnostics");
            Directory.CreateDirectory(folder);
            if (ReferenceEquals(Volatile.Read(ref _latest), this)) await WriteAsync(Path.Combine(folder, "capture-latest.json"), json);
            if (failure is null) return;
            var failures = Path.Combine(folder, "failures"); Directory.CreateDirectory(failures);
            await WriteAsync(Path.Combine(failures, "capture-" + _started.ToString("yyyyMMddTHHmmssfffffffZ") + "-" + _logId + ".json"), json);
            if (ReferenceEquals(Volatile.Read(ref _latestFailure), this)) await WriteAsync(Path.Combine(folder, "capture-failure-latest.json"), json);
            // 只清理本功能生成的日志名；未知文件与重解析点保持原样。
            var owned = Directory.EnumerateFiles(failures, "capture-*.json")
                .Where(path => System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(path), @"^capture-\d{8}T\d{13}Z-[a-f0-9]{32}\.json$"))
                .OrderByDescending(path => Path.GetFileName(path), StringComparer.Ordinal).Skip(20);
            foreach (var path in owned) if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0) File.Delete(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { /* 日志失败不阻止截图。 */ }
        finally { Writer.Release(); }
    });

    // 固定临时文件写完再替换，读取失败记录时不会遇到半段 JSON。
    private static async Task WriteAsync(string path, string json)
    {
        var temporary = path + ".tmp";
        try { await File.WriteAllTextAsync(temporary, json); File.Move(temporary, path, true); }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
