# 本地 OCR 库

本库不访问窗口、屏幕、剪贴板或网络。宿主必须先显式准备模型，再把待识别的 PNG 字节传入；识别结果仅在内存中返回。

```csharp
using var ocr = new LocalOcrService(modelDirectory);
LocalOcrStatus status = ocr.GetStatus();
OcrDocument document = await ocr.RecognizeAsync(png, cancellationToken);
```

`LocalOcrStatus` 提供 `Available`、`ModelVersion`、`Message`、`MissingFiles`。状态校验 SHA256，不创建目录或自动安装模型。

`OcrDocument` 提供 `ModelVersion`、`ImageWidth`、`ImageHeight`、`Blocks`、`Text`。每块包含 `Id`、从左上角开始的顺时针四点 `Polygon`、`Text`、`Confidence` 和零起点阅读序号 `Order`。坐标属于传入 PNG 的像素空间，与桌面绝对坐标无关。置信度是贪心 CTC 保留字符的原始概率均值，没有四舍五入或替换为检测置信度。标识取输入图片摘要、四分之一像素量化框和阅读序号，不依赖识别文字。

模型文件名固定为 `ch_PP-OCRv5_det_mobile.onnx` 和 `ch_PP-OCRv5_rec_mobile.onnx`，来自 RapidOCR 的 ModelScope `v3.10.0` 归档。检测 SHA256 为 `4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae`；识别 SHA256 为 `5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5`。识别模型内嵌 `character` 元数据，18383 项加 blank/space 对应 18385 输出类别，不依赖外部字典。安装入口、许可证和来源清单由根项目维护。

流水线使用 BGR/ImageNet 检测归一化、32 倍数且最长边 960 的检测输入；DB 像素阈值 0.3、区域分数 0.6、最小轮廓过滤、最小面积矩形及 `area * 1.5 / perimeter` 等距扩张；映回源图后进行透视裁切。明显竖向裁片逆时针旋转后，以 48 像素高、保持宽高比且归一化零填充的输入识别。CTC 去相邻重复和 blank，保留空格及原始概率。

资源上限为 PNG 20 MB、单边 16000、3200 万像素、1000 个候选区域、256 个有效文字块、归一化单行最大宽度 2048。超限返回明确错误，不静默截断。请求串行执行，ORT CPU intra-op 为 2、inter-op 为 1，关闭空闲自旋，OpenCV 为 1 线程。取消会设置当前 `RunOptions.Terminate`，后续请求使用新的 RunOptions；取消和结束会释放本次裁片、张量及输出。

`LocalOcrException.Code` 包括 `model_missing`、`model_invalid`、`invalid_image`、`image_too_large`、`text_line_too_long`、`too_many_blocks`、`ocr_failed`、`ocr_runtime_unavailable` 和 `cancelled`。错误不附带输入图片、识别文字或底层文件路径。

仅有检测和识别模型，没有 180° 方向分类器。不保证倒置、任意方向、复杂多栏、表格或手写的准确率。阅读顺序采用近似行聚合及行内从左到右排序；输出应由用户校对。

## 后台验证

```powershell
dotnet build tests/Screenshot.Ocr.Tests/Screenshot.Ocr.Tests.csproj -c Release --artifacts-path artifacts/p0-ocr --maxcpucount:1
dotnet artifacts/p0-ocr/bin/Screenshot.Ocr.Tests/release/Screenshot.Ocr.Tests.dll
dotnet artifacts/p0-ocr/bin/Screenshot.Ocr.Tests/release/Screenshot.Ocr.Tests.dll models/pp-ocrv5-mobile --integration
```

最后一条是显式模型推理验证，输入为内存绘制的固定中英文 PNG；不创建窗口或读取桌面。它还会在测试输出目录保存 `synthetic-ocr-input.png` 和 `synthetic-ocr-result.json`，均为生成的验证产物，不应提交。没有模型时默认算法测试仍可运行，`--integration` 必须明确报告缺模型失败，不能伪造通过。

## 官方资料

- [ONNX Runtime C#](https://onnxruntime.ai/docs/get-started/with-csharp.html)、[RunOptions.Terminate](https://onnxruntime.ai/docs/api/csharp/api/Microsoft.ML.OnnxRuntime.RunOptions.html#Microsoft_ML_OnnxRuntime_RunOptions_Terminate)。
- [OpenCvSharp](https://github.com/shimat/opencvsharp)：固定 `OpenCvSharp4` 与 `OpenCvSharp4.runtime.win` 4.13.0.20260627；`Microsoft.ML.OnnxRuntime` 1.31.0 为 CPU 包。
- [PaddleOCR PP-OCRv5 检测配置](https://github.com/PaddlePaddle/PaddleOCR/blob/main/configs/det/PP-OCRv5/PP-OCRv5_mobile_det.yml)与[识别配置](https://github.com/PaddlePaddle/PaddleOCR/blob/main/configs/rec/PP-OCRv5/PP-OCRv5_mobile_rec.yml)。
- [RapidOCR 固定模型清单](https://github.com/RapidAI/RapidOCR/blob/7cfd3d9ef786a2e538ca30df700325e72e85b5f5/python/rapidocr/default_models.yaml)；DB 和 CTC 算法流程参考其公开 Python 实现，本项目不执行 Python OCR，也不依赖 RapidOCRLib/Emgu。
