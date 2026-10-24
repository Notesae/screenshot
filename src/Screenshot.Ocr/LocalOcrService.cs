using System.Security.Cryptography;
using Microsoft.ML.OnnxRuntime;
using OpenCvSharp;

namespace Screenshot.Ocr;

/// <summary>只在显式请求时加载本地 PP-OCRv5，串行执行 CPU 检测与识别，不联网下载。</summary>
public sealed class LocalOcrService : IDisposable
{
    public const string ModelVersion = "PP-OCRv5-mobile/RapidOCR-v3.10.0";
    private readonly string _modelDirectory;
    private readonly SemaphoreSlim _gate = new(1,1);
    private readonly CancellationTokenSource _lifetime = new();
    private InferenceSession? _detector;
    private InferenceSession? _recognizer;
    private IReadOnlyList<string>? _dictionary;
    private int _disposed;

    // 固定版本及摘要与显式安装清单一致，不接受运行时替换成未核验模型。
    private static readonly (string Name,string Sha256)[] RequiredModels = [
        ("ch_PP-OCRv5_det_mobile.onnx","4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae"),
        ("ch_PP-OCRv5_rec_mobile.onnx","5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5")
    ];

    /// <summary>记录本地模型目录，不创建目录、不加载模型或触发网络。</summary>
    public LocalOcrService(string modelDirectory) => _modelDirectory=Path.GetFullPath(modelDirectory);

    /// <summary>校验固定模型是否已安装且摘要正确，状态不包含图片文字或完整路径。</summary>
    public LocalOcrStatus GetStatus() => ReadModelStatus(CancellationToken.None);

    // 在有限文件大小内校验摘要；长读操作持续观察取消，不向调用方传递底层路径错误。
    private LocalOcrStatus ReadModelStatus(CancellationToken token)
    {
        try
        {
            var missing=RequiredModels.Where(m=>!File.Exists(Path.Combine(_modelDirectory,m.Name))).Select(m=>m.Name).ToArray();
            if(missing.Length!=0) return new(false,ModelVersion,"本地 OCR 模型尚未安装，请先运行明确的模型准备步骤。",missing);
            foreach(var model in RequiredModels)
            {
                token.ThrowIfCancellationRequested();
                using var stream=File.OpenRead(Path.Combine(_modelDirectory,model.Name));
                if(stream.Length>32*1024*1024) return new(false,ModelVersion,"本地 OCR 模型大小无效，请重新准备固定版本模型。",[]);
                using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                var buffer=new byte[128*1024]; int read;
                while((read=stream.Read(buffer))>0) { token.ThrowIfCancellationRequested(); hash.AppendData(buffer,0,read); }
                if(!Convert.ToHexString(hash.GetHashAndReset()).Equals(model.Sha256,StringComparison.OrdinalIgnoreCase))
                    return new(false,ModelVersion,"本地 OCR 模型校验失败，请重新准备固定版本模型。",[]);
            }
            return new(true,ModelVersion,"固定版本本地 OCR 模型已就绪；首次识别时加载 CPU 运行库。",[]);
        }
        catch(Exception error) when(error is IOException or UnauthorizedAccessException)
        { return new(false,ModelVersion,"无法读取本地 OCR 模型，请检查模型安装与文件权限。",[]); }
    }

    /// <summary>识别内存 PNG，等待和推理均可取消；返回源像素文字块，不保存输入或结果。</summary>
    public async Task<OcrDocument> RecognizeAsync(byte[] png,CancellationToken cancellationToken=default)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed)!=0,this);
        using var linked=CancellationTokenSource.CreateLinkedTokenSource(cancellationToken,_lifetime.Token);
        bool entered=false;
        try
        {
            linked.Token.ThrowIfCancellationRequested();
            PngInput.ReadSize(png);
            await _gate.WaitAsync(linked.Token).ConfigureAwait(false); entered=true;
            // 获取执行权后才复制，限制排队请求的内存；快照还会重新验证 PNG 头。
            var snapshot=png.ToArray();
            return await Task.Run(()=>RecognizeCore(snapshot,linked.Token),linked.Token).ConfigureAwait(false);
        }
        catch(OperationCanceledException) { throw new LocalOcrException("cancelled","本地 OCR 已取消。"); }
        catch(OnnxRuntimeException) when(linked.IsCancellationRequested) { throw new LocalOcrException("cancelled","本地 OCR 已取消。"); }
        catch(OnnxRuntimeException) { throw new LocalOcrException("ocr_failed","本地 OCR 推理失败，请检查固定版本模型和 CPU 运行库。"); }
        catch(OpenCVException) { throw new LocalOcrException("invalid_image","图片解码或文字裁切失败，请重新导入有效 PNG。"); }
        catch(Exception error) when(error is DllNotFoundException or BadImageFormatException or TypeInitializationException)
        { throw new LocalOcrException("ocr_runtime_unavailable","本地 OCR 原生运行库不可用，请使用完整的 Windows x64 应用包。"); }
        finally { if(entered) _gate.Release(); }
    }

    // 后台执行完整流水线；每个文字块单独识别，避免高并行或大批次持续占用资源。
    private OcrDocument RecognizeCore(byte[] png,CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        PngInput.ReadSize(png);
        EnsureSessions(token);
        Cv2.SetNumThreads(1);
        using var image=PngInput.DecodeToBgr(png,token);
        token.ThrowIfCancellationRequested();
        var detection=RunModel(_detector!,OcrAlgorithms.PrepareDetection(image,token),token);
        if(detection.Shape.Length!=4 || detection.Shape[0]!=1 || detection.Shape[1]!=1)
            throw new LocalOcrException("model_invalid","检测模型输出规格无效。");
        var boxes=OcrAlgorithms.ExtractBoxes(detection.Data,checked((int)detection.Shape[3]),checked((int)detection.Shape[2]),image.Width,image.Height,token);
        var blocks=new List<OcrBlock>(); var imageHash=SHA256.HashData(png);
        foreach(var box in boxes)
        {
            token.ThrowIfCancellationRequested();
            using var crop=OcrAlgorithms.Rectify(image,box.Polygon);
            var recognition=RunModel(_recognizer!,OcrAlgorithms.PrepareRecognition(crop,token),token);
            if(recognition.Shape.Length!=3 || recognition.Shape[0]!=1)
                throw new LocalOcrException("model_invalid","识别模型输出规格无效。");
            var decoded=OcrAlgorithms.DecodeCtc(recognition.Data,checked((int)recognition.Shape[1]),checked((int)recognition.Shape[2]),_dictionary!,token);
            if(string.IsNullOrWhiteSpace(decoded.Text)) continue;
            int order=blocks.Count;
            blocks.Add(new(OcrAlgorithms.CreateBlockId(imageHash,box.Polygon,order),box.Polygon,decoded.Text,decoded.Confidence,order));
        }
        token.ThrowIfCancellationRequested();
        return new(ModelVersion,image.Width,image.Height,blocks,string.Join('\n',blocks.Select(b=>b.Text)));
    }

    // 复用昂贵的推理会话；固定 CPU 线程且关闭空闲自旋，字典仅来自已校验模型元数据。
    private void EnsureSessions(CancellationToken token)
    {
        if(_detector is not null && _recognizer is not null) return;
        var status=ReadModelStatus(token);
        if(!status.Available) throw new LocalOcrException(status.MissingFiles.Count>0?"model_missing":"model_invalid",status.Message);
        using var options=new SessionOptions {
            IntraOpNumThreads=2,InterOpNumThreads=1,ExecutionMode=ExecutionMode.ORT_SEQUENTIAL,
            EnableCpuMemArena=false,GraphOptimizationLevel=GraphOptimizationLevel.ORT_ENABLE_ALL,
            LogSeverityLevel=OrtLoggingLevel.ORT_LOGGING_LEVEL_FATAL
        };
        options.AddSessionConfigEntry("session.intra_op.allow_spinning","0");
        options.AddSessionConfigEntry("session.inter_op.allow_spinning","0");
        InferenceSession? detector=null; InferenceSession? recognizer=null;
        try
        {
            token.ThrowIfCancellationRequested();
            detector=new InferenceSession(Path.Combine(_modelDirectory,RequiredModels[0].Name),options);
            token.ThrowIfCancellationRequested();
            recognizer=new InferenceSession(Path.Combine(_modelDirectory,RequiredModels[1].Name),options);
            token.ThrowIfCancellationRequested();
            if(!recognizer.ModelMetadata.CustomMetadataMap.TryGetValue("character",out var characters))
                throw new LocalOcrException("model_invalid","固定识别模型缺少内嵌字符字典，请重新准备模型。");
            var dictionary=new[] { "" }.Concat(characters.TrimEnd('\r','\n').Split('\n').Select(c=>c.TrimEnd('\r'))).Append(" ").ToArray();
            if(detector.InputMetadata.Count!=1 || recognizer.InputMetadata.Count!=1 || recognizer.OutputMetadata.Count!=1
                || recognizer.OutputMetadata.First().Value.Dimensions.Length!=3 || recognizer.OutputMetadata.First().Value.Dimensions[2]!=dictionary.Length)
                throw new LocalOcrException("model_invalid","模型输入输出或字符字典规格不匹配。");
            _detector=detector; _recognizer=recognizer; _dictionary=dictionary;
        }
        catch { detector?.Dispose(); recognizer?.Dispose(); throw; }
    }

    // RunOptions 只属于本次 Run，取消直接终止 ORT，而不是让推理在后台继续运行。
    private static (float[] Data,long[] Shape) RunModel(InferenceSession session,ModelInput input,CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        using var tensor=OrtValue.CreateTensorValueFromMemory(input.Data,new long[] {1,3,input.Height,input.Width});
        using var options=new RunOptions();
        using var registration=token.Register(()=>options.Terminate=true);
        token.ThrowIfCancellationRequested();
        var inputs=new Dictionary<string,OrtValue> { [session.InputMetadata.First().Key]=tensor };
        using var outputs=session.Run(options,inputs,session.OutputNames);
        token.ThrowIfCancellationRequested();
        var output=outputs[0];
        return (output.GetTensorDataAsSpan<float>().ToArray(),output.GetTensorTypeAndShape().Shape);
    }

    /// <summary>托盘空闲时尝试释放可重建的模型会话；推理或排队请求占用执行权时直接跳过。</summary>
    public void ReleaseIdleSessions()
    {
        if (Volatile.Read(ref _disposed) != 0 || !_gate.Wait(0)) return;
        try { if (Volatile.Read(ref _disposed) == 0) ReleaseSessions(); }
        finally { _gate.Release(); }
    }

    // 仅持有执行权时调用；先解除引用，下次识别仍按原来的模型摘要和参数完整初始化。
    private void ReleaseSessions()
    {
        var detector = _detector; var recognizer = _recognizer;
        _detector = null; _recognizer = null; _dictionary = null;
        try { detector?.Dispose(); }
        finally { recognizer?.Dispose(); }
    }

    /// <summary>取消存活请求，等其释放执行权后销毁会话，防止原生资源与推理并发释放。</summary>
    public void Dispose()
    {
        if(Interlocked.Exchange(ref _disposed,1)!=0) return;
        _lifetime.Cancel(); _gate.Wait();
        try { ReleaseSessions(); }
        finally { _gate.Release(); _lifetime.Dispose(); }
    }
}
