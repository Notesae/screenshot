# Screenshot

Windows 截图与内容美化应用框架。支持原样、美化和文字重排三种编辑意图，原生 WPF 宿主加载本地 React/Fabric 编辑器。

截图完成后保留冻结桌面，在原选区直接编辑并显示紧凑工具条；需要完整界面时主动选择「完整工作台」。冻结桌面仅用于原生背景，导出和 AI 输入只使用选区文档。实际遮罩、焦点与多屏显示效果尚未实机验证。

Esc 按编辑上下文先退出文字/选中对象或关闭属性面板，最后隐藏原位层；托盘提供恢复工作台、区域截图和退出入口。文档仍需手动保存项目，隐藏并不等于自动备份。

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

发布目录包含 .NET 运行时和本地编辑器；仍需机器安装 WebView2 Runtime。`verify.ps1` 执行前端测试/构建、.NET 构建和两个无需外部测试框架的断言运行器；任何失败均以非零退出码结束。CI 同样执行这些检查，实际桌面验证另见验证记录。

验证与发布使用独立的 `artifacts/` 构建路径，不要求关闭已经运行的应用。依赖已还原时可传入 `-SkipRestore` 省略 npm ci；此参数不省略测试或编译。

## AI 与隐私

在原生设置窗口配置 OpenAI 兼容服务或 Ollama，仅在用户点击 OCR/翻译后发送输入。API Key 用 Windows DPAPI 保存在当前用户的本地配置目录，不传给网页、项目文件或日志。未配置或服务不可用会显示错误，不会返回模拟识别/翻译结果。

本地 ONNX OCR 尚未选定并集成模型。无需 AI 服务也可使用本地图片编辑工作流。

## 范围与验证

- [原任务、批准范围与来源完整性](docs/SCOPE.md)
- [完整评估原文归档](docs/ASSESSMENT-SOURCE.md)
- [后续任务分工与验收](docs/TASKS.md)
- [框架实现决定](docs/DECISIONS.md)
- [测试证据、未测项与阶段限制](docs/VALIDATION.md)
- [原生通信契约](docs/BRIDGE.md)
- [实施分工](docs/superpowers/plans/2026-10-19-application-framework.md)

当前是应用框架交付；完整截图产品的后续任务和已测试/未测试项以仓库内任务及验证文档为准。

WGC、本地 ONNX OCR、完整撤销/重做和 SQLite 历史恢复尚未实现。编辑内容目前需要手动保存项目。用户已暂停桌面交互测试，后续未测的捕获、配置窗口和项目恢复等均不声明实机验证通过。
