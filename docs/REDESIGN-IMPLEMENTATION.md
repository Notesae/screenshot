# 原位编辑改版实施记录

## 2026-10-21 修正

r5 针对松手阶段全屏闪动和快捷键等待：r4b 的“任何 Source.Changed 即成功”存在透明空帧也被接受的确定缺陷，离屏测试已复现。现显示回调完成后才验帧，按本次冻结图和遮罩 alpha 检查有限采样，单行 RenderTargetBitmap 读回，不新增屏幕捕获或保存像素；在 SDK Unlock/setter 返回后的 Dispatcher.Background 执行，取消/失败清理排队检查。撤销 EditorSurface 的隐藏/恢复，保留正常 WebView 合成；单次 2 秒超时维持原生遮挡重试。RenderTargetBitmap 的 D3DImage 软件回退读回行为参照 [WPF/Direct3D 互操作](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/wpf-and-direct3d9-interoperation)。这仍是采样检查，真实驱动读回成本与 GPU 合成不能由 DrawingImage 测试证明。

快捷键没有额外按键消抖延迟，入口的无条件 180ms 等待已移除；宿主已隐藏时直接进入捕获，可见时先 Hide 再等本进程 DwmFlush。保存保护仍在，未绕过快照。运行时异步写入本机 `%LOCALAPPDATA%/Screenshot/diagnostics/capture-latest.json`，仅固定阶段、相对耗时、拒绝计数、随机 captureId 和构建标记；不含路径、窗口标题、截图像素、文档或凭据。最多 64 阶段，仅保留最近捕获，写失败不影响截图。可区分保护保存、取帧、窗口选择显示、用户选区时间、编码、验帧和撤挡；当前并无真实快捷键性能测量，不宣称零延时。

最新连续截图反馈覆盖上一轮结论：B 图解码前，旧 A 的 CompactOverlay 仍为 is-presented；旧版无头探针连续 12 帧可见旧边框、遮罩洞和工具，且取消后的 B 解码/回复仍会替换活动文档。现捕获请求发起/新图到达即同步暂停整组旧呈现，新图解码后原子提交，旧任务只清理自己序号的暂停状态；取消保留受保护的旧文档。

WPF 的 WebView2CompositionControl 通过另一个合成图像显示浏览器内容，因此 RAF/尺寸匹配仍不能证明模板图像已更新。宿主在新捕获开始时隐藏 EditorSurface，painted 处理时先监听 PART_image 源变化，再调用当前捕获专属的网页显示回调；收到新图像后恢复 Surface，处理 WPF 队列并等待本进程 DirectX 提交，再撤挡。参考微软 [CompositionControl 规范](https://github.com/MicrosoftEdge/WebView2Feedback/blob/main/specs/WPF_WebView2CompositionControl.md)、[D3DImage 源码](https://github.com/dotnet/wpf/blob/main/src/Microsoft.DotNet.Wpf/src/PresentationCore/System/Windows/InterOp/D3DImage.cs) 与 [DwmFlush](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmflush)。本轮只读本地锁定 SDK 的 IL 核对 Source 设置与 AddDirtyRect/Unlock 路径，没有依赖或运行时变更；后台 DrawingImage 测试仅证明订阅生命周期，真实 SDK/GPU 合成交接仍未验收。

针对用户再次反馈的交接卡顿/装饰抽动：无头合成场景中，第二次 resize 延迟 120ms 到达时，旧实现已显示工具，产生两次布局变化。现改为 ready 返回原生客户区/DPI 目标，painted 携带浏览器实际视口，宿主二次核对 Win32/WPF 布局，不匹配则携最新目标要求重试；不再把固定四帧作为稳定依据。React 在 resize/ResizeObserver 浏览器回调中同步提交共享视口与动作轨测量，避免选区读全局尺寸、工具读旧 state。原生窗口 DPI 来源参照 [GetDpiForWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdpiforwindow)，仅在与浏览器布局交互处使用 [flushSync](https://react.dev/reference/react-dom/flushSync)，不用于逐帧画布更新。

遮罩由 100vmax 扩散阴影改为视口大小、挖出选区的 SVG evenodd 路径；边框保留局部柔光。首次动作轨和原样卡片只用 120ms 透明度淡入，原生尺寸胶囊在松手前后内容一致。loadImage 仅缓存最近一次解码，供校验和首次渲染共用，不按撤销历史积累源图。新增独立无头五场景逐帧探针，并接入既有 CI；模拟结果不能证明真实 WPF/GPU 合成交接已验收。

在 main `6d7b678` 上修复原生框选的额外确认阶段，松手即交接；初始同时显示动作轨和原样浮卡。后续选区几何通过 `capture.adjust` 从同次原生冻结图重裁剪；八手柄、整体移动、像素微调、手势 Esc 取消、撤销/重做、失败留存与迟到响应均有合成回归。

增加 `design/soft-clay.tokens.json`，React 直接导入，原生程序集嵌入同一份资源；材质基础色、遮罩、圆角、核心阴影、尺寸、字体、时长及曲线不再各写一套。按本次修复要求将浮层/控件核心圆角设为 12px。原生框选层抗锯齿绘制圆形手柄、胶囊尺寸标签、同色准线和圆角放大镜；托盘自绘表面，WPF 控件替换按钮、输入、下拉、勾选、标签页、滚动及进度条模板。条款门禁、服务密钥边界与 OS 文件选择流程保持原有行为。

Toast 入场统一 280ms、退出 180ms，按压 120ms、释放回弹 280ms，曲线共用。提示窗口可获得键盘焦点，Enter/空格或 Ctrl+Enter 继续同一文档；聚焦/悬停期间不自动消失，失焦后 2.4 秒收起。实际原生焦点、输入与 DPI 尚未实测。后文是原批次的历史记录，参数冲突以本节及 `editor/DESIGN.md` 为准。

基线：`32406319ea8e46be8a7388bcb9b521cf14210ce4`（2026-10-20 获取的最新 main）。

用户已授权按入口与保存保护、收起恢复闭环、Soft Clay Capsule v2 视觉与动效的顺序实施；完成后创建 draft PR，不合并。原工作区的 OCR 试验提交与未提交改动保留原位，不纳入本分支。

桌面交互测试继续暂停。只运行后台构建、单元测试和合成宿主检查，真实 Windows、混合 DPI、IME、原生对话框与剪贴板交互据实列为未测。

## 完成的实现

1. **入口与保护先行。** 条款门禁后透明、不激活地完成 WebView 挂载，再驻留托盘；默认区域截图，保留当前屏幕/整个桌面、打开图片/项目、粘贴、继续编辑、恢复、设置、退出入口。托盘或热键失败有轻量入口提示；加载失败保留原生重试/截图兜底条。正常编辑不常驻该兜底条。
2. **覆盖与关闭保护。** 新截图、导入/恢复、收起、重载和退出统一确认当前编辑并写入独立恢复快照。恢复库失败、过期身份、文字编辑或忙状态拒绝离开。项目保存与 PNG/文字输出分开；关闭失败提供默认不放弃的原生确认。更新器成功接手后才豁免重复关闭保存。
3. **输出与恢复。** PNG 复制/保存成功后核对文档、历史 revision、捕获 ID 和呈现代数；保护成功才隐藏编辑层并释放冻结背景。独立原生提示只含文案和继续编辑动作；继续编辑复用同一文档与历史。取消保存、输出失败或快照失败保持可操作。文字复制不触发收起。
4. **共享轻量外壳。** 截图与文件复用 CompactOverlay、EditorCanvas、文档/历史/导出内核。文件使用中性背景与原有缩放滚动，不产生伪造屏幕坐标。原样/美化/文字同文档；识别和翻译不强制切换成文字卡片。原有源框校对、双语、项目、恢复、服务诊断、更新、捕获设置均保留低频入口。
5. **位置与视觉。** 动作轨拖动把手、浮卡标题拖动、方向键 8 px / Shift 24 px 微调、重置位置；只记本次文档会话。边界使用目标屏幕 workArea，并随视口变化校正；空间不足时允许浮卡部分覆盖内容，工具始终不进入导出。Soft Clay 深暖灰渐变、内外阴影、圆角、单一蓝色强调、凹陷文字框、焦点/禁用/错误状态统一；按压 280 ms、浮卡 320 ms、提示 280 ms，系统减弱动态效果关闭前端动画/过渡。

## 视觉来源与调整

用户给定 [Soft Clay Capsule v2](https://www.figma.com/design/UzKxsZKfMWqSLZR7gNB4kA/?node-id=3-33)。实际设计位于 **B Soft Clay Capsule（1:2）**；默认 Page 1 是空页，不作为“设计缺失”的依据。读取了原样 1:32、美化 3:2、文字 4:2、更多 7:2、提示 7:51 及动效组件。五个 SVG 来自该文件的复制、美化、文字、更多、关闭图标，作为本地资源存于 `editor/src/assets/soft-clay/`；没有运行期外链或新字体下载。

对参考的实际适配：动作轨增加原有标注与撤销能力并可换行；按钮缩小为紧凑编辑尺度。蓝色按钮中部使用更深蓝以提升小号白字可读性。浮卡按可用空间滚动，文字识别后折叠识别设置，复制动作优先可见；高级排版仍保留标题、字号、宽度、行段距。材质使用代码渐变/阴影，未生成位图纹理。Impeccable 检测仅报告弹性 easing；这是用户指定的动效语言，保留并提供 reduced-motion。

## 交付与验证边界

- 使用原有测试工程，没有新增测试工程、付费依赖、OCR 模型或自动服务调用；未改变版本、发布、恢复容量或数据目录。
- 合成宿主脚本为 `scripts/test-editor-lifecycle.cjs`：内存桥、生成 PNG、无头浏览器、仅本地请求，所有复制/对话框/捕获都模拟。覆盖共享标注、显式 OCR、文字复制分离、拖动/微调、失败/取消留存、成功释放、继续编辑、四层 Esc、窄屏与 reduced-motion。
- 原位转中性呈现时发现并修正 Fabric 包装 canvas 与 React 祖先分支切换冲突；保留稳定 DOM 结构，恢复不会卸载画布或丢历史。
- 独立只读审阅发现的重载保护、迟到收起、失败释放旧背景、更新异步关闭问题均修复并复核；该复核不代表整机视觉/交互通过。
- 最新测试数字及环境限制见 `VALIDATION.md`。合成预览仅在被忽略的 `artifacts/qa/redesign/`，不将截图、导出或构建输出提交 Git。`06-mock-toast.png` 是模拟提示，不是实际 WPF 提示截图。
- 原目录 `H:\work\screenshot` 的 `test/isolated-update-paired-ocr`、原有提交和 8 个修改/未跟踪文件均保留；实现位于独立托管工作树。结束前逐一核对这 8 个文件 SHA-256，与开始时一致。
- CI 改为验证当前轻量路径，替换已经不存在的三栏/完整工作台结构断言；当前能力套件 12 组通过，既有更新快照、不可见文字编辑与 1080p/4K/8K 导出检查迁移后通过。历史 UI 套件并非一对一全量迁移，边界见 `editor/scripts/README.md`。没有更改 OCR 性能脚本或增加基准样本。
- 设计记录落在 `editor/DESIGN.md` 与 `editor/.impeccable/design.json`，由实际 CSS 提取；不把实机未测或合成画面固化成已验收约束。

## 2026-10-21 五项实测反馈修复

移除选区移动图标，框内空白直接拖动，标注仍由 Fabric 命中处理。松手落点和工具位置保持到同一底图绘制完成；画布先按目标比例同步绘制，再发 ready，避免旧图和旧尺寸闪回。删除 W/C 快捷操作及提示，保留设置中的自动吸附。

启动宿主在屏外无边框预热，不展示普通标题栏和黑底；预热失败或用户提前操作才显示独立 Soft Clay 小提示，窗口位置不记录预热坐标。首次框选使用异步结果代替模态窗口立即关闭，PNG 编码移到后台；临时画面按捕获身份保留至布局握手完成，取消/超时/退出清理。工具入场在 ready 被接受后开始，浮卡与状态条略错开，减少动态效果仍关闭动画。

后台验证记录见 VALIDATION.md。真实 Windows 启动黑窗、框选交接、调整落位和流畅度仍需用户实测，未恢复桌面自动操作。

## 2026-10-21 后续交接、手绘与菜单修复

此前只等待 Dispatcher 布局，不能代表 Chromium 可见合成帧已经提交。现在先在原生冻结层之后展示宿主，再经浏览器两帧和 WPF 两帧确认撤挡；前端准备前隐藏画布装饰，工具只在最后确认后入场。真实显卡/多屏闪动是否消失仍需用户验收。

关闭属性卡时布局跟随 visiblePanel，退出期间不切成默认 500px 面板参与避让。标注工具点击只待命，按住拖出几何、文字点击定位；草稿不进入模型，松手一次提交，取消/极小误触不污染历史。箭头取消旋转/矩形控制框，只显示首尾控制点；矩形系列保留边角调整且去掉旋转柄。端点实现参考 [Fabric 控制 API](https://www.fabricjs.com/api/classes/control/) 与[官方局部坐标示例](https://www.fabricjs.com/demos/poly-controls/)，不扩大 Fabric JSON 信任范围。

托盘保留 NotifyIcon 入口，右键改开独立 WPF ContextMenu：统一渐变浮卡、圆角高亮、线性矢量图标、捕获/文件/会话/退出分组，快捷键文本读取当前实际注册状态。菜单不展开编辑主窗口；键盘/无障碍仍沿用 WPF 菜单机制，真实定位/焦点/屏幕阅读器未实机验收。
