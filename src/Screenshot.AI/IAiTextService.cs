namespace Screenshot.AI;

/// <summary>原生宿主的文字服务契约；未来本地 OCR 可提供独立实现。</summary>
public interface IAiTextService
{
    Task<AiTextResult> OcrAsync(string providerId, string imageDataUrl, CancellationToken token = default);
    Task<AiTextResult> TranslateAsync(string providerId, string text, string targetLanguage, CancellationToken token = default);
}
