# 框架实现决定

## 保留批准架构

采用用户在原本地任务中批准的 .NET10/WPF/WebView2/React/TypeScript。Fabric 负责编辑及导出，WPF负责采集、文件、剪贴板、设置与网络请求。应用自有的版本化文档状态独立于Fabric对象树。

## 首条捕获路径

框架阶段使用有限的 GDI SDR 基线，捕获后端通过 ICaptureBackend 隔离。它用于验证冻结图、物理像素选区和编辑通信，不取代评估中完整产品的 WGC 主后端计划。HDR、受保护窗口、游戏、最小化/遮挡窗口等不声明支持；后续实现见TASKS C1/C2。

## 截图默认原位编辑

按用户最新明确要求，捕获完成后使用同一 WPF 窗口、同一 WebView2 与同一前端文档转为原位遮罩，不自动跳入工作台。冻结桌面 BitmapSource 保留在原生层，WebView2CompositionControl 以透明背景绘制其上的选区编辑器和工具条；此组合控件避免标准 HWND 宿主遮挡底层 WPF 图像的问题。进入工作台是用户显式操作，退出原位层清空冻结背景引用并保留内存文档。

跨层仅传裁剪图和绝对物理像素矩形（桌面、选区、各屏幕），前端按实际 viewport 的 X/Y 比例分别映射，不把某一显示器 DPI 套到整张虚拟桌面。准备原位层时先隐藏窗口，前端渲染完成后确认再显示；过期确认不能重新显示已退出的遮罩。实机透明合成、混合 DPI 与焦点行为尚未测试，后台测试只证明纯计算和状态转换。

## 图片传输与存储

当前单文档框架用有大小和像素上限的本地 data URL 简化跨层传输，保存可移植JSON项目。它适合验证首批静态图片，不适合高频捕获和超长图。完整产品按评估改为资产ID、受控资源通道和SQLite索引，避免重复Base64与全图历史副本。

## OCR和AI

提供 OpenAI-compatible Chat Completions 与 Ollama /api/chat 两类原生适配器；不会假定所有兼容服务均支持OCR。ONNX本地OCR未选择或下载模型，不能显示为已安装或已识别。DPAPI密钥仅在当前Windows用户原生进程使用，网页只收到公开配置。真实外部服务验证需要可用配置，本次使用模拟HTTP，不调用付费服务。

## 原文与完整产品边界

评估的完整十三节正文作为方案资料归档，不代表本阶段把数月完整产品需求全部实现。保持原任务已批准的框架交付，逐项记录剩余工作和实际测试；不能把用户希望的最终能力转换成未经测试的产品承诺。

## 依赖安全与坐标兼容

初次 npm 审计报告 Fabric 6 与 Vitest 3 依赖链中的已知问题。采用 Fabric 7.4.0 和 Vitest 4.1.12，避免强制覆盖旧测试池或原生 canvas 安装器的跨主版本依赖。Fabric 7 改为中心原点，因此底图与标注统一显式设置 left/top 原点，保持已有项目坐标语义。当前只导出位图，不加载任意 Fabric JSON 或 SVG。

版本依据：[Fabric 7.4 官方发布](https://github.com/fabricjs/fabric.js/releases/tag/v740)、[Fabric 7 迁移](https://www.fabricjs.com/docs/upgrading/upgrading-to-fabric-70/)、[Vitest Windows 路径修复公告](https://github.com/vitest-dev/vitest/security/advisories/GHSA-xp26-3454-mjgp)、[Vitest 4 测试池迁移](https://v4.vitest.dev/guide/migration.html#pool-rework)。最终审计及离线渲染证据见 VALIDATION.md；实际 Windows 透明合成并不由这些检查证明。

本机 SDK 10.0.102 默认的自包含运行时为 10.0.2。发布脚本明确选择 10.0.13，按 2026-10-19 核实的 [Microsoft .NET 10 发布元数据](https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json) 固定当时维护补丁；不修改机器全局 SDK 或用户运行中的应用。后续更新补丁仍需重新构建与回归。
