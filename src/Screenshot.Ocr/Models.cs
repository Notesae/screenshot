using System.Runtime.CompilerServices;

[assembly: InternalsVisibleTo("Screenshot.Ocr.Tests")]

namespace Screenshot.Ocr;

/// <summary>原始输入图片像素坐标，顺时针四边形由左上角开始。</summary>
public sealed record OcrPoint(double X, double Y);
/// <summary>可校对文字块；置信度为 CTC 保留字符的原始概率均值。</summary>
public sealed record OcrBlock(string Id, IReadOnlyList<OcrPoint> Polygon, string Text, double? Confidence, int Order);
/// <summary>本地识别结果与输入像素尺寸，不包含图片数据或文件路径。</summary>
public sealed record OcrDocument(string ModelVersion, int ImageWidth, int ImageHeight, IReadOnlyList<OcrBlock> Blocks, string Text);
/// <summary>无需图片即可查询的模型安装状态；缺失项只返回固定文件名。</summary>
public sealed record LocalOcrStatus(bool Available, string ModelVersion, string Message, IReadOnlyList<string> MissingFiles);
/// <summary>可安全展示的本地识别错误，不附加图像、文字或底层文件路径。</summary>
public sealed class LocalOcrException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

// 内部算法只传递数值与缓冲区，不让原生 Mat/ORT 生命周期进入公共桥契约。
internal sealed record ModelInput(float[] Data, int Width, int Height);
internal sealed record DecodedText(string Text, double Confidence);
internal sealed record DetectedBox(IReadOnlyList<OcrPoint> Polygon, double DetectionConfidence);
