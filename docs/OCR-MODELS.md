# 本地 OCR 模型选择与分发

2026-10-19 核实，选择 PP-OCRv5 mobile 检测与识别，使用纯本地 ONNX Runtime CPU。取舍是先固定已成熟的轻量中英路线，而非追随新增系列或引入大型文档模型。这里说明公开许可来源与实现选择，不扩大为任何精度或特定硬件保证。

## 官方来源与许可证据

- 上游 [PaddlePaddle 检测模型卡](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det) 与 [识别模型卡](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec) 均标明 Apache-2.0；官方 API 元数据返回 gated:false。对应核实 revision 已写入 manifest。
- ONNX 转换制品来自 [RapidAI 官方 registry](https://github.com/RapidAI/RapidOCR/blob/7cfd3d9ef786a2e538ca30df700325e72e85b5f5/python/rapidocr/default_models.yaml)，固定 ModelScope v3.10.0 URL 与 SHA256，不按文件名猜测身份。
- [RapidOCR 来源说明](https://github.com/RapidAI/RapidOCR) 将 PaddleOCR 官方衍生权重与转换制品按上游 Apache-2.0 许可分发；其单独 MODEL_LICENSES.md 的当前默认制品表主要列 v6，不能把那个表当作 v5 的唯一证据。本方案同时保留具体 v5 官方模型卡、项目许可与 registry 溯源。
- 上游 [PaddleOCR LICENSE](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE) 和 [RapidOCR LICENSE](https://github.com/RapidAI/RapidOCR/blob/main/LICENSE) 随模型包提供，保留相关版权/归属与上游 NOTICE（若存在）。转换由上游完成，本项目不更改模型权重，不暗示官方背书。
- ONNX Runtime [C# 官方说明](https://onnxruntime.ai/docs/get-started/with-csharp.html) 提供 CPU C# API；其 [MIT 许可](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) 与 OpenCvSharp [Apache-2.0 许可](https://github.com/shimat/opencvsharp/blob/master/LICENSE) 分别归档。Windows x64 CPU 运行实际兼容性用本机合成推理验证；其他架构、CPU 指令集和干净机器另列未测。

当前公开下载不需要付费、密钥、登录或专属模型协议。若下载源将来变为 gated 或条款改变，准备脚本必须停止，不能绕过或替用户接受。

## 制品身份与安装

权威清单为 `models/pp-ocrv5-mobile/manifest.json`：det SHA256 4d97c44a…ae78ae，rec 5825fc7e…1742c5。完整值、固定下载 URL、registry revision 和模型卡 revision 均可核对。

权重不进 Git。开发/发布通过显式准备脚本下载到模型目录并校验哈希，CI 同样显式执行；应用运行时只读本地目录，缺少文件时清楚提示不可用。发布同时带模型清单、许可证和来源说明；不把 API Key 或用户图片放入模型目录。

检测与识别匹配同一模型系列；已检查本制品的识别 ONNX 自带 18383 项字典元数据，加 CTC blank 与空格对应 18385 类，不需要额外字典下载。CPU intra-op 2、inter-op 1，OpenCV 1 线程；PNG 限 20 MB / 3200 万像素，单行宽度和文字块数量均有明确上限，超限返回错误。识别结果必须人工校对，不能将置信度当成准确率。

合成中英文推理验证输入由内存绘图生成，预期两行 `Hello OCR 123` 与 `中文截图测试`；检测识别输出逐字相同，两个块的原始平均字符概率约 0.972 与 0.999。相同输入块 ID 稳定、空白输入无文字块、推理取消后后续识别恢复。它验证模型和运行库实际连通，不是现实样本准确率或复杂页面排版保证。
