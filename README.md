# Screenshot

Windows 截图与内容美化应用。支持原样、美化和文字重排三种编辑意图，原生 WPF 宿主加载本地 React/Fabric 编辑器；当前在框架基础上交付首批 P0 功能，完整产品验收仍以验证记录为准。

截图完成后保留冻结桌面，在原选区直接编辑并显示紧凑工具条；需要完整界面时主动选择「完整工作台」。冻结桌面仅用于原生背景，导出和 AI 输入只使用选区文档。实际遮罩、焦点与多屏显示效果尚未实机验证。

Esc 按编辑上下文先退出文字/选中对象或关闭属性面板，最后隐藏原位层；托盘提供恢复工作台、区域截图和退出入口。编辑器提供本地自动恢复快照与显式恢复列表，手动项目文件仍用于长期保存。

## 开发

本次验证目标为 Windows 11 x64。开发需要 .NET 10 SDK、Node.js 22 和 Microsoft Edge WebView2 Runtime；其他系统版本需单独兼容验证。

```powershell
./scripts/verify.ps1
./artifacts/verify/bin/Screenshot.App/release/Screenshot.exe
```

编辑器可独立开发：

```powershell
cd editor
npm ci
npm run dev -- --host 127.0.0.1
```

浏览器模式提供本地编辑预览；桌面截图、Windows 剪贴板及原生文件/设置窗口由 Windows 宿主提供。

## 生成可运行目录

```powershell
./scripts/publish.ps1
./artifacts/Screenshot-win-x64/Screenshot.exe
```

发布目录包含 .NET 运行时和本地编辑器；仍需机器安装 WebView2 Runtime。`verify.ps1` 执行前端测试/构建、.NET 构建和原生、AI、OCR、存储四组断言；任何失败均以非零退出码结束。CI 另显式准备模型并运行合成图真实推理，实际桌面验证另见验证记录。

验证与发布使用独立的 `artifacts/` 构建路径，不要求关闭已经运行的应用。依赖已还原时可传入 `-SkipRestore` 省略 npm ci；此参数不省略测试或编译。

## AI 与隐私

在原生设置窗口配置 OpenAI 兼容服务或 Ollama，仅在用户点击 OCR/翻译后发送输入。API Key 用 Windows DPAPI 保存在当前用户的本地配置目录，不传给网页、项目文件或日志。未配置或服务不可用会显示错误，不会返回模拟识别/翻译结果。

本地 OCR 使用 PP-OCRv5 mobile + ONNX Runtime CPU，不联网识别、不需要密钥。模型不进入 Git；开发或发布前明确执行以下命令，脚本下载固定版本并校验 SHA256。应用缺模型时显示不可用，不静默下载或转云端。

```powershell
./scripts/prepare-ocr-models.ps1
./scripts/verify.ps1 -WithOcrIntegration
./scripts/publish.ps1
```

模型许可、来源和性能限制见 [OCR 模型说明](docs/OCR-MODELS.md)。中文/英文合成图推理已验证，但不是现实样本准确率保证。截图当前以 WGC 为默认；可明确选 GDI 兼容模式，两者仅声明 SDR，不保证 HDR 色彩保真。

恢复数据保存在 `%LOCALAPPDATA%/Screenshot/Recovery`，包含原图、OCR 与编辑文本；SQLite 索引和按 SHA256 去重的 PNG 资产分开保存。它不是加密保险箱，按容量清理最旧快照。可编辑项目同样保留原图；对外分享脱敏结果应导出已实色遮盖的 PNG。

默认保留最多 20 份快照、256 MiB 去重原图；单张恢复原图最多 20 MB / 6400 万像素，编辑 JSON 最多 4 MB。超限或写入失败会明确显示未保存，仍可手动保存项目。

## 范围与验证

- [原任务、批准范围与来源完整性](docs/SCOPE.md)
- [完整评估原文归档](docs/ASSESSMENT-SOURCE.md)
- [后续任务分工与验收](docs/TASKS.md)
- [框架实现决定](docs/DECISIONS.md)
- [测试证据、未测项与阶段限制](docs/VALIDATION.md)
- [原生通信契约](docs/BRIDGE.md)
- [实施分工](docs/superpowers/plans/2026-10-19-application-framework.md)

当前是应用框架交付；完整截图产品的后续任务和已测试/未测试项以仓库内任务及验证文档为准。

本批包含 WGC 后端、基础标注与撤销重做、裁剪缩放、本地 OCR、OCR 校对/双语排版及 SQLite 恢复。窗口/屏幕选择交互、完整选区微调、样式预设、自定义热键、AI 任务管理及安装签名等仍列后续任务。用户已暂停桌面交互测试，最终捕获、配置窗口、中文 IME 与真实恢复交互均不声明实机验证通过。
