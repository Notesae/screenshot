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


## 0.3.0 便携目录的依赖盘点

`scripts/release-audit.cjs` 从本机锁定 npm 包及发布还原的 NuGet metadata 生成 CycloneDX1.6 SBOM、`dependency-inventory.json` 和 `dependency-licenses/`。为避免漏报，npm 开发依赖及仅构建时使用的 NuGet 包也保守列入；不能据此认定它们都进入运行时 bundle。无许可证标识或文本的组件列在 licenseReviewGaps，仍需逐项复核，自动脚本不作法律保证。

模型按固定 manifest 校验，发布不嵌入新字体，继续使用系统字体回退。运行时/SDK/WebView2/OpenCV等随包第三方归属仍需一起保留。安装器、证书、更新通道、ARM64与干净机器验收尚未完成。

SBOM字段依据 [CycloneDX1.6官方schema](https://github.com/CycloneDX/specification/blob/1.6/schema/bom-1.6.schema.json)；AI用量解析依据 [OpenAI Chat协议](https://developers.openai.com/api/reference/resources/chat)与[Ollama Chat协议](https://docs.ollama.com/api/chat)，兼容服务缺失字段保持未知。


遗漏许可补齐：saxes6.0.0 的完整ISC/历史归属文本固定取自 npm发布 gitHead `211fa0ebec9b628affc09219199639887174bfc3`；esbuild/Rollup的Windows制品使用同版本父包随附文本；node-canvas保留发布包Readme中的完整MIT及BMP许可。stackback0.0.2（仅测试工具链）的发布包声明MIT但未附文本，仍列为复核缺口，不推断其版权文字或宣称全量许可审计完成。

## 0.4.0补充复核

自包含.NET运行时10.0.13的实际pack许可和.NETCore第三方告知纳入dependency-licenses。stackback0.0.2已定位上游发布提交，仍缺完整正文；OpenCvSharp运行时所附FFmpeg插件等嵌入依赖的构建归属也需继续复核，详见docs/RELEASE-LICENSE-REVIEW.md。不得把SBOM生成成功当作全量许可审计完成。

## 0.4.1 原生范围与补充告知

OCR使用同版本OpenCvSharp4.runtime.win.slim，保留原始Paddle/ONNX CPU模型与算法；不携带未使用的FFmpeg插件。原生子组件的来源、正文和摘要见licenses/native-license-sources.json，保守静态构建清单/未关闭复核项见licenses/native-components.json及docs/RELEASE-LICENSE-REVIEW.md。

This software is based in part on the work of the Independent JPEG Group.
This product includes software developed by the University of California, Berkeley.

自包含.NET、SDK目标框架、WebView2 SDK、ONNX及SQLite包告知继续携带；WebView2 Runtime和Visual C++ Runtime为外部环境要求，程序不自动安装。IPP原始EULA随包保留，不表示已替用户接受新条款或完成再分发审查。
