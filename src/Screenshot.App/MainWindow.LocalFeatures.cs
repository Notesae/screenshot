using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Screenshot.Ocr;
using Screenshot.Storage;

namespace Screenshot.App;

// 本地推理与恢复数据仅在原生进程访问；路径不由桥载荷指定。
public partial class MainWindow
{
    private readonly InferenceTasks _inferenceTasks = new();
    private bool _snapWindows=true,_snapClientArea;
    private string _captureBackend = CaptureRequest.DefaultBackend;
    private readonly LocalOcrService _localOcr = new(Path.Combine(AppContext.BaseDirectory, "models", "pp-ocrv5-mobile"));
    private readonly Lazy<SnapshotStore> _recovery = new(() => new SnapshotStore(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Screenshot", "Recovery")));
    private CancellationTokenSource? _ocrCancellation;

    // 本进程选定的后端同时用于按钮、托盘与热键；单次显式载荷仍可覆盖它。
    private CaptureRequest ParseCaptureRequest(JsonElement payload, bool region)
    {
        var request = CaptureRequest.Parse(payload, region);
        var objectPayload=payload.ValueKind==JsonValueKind.Object;
        return request with{Backend=objectPayload&&payload.TryGetProperty("backend",out _)?request.Backend:_captureBackend,SnapWindows=objectPayload&&payload.TryGetProperty("snapWindows",out _)?request.SnapWindows:_snapWindows,SnapClientArea=objectPayload&&payload.TryGetProperty("windowArea",out _)?request.SnapClientArea:_snapClientArea};
    }

    // 解码也在后台执行，拒绝外链与超大数据，不调用 WPF 解码或保存输入图片。
    private async Task<OcrDocument> RecognizeLocalAsync(string dataUrl, CancellationToken taskToken)
    {
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token, taskToken);
        _ocrCancellation = cancellation;
        try
        {
            var png = await Task.Run(() =>
            {
                const string prefix = "data:image/png;base64,";
                cancellation.Token.ThrowIfCancellationRequested();
                if (!dataUrl.StartsWith(prefix, StringComparison.Ordinal) || dataUrl.Length > 20 * 1024 * 1024 * 4L / 3 + 64)
                    throw new LocalOcrException("invalid_image", "本地 OCR 仅接受最大 20 MB 的 PNG 图片。");
                try { return Convert.FromBase64String(dataUrl[prefix.Length..]); }
                catch (FormatException) { throw new LocalOcrException("invalid_image", "PNG 图片编码无效。"); }
            }, cancellation.Token);
            return await _localOcr.RecognizeAsync(png, cancellation.Token);
        }
        finally { if (ReferenceEquals(_ocrCancellation, cancellation)) _ocrCancellation = null; }
    }

    private async Task<object?> RunInferenceAsync(JsonElement payload, Func<CancellationToken,Task<object?>> work)
    {
        var taskId = OptionalString(payload,"taskId") ?? Guid.NewGuid().ToString("N");
        using var lease = _inferenceTasks.Begin(taskId,_lifetime.Token);
        return await work(lease.Token);
    }

    // 保存文档快照使用独立事务队列，不占用文件对话框或 AI 操作的门控。
    private Task<SnapshotSaveResult> SaveRecoveryAsync(JsonElement payload)
    {
        var documentId = RequiredString(payload, "documentId");
        if (!payload.TryGetProperty("revision", out var value) || !value.TryGetInt64(out var revision) || revision < 0)
            throw new InvalidOperationException("恢复修订号无效。");
        var document = payload.GetProperty("document").Clone();
        return RunRecoveryAsync(store => store.SaveAsync(documentId, revision, document, _lifetime.Token));
    }

    // 初始化和 SQLite I/O 离开 UI 线程；只在首次明确恢复操作时创建本地存储。
    private Task<T> RunRecoveryAsync<T>(Func<SnapshotStore, Task<T>> operation) =>
        Task.Run(() => operation(_recovery.Value), _lifetime.Token);

    private void DisposeLocalFeatures()
    {
        _ocrCancellation?.Cancel();
        _localOcr.Dispose();
        if (_recovery.IsValueCreated) _recovery.Value.Dispose();
    }
}
