# Screenshot

Windows 截图与内容美化应用。支持原样、美化和文字重排三种编辑意图，原生 WPF 宿主加载本地 React/Fabric 编辑器；当前在框架基础上交付首批 P0 功能，完整产品验收仍以验证记录为准。

截图完成后保留冻结桌面，在原选区直接编辑并显示紧凑工具条；需要完整界面时主动选择「完整工作台」。冻结桌面仅用于原生背景，导出和 AI 输入只使用选区文档。实际遮罩、焦点与多屏显示效果尚未实机验证。

Esc 按编辑上下文先退出文字/选中对象或关闭属性面板，最后隐藏原位层；托盘提供恢复工作台、区域截图和退出入口。编辑器提供本地自动恢复快照与显式恢复列表，手动项目文件仍用于长期保存。

## 开发

本次验证目标为 Windows 11 x64。开发需要 .NET 10 SDK、Node.js 22、MSVC x64/Windows SDK、CMake/Ninja 和 Microsoft Edge WebView2 Runtime；其他系统版本需单独兼容验证。

```powershell
./scripts/build-native.ps1
./scripts/verify.ps1
./artifacts/verify-source/bin/Screenshot.App/release/Screenshot.exe
```

原生 OCR 源码、固定工具、构建证据与显式 Vendor 回退说明见 [native/README.md](native/README.md)。未准备源码运行时会明确失败，不自动安装工具或回退。源码与 Vendor 使用独立构建目录。

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
- [0.4.3 四轮产品审查、截图与性能证据](docs/PRODUCT-REVIEW-0.4.3.md)
- [原生通信契约](docs/BRIDGE.md)
- [实施分工](docs/superpowers/plans/2026-10-19-application-framework.md)

当前是应用框架交付；完整截图产品的后续任务和已测试/未测试项以仓库内任务及验证文档为准。

0.3.0 补充了选区重新调整、方向键像素微调和冻结图放大镜；共享编辑器支持样式预设、边框、行段间距、原译文复制与换行选项，2×重排文字按目标分辨率重绘。AI 支持按任务取消、长文分块/失败块手动重试、错误分类、15分钟有界内存缓存、128条无正文用量摘要与显式合成输入能力测试。原文修改会保留旧译文并提示过期。恢复库可查看去重原图容量并确认批量清理所选记录。

OCR 会先应用实色遮盖，再缩放；旋转遮盖保守扩大，重排坐标无法映回原图时拒绝识别。已有识别文字与可编辑项目仍可能包含原图信息，分享前需检查。

发布目录附带 `sbom.cdx.json`、依赖许可文本、清单与 `SHA256SUMS.txt`；清单记录尚需许可复核的缺口，不把自动盘点等同于全量许可审计。运行 `./scripts/diagnose-portable.ps1` 只检查文件、模型哈希与WebView2安装信息，不启动产品。

窗口吸附、显示器选择、热键与拖放已有0.4.0实现和后台测试，真实桌面与完整现实样本评估仍待验收。安装器、签名、更新与卸载策略、额外字体、ARM64 和干净机器验收未决。用户已暂停桌面交互测试，真实捕获、透明合成、混合DPI、系统热键/剪贴板、中文IME、服务商端到端均不声明通过。

## 0.4.0 后续工程切片

区域截图支持几何窗口吸附，W切换吸附、C选择含标题栏或客户区；捕获范围面板提供当前/指定显示器和区域热键设置，注册冲突时保留原组合。热键设置持久化，其余捕获设置为本进程共享。

原位层可拖入PNG/JPEG/WebP，大图仅适配显示比例，原始导出像素不变。翻译源块、生成/校对结果及失败状态随项目和自动恢复保存；重开后可续未成功块。源文、目标语言或服务配置改变会阻止旧任务续传。所有真实桌面交互仍未验收，详见docs/VALIDATION.md。

已发布0.3.0预发布：[下载页](https://github.com/Notesae/screenshot/releases/tag/v0.3.0)。0.4.0为后续构建切片；构建通过不代表完整产品验收。

## 0.4.1 后台质量切片

大图存储改为流式元数据/图像分离，减少Base64复制与恢复转义缓冲；无标注导出跳过额外画布并及时释放私有像素缓冲。合成大图指标与四阶段子进程中断恢复见docs/QUALITY-0.4.1.md。原生OCR采用同版本官方精简运行时，实际CPU推理验证通过，固定模型不变。

便携目录附diagnose-portable.ps1，静态检查WebView2、模型及实际原生导入所需的外部Visual C++等文件；不自动安装、不启动截图软件。文件存在不能代替干净机器运行验证。本批未发布新Release，0.3.0/0.4.0产物保留。

## 0.4.2 原生源码切片

本地OCR默认使用固定官方源码构建的最小运行时，保留真实链接map、来源摘要与源码内附许可，关闭IPP/IW等可选组件。三轮同输入CPU模型对比的文字/几何/像素一致，本机合成耗时与内存观察见[构建与验证报告](docs/NATIVE-0.4.2.md)。旧包保留，Vendor仅为显式隔离回退。本轮没有发布新Release，也没有恢复真实桌面测试。
