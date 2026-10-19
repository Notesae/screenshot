# PP-OCRv5 mobile 本地模型包

上游模型权重版权归百度及 PaddleOCR 相关权利人；ONNX 转换与 registry 由 RapidOCR 作者提供。权重按 Apache License 2.0 分发。本项目不修改权重，固定源 URL、release revision 与 SHA256 见 manifest.json，不暗示 PaddlePaddle 或 RapidOCR 官方背书。

上游官方模型卡：
- https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det
- https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec

转换来源：https://github.com/RapidAI/RapidOCR

识别字典来自固定识别 ONNX 的 character 元数据，含 18383 个条目；CTC blank 及尾部空格共同形成 18385 类，不另外引入第三方字典。

随包 LICENSE-PaddleOCR.txt、LICENSE-RapidOCR.txt 保留完整许可和归属。公开许可证据、模型选择与下载边界见 docs/OCR-MODELS.md。
