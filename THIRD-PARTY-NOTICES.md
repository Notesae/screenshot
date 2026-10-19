# 第三方组件与模型

本文件记录本批使用的主要组件及来源，不改变其原有许可证，也不代替完整分发审计。安装包、签名、干净机器验证及完整依赖许可审查仍属于 R1。

| 组件 | 固定版本 | 许可/官方来源 |
|---|---|---|
| ONNX Runtime CPU | 1.31.0 | [MIT](https://github.com/microsoft/onnxruntime/blob/main/LICENSE)，NuGet 包同时提供 ThirdPartyNotices.txt |
| OpenCvSharp / Windows runtime | 4.13.0.20260627 | [Apache-2.0](https://github.com/shimat/opencvsharp/blob/master/LICENSE)，绑定的 [OpenCV 许可](https://github.com/opencv/opencv/blob/4.x/LICENSE)及其第三方归属仍适用 |
| Microsoft.Data.Sqlite | 10.0.13 | [MIT](https://github.com/dotnet/efcore/blob/main/LICENSE.txt)，通过 SQLitePCLRaw 使用 SQLite |
| SQLitePCLRaw | 2.1.13 | [Apache-2.0](https://github.com/ericsink/SQLitePCL.raw/blob/main/LICENSE.TXT)，保留 [NOTICE](https://github.com/ericsink/SQLitePCL.raw/blob/main/NOTICE.TXT) |
| SQLite | 由固定 SQLitePCLRaw 包携带 | [公共领域声明](https://www.sqlite.org/copyright.html)；不能将绑定库与数据库引擎许可证混为一项 |
| Windows SDK .NET targeting pack | 10.0.19041.57 | [Microsoft Windows SDK 标准条款](https://aka.ms/WinSDKLicenseURL)，用户已明确授权复用及 CI 还原；不把开发 targeting pack 当作完整 SDK 分发 |
| WebView2 SDK | 1.0.3179.45 | [Microsoft 官方包及许可](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3179.45)；运行机仍需 WebView2 Runtime |
| React / TypeScript / Vite / Fabric / Vitest | 以 editor/package-lock.json 为准 | 各 npm 包随附许可证；Fabric 7.4.0、Vitest 4.1.12 |
| PP-OCRv5 mobile det/rec | RapidOCR v3.10.0 固定 SHA256 | Apache-2.0；完整模型来源、上游许可和 NOTICE 见 models/pp-ocrv5-mobile 与 docs/OCR-MODELS.md |

发布时模型目录必须同时包含 manifest、PaddleOCR/RapidOCR 许可证和归属说明。应用运行时不下载模型，不包含任何服务商密钥、私人截图或测试输入。
