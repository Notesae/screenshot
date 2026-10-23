# Native bridge v1

## 2026-10-24 导轨图标与同步布局

无新增桥方法、权限或项目字段。显示前同步补偿只读取编辑器 DOM 布局，矢量部件受力只改写 SVG 表现；悬停不调用识别、翻译或原生输入接口。三态的语义状态、按钮命中与文档历史保持即时更新，图标停稳后休眠，隐藏/减少动态复位。仅编译与输出更新，未进行自动化或桌面验证。

## 2026-10-23 工具落位释放

无新增桥方法、文档字段或服务调用。工具展开/收起完成后的释放状态及余振只保留在网页表现层，快速反向作废旧目标的待释放状态；绘制、调整与退出的业务状态即时提交。输出整理仅针对当前工作区，不影响截图、设置或宿主密钥。未运行自动化或桌面验证。

## 2026-10-23 轨道位置重建与控件合体

无新增桥方法、权限或模型字段。轨道局部布局与余振只驻留网页；选区移动的既有提交流程只触发表现层位置重建。快捷色、档位和滑杆沿用现有受控值、原生输入及历史合并，改动不延迟业务数据，也不调用服务。仅编译与打包，未进行自动化或桌面验证。

## 2026-10-23 浮卡、工具三态与滑杆表现

无新增桥方法、权限或文档字段。浮卡整体变换、工具三态材质和邻位过渡、滑杆跟随及档位点亮均仅保存在网页表现层。原生 range 仍即时提交既有值和手势历史，视觉弹簧不延迟业务数据；完成按钮移除可见文字后仍调用原完成动作。没有服务调用或截图传输变更，未进行自动化或桌面交互验证。

## 2026-10-23 框线合成范围补全

无新增桥方法或文档字段。既有 rect/ellipse 的 strokeWidth 也使用实心片段并集合成，覆盖线宽大于小图形尺寸时的边缘交叠。临时软体路径与准确几何共用合成函数，导出和命中始终读取准确路径；画笔继续复用该函数。未运行自动化或桌面测试。

## 2026-10-23 选区阈值与实心笔迹合成

无新增桥方法、权限或文档字段。选区手势在跨过 3 CSS px 且几何改变后才进入已有预览/裁剪流程，原地长按不会提交宿主。画笔仍保存受控 points 与 strokeWidth；仅本地渲染改用曲线细分后的同向实心片段并集，编辑、命中、独立预览及 PNG 导出共用 InkPath。工具的绘制/调整状态和浮卡软体受力不进入模型、不调用服务；仍未运行自动化或桌面测试。

## 2026-10-23 工具待命与悬停语义

无新增桥方法或文档字段。连续绘制的待命工具、悬停对象、临时受力与卡片过渡仅驻留网页内存；每笔完成后沿用 annotations 提交，独立撤销。美化按钮仍使用既有 mode 字段切换 beauty/raw，关闭不清掉参数；未启用时浮卡预览从临时文档合成，主图、导出与服务输入仍读取真实模式。悬停不改变工具、模式，不调用识别、翻译或发送截图；识别仍只由用户点击动作调用已有处理链。

## 2026-10-23 标注软体绘制边界

无新增桥方法或文档字段。矩形、椭圆、箭头与高亮的拖动表现改为编辑画布绘制时的临时路径形变；受力保存在弱引用中，仅主画布上下文使用，像素命中、独立预览、PNG 导出与服务输入不读取它。真实位置、尺寸、路径、缩放和角度仍由原手势直接更新，松手只写一次既有历史；马赛克与实色遮盖不形变。浮卡内容交接、收回时长及速度均只属于表现层。

## 2026-10-23 标注样式与表现层

无新增桥方法。项目 schemaVersion 仍为 2，既有可选 strokeWidth 字段扩展到 rect/ellipse/arrow/brush，读取范围统一为 1–48，旧标注缺省 3；points 仍只用于 brush，仍为有限数值坐标数组，路径完全由本地代码生成。画笔采样格式和马赛克 blockSize 保持原约束；矩形/高亮圆角、实心箭头与平滑笔迹通过同一受控渲染路径用于编辑、预览和导出。

图标、落笔和标注余振只使用 DOM/SVG 表现副本，不写入文档/PNG，也不改变真实对象的变换矩阵、位置、透明度或遮盖。工具待命样式仅在当前编辑器内存保存；实际落笔才提交标注，已有标注修改沿用历史且滑杆单手势归并。仍不读取系统输入、不捕获屏幕或发起服务请求。

## 2026-10-23 关闭取消与推理超时

无新增桥方法。`screenshotPrepareLeave("close")` 与 replace 一样允许 AI 忙状态通过，仍保留其它本地操作、文字编辑与画布就绪保护；成功准备离开时同步作废网页任务序号，调用已有 `ai.cancel {taskId}`，关闭不等待取消回执。网页收起按钮在退场动效前也执行此取消，分块任务不得继续，迟到结果与错误提示无效。complete、pin、更新继续拒绝 AI 忙状态。

`ai.test` 与原生设置草稿探测使用固定输入、64 个输出 token 上限及 30 秒期限；普通推理仍为 90 秒。原生设置只显示脱敏阶段和耗时。网页既有 120 秒兜底到期时对对应推理 taskId 发送 ai.cancel，避免无人等待的推理继续占用门控。协议仍不向网页传密钥；用户未点击时不探测、不重试、不上传截图。

## 2026-10-23 桌面钉图

新增 `image.pin {dataUrl:string,documentId:string,revision:number,captureId?:string}`，仅可信编辑器可调用，参与原有本地操作互斥。dataUrl 必须为本地 PNG，沿用 64 MiB 解码边界，并限制单边 16000、总计 4000 万像素。宿主在解码后使用 `screenshotPrepareLeave("pin")` 核对文档身份、修订、任务及画布状态，并复核呈现代数和 captureId；拒绝过期或已隐藏的呈现。pin 仅允许“钉到桌面”操作通过离开检查，不写恢复快照。

成功返回 `{accepted:true,pinned:true,presentation:"hidden"}`，宿主创建独立、默认 Topmost 的 WPF 钉图窗口后收起编辑器；失效返回 `{accepted:false}`，解码或创建失败返回现有桥错误。前端保留文档与历史，不调用 image.copy 或 presentation.complete。窗口持有冻结成品位图，拖动、缩放和置顶只改变本地展示，关闭释放资源；无外部图像来源、文件写入、剪贴板访问或服务调用。

## 2026-10-23 新标注工具字段

无新增宿主桥方法。项目 schemaVersion 保持 2，标注白名单增加 ellipse、brush、mosaic，旧 cover 仍可读取和编辑；矩形仅换图标。ellipse 复用 width/height 与变换字段；brush 的 points 为 2–1024 个局部 [x,y] 数值对，每轴必须在 0–16000，strokeWidth 为 1–48（默认 3）；mosaic 的 blockSize 为 6–64（默认 12）。只读取对应类型支持的字段，不恢复任意 SVG 路径、图片资源、滤镜或 Fabric JSON。

马赛克仅在本地合成当前已绘制内容，临时采样板不进入项目或桥消息。图片导出、美化缩略图和原样对比使用同一绘制对象；imageForProcessing 将 mosaic 与旧 cover 一起映回裁剪原图，保守扩大范围、实色封闭后才缩放供 OCR/图片翻译使用。显式识别/翻译的权限和上传条件保持不变，不因新增工具发起服务请求。

## 2026-10-23 图片美化预览

第一轮美化无新增桥方法或项目字段。预设、参数、恢复原样继续调用现有文档历史；美化预设只应用 mode/padding/radius/background/shadow/borderWidth/borderColor。旧文字样式仍可读取，编辑器不通过美化入口切换 reflow。缩略图和原样对比仅从当前本地文档合成，包含已提交标注、遮盖和译文，不捕获额外桌面、不写盘或发送服务请求。对比副本不成为 exportPng 的来源；完成仍从已提交文档生成 PNG，并遵守现有复制确认与收起时序。

## 2026-10-23 仅选区画布提供背景跟随输入

presentation.background 新增可选 pointer:{x:number,y:number}，两轴必须是 -1..1 的有限数，原有 captureId、严格递增 sequence、enabled 与 holding 约束继续生效。坐标相对当前可见选区中心归一化；仅网页真正命中截图 canvas 且落在选区镂空范围内的无按键鼠标移动可以携带此字段，浮卡、轨道、遮罩、手柄和控件不提供目标。输入发送前再次核对实际 DOM 命中，排除排队期间覆盖上来的浮层。

网页将同一显示帧的有效输入合并为最新一个点，宿主未应答时最多保留一个待发点；没有鼠标输入时不发送动画帧。离开选区只取消待发送坐标，不改变运动许可、不回正原生平面，已有弹簧自然停稳。宿主的窗口内 MouseMove 仅记录真实位置变化序号，不再直接驱动跟随，并用该序号过滤平面自身位移产生的指针同步事件；移除 MouseLeave 回正入口。按下冻结、松开/选区提交保持、就绪/身份/减少动态/隐藏门控与像素落定继续保留。指针字段只影响表现，不修改截图、裁剪、导出、系统输入或服务权限。本节覆盖旧记录中“网页不发送指针”的实现方式。

## 2026-10-23 选区落位保持

`presentation.background` 增加可选 `holding:boolean`（缺省 false），与 enabled 一起受当前捕获身份和严格递增 sequence 约束。holding 仅冻结当前显示位移与暗角，不能触发捕获、外发或业务完成。框选预览到新画布提交之间持续保持；原生鼠标松开不会提前解除此保持。capture.adjust 自身也保持现有姿态，不再 Suspend 清零整层；返回裁剪后仍由网页当前保持许可覆盖解码与绘制等待。正常完成或回滚平滑恢复，隐藏、失焦、减少动态和新捕获仍清零并休眠。原图、导出坐标与权限不变。

## 2026-10-22 框内同步轻移

桥字段与原图权限不变。冻结图和 WebView 在宿主内引用同一位移变换，避免逐帧 JS/native 消息造成不同步；输入由 WPF 映射回原 WebView 坐标，框选/首次交接仍归零。按下期间即使网页发来禁用许可也先保持当前姿态，松开后回正，避免选区手势的坐标系在拖动中变化。显示平移不写入 CaptureEnvelope、项目、图像或导出。

## 2026-10-22 冻结背景运动许可

新增 `presentation.background {captureId:string,sequence:number,enabled:boolean}`，返回 `{accepted:boolean}`。仅当前 Overlay、已接受 painted 且 captureId 匹配时可更新；sequence 为 0..Number.MAX_SAFE_INTEGER 的严格递增整数，同一捕获拒绝重复和迟到消息。重新框选时只记录旧文档的最新许可，运动仍由原生就绪门关闭，取消后可恢复；新捕获成功/收起时重置许可。消息绕过耗时操作锁，使任务过程中也能及时停用装饰；不能触发截图、上传、系统输入或业务完成。

编辑器只在许可状态变化时发消息，不发送指针或动画帧。就绪前、选区调整、阅读窗口存续、业务忙、挂起、退场、减少动态、粗指针和低开销时关闭许可。原生另检查窗口可见/激活、框选与 handoff 生命周期、系统动画偏好；冻结图及其边缘补片留在宿主，网页只接收原有裁剪图。隐藏/失焦清零并休眠；正常关闭许可平滑回正。

## 2026-10-22 隐藏与通知衔接

动效挂起只提交表现终态；已隐藏/尚未揭示的编辑外壳不能因迟到复制确认调用 presentation.complete，当前文档保留，已发出的复制请求不伪称撤销。原生新通知等待旧通知实际关闭，截图开始会作废排队中的提示。桥方法、字段、密钥和上传边界未增加。

## 2026-10-22 WPF 退场时序

原生窗口在已有 Closing 保护通过后保留短退出，实际关闭再次执行保护并恢复原模态结果；动画不生成同意、不跳过更新交接，也不提交网页完成协议。原生 Popup 关闭先释放输入、后销毁画面，托盘命令等实际 Closed 后排入。快速重开作废旧退出/命令；系统减少动态直接归到正确终态。没有新增桥方法、payload、服务请求或编辑器 OS 能力。

## 2026-10-22 v2 控件与浮层动效

新增普通控件反馈、浮卡短回收/换场/手动接管、滑杆手势历史标识与 WPF 浮层/折叠表现。手势标识仅用于当前编辑器撤销归并，不进入项目、PNG 或桥接 payload。未新增桥方法、OS 权限、上传动作或密钥读取面；原生窗口关闭和完成确认继续服从已有生命周期与身份保护。

## 2026-10-21 阅读窗口布局与手势

阅读窗口新增标题栏移动、角部调整尺寸、方向键操作、默认位置恢复和全局原文对照开关；宽窗口双栏对照，窄窗口按原文/译文上下排列。手动矩形保存在当前 React 截图会话，关闭/重开保持，新截图清空，不进入项目 schema、桥接 payload、PNG 或历史修订。手动放置不自动钳制或回跳；初始自动摆放仍避让截图与导轨，用户手动操作后退出临时独占阅读，恢复同一画布。桥方法、AI 提示/请求、上传授权、密钥隔离和 imageTranslation 字段不变。

## 2026-10-21 图片译文位置与独立图层

`ai.translate` 新增可选 `purpose:"image"`，仅选择原生端的界面短语直译提示及独立 `translate-image-text-v2` 缓存；不增加网络动作、付费重试、上传内容或密钥暴露。省略时保留普通文字翻译；其它用途值拒绝。视觉图片翻译仍使用 `ai.translateImage`，提示禁止定义、解释与扩写并保留数字/单位/专名，其进程缓存身份改为 `translate-image-v2`，避免复用旧说明式结果。

项目 schemaVersion 仍为 2，`editor.imageTranslation` 可选 `{blocks:[{source,text,x,y,width,height,fontSize,color,backgroundColor,align,needsReading,overflow}]}`，缺省为空。位置均为整张原图的 0..1000 坐标，最多 250 块、单块原文/译文各 2000、各总量 20000；字号 8–1024 源图像素、颜色只接受 #RRGGBB，align 只接受 left/center，两个状态字段只接受布尔。前端仅保存字段白名单，不能恢复任意绘图对象或外部资源。字号跟随原框而非屏幕比例放大，逐框裁切；不足处节选且保留完整文本供阅读。

原图保持不变，译文图层和全文同次提交到撤销历史，预览及 PNG 导出在目标倍率绘制；读取旧项目仍支持上一轮的文字标注 backgroundColor，但本轮图片翻译不再生成浮动标注。裁剪/缩放映射此原图坐标，原生 capture.adjust 替换底图时清空图层；再次 OCR/翻译只处理原图与显式 cover，不处理译文或阅读界面。阅读视图状态不写项目、不参与导出，也不触发服务请求。取消、身份/服务修订过期与上传授权边界保持。

## 2026-10-21 图片翻译可读排版

桥方法、来源限制与图像上传条件保持原样；本地 OCR 可用时，相邻同列且字号接近的正文行在网页内合并后调用既有 ai.translate，仍只发送文字。回填增加约 14px 的字号下限、空白扩展与可编辑长段落标注，底图和新增标注由同一次历史提交生效，取消或身份过期不提交。

项目 schemaVersion 仍为 2。文字标注可选 backgroundColor，只接受 #RRGGBB；读取和 Fabric 序列化均经字段白名单，不能恢复任意颜色表达式、图片、HTML 或 Fabric 对象。其它标注不接受该字段；旧项目未提供时保持无底色。文字标注的底色属于呈现，不作为隐私遮盖；显式 cover 仍由原 processingMasks 处理。

## 2026-10-21 关闭自动保存、统一完成

当前用户要求关闭自动保存。document.preserve 为兼容保留，但仅检查忙状态和内存身份，返回 {checkedState:true,saved:false}，不写恢复库。recovery.save 已停止发布能力，旧请求明确拒绝；历史记录的读取和显式删除保留。presentation.complete 仅接受图片已复制到剪贴板，核对当前 documentId/revision/captureId 与呈现代数后收起，不写快照、不创建继续编辑提示；前端收到当前完成确认后清空本次文档。复制失败、返回 copied:false、过期回复或未接受完成均保留当前编辑。更新安装前也只检查忙状态，不自动保存；手动 project.save 保留。以下旧版保存保护描述为历史协议，由本节覆盖。

## 2026-10-21 松手进入编辑与选区调整

区域框选有效松手立即返回同一 `CaptureEnvelope`，无用户确认阶段；编辑器同时展示动作轨与原样路径浮卡。`presentation.ready` 继续防止未完成布局的窗口闪现，不对应任何确认 UI。

新增 `capture.adjust {captureId:string,selection:PixelRect}`，返回 `CaptureEnvelope`。仅匹配当前已就绪捕获、仍持有原生冻结图且不处于重新框选时才接受；尺寸至少 2px、单边最多 16000px、总面积最多 4000 万像素，并严格限制在原冻结桌面内。与捕获/本地操作共用互斥门控，失败保持原选区；不重新枚举或捕获桌面，不发送整张冻结图。返回图片沿用前端 24 MiB 限制，`captureId` 不变。

编辑器拖动期间只预览几何，松手才请求裁剪。一次成功调整加入原文档撤销历史，保留样式、文字和标注；旧 crop/resize 按原有变换逻辑恢复源坐标后清除，旧 OCR 块映射清除，已有校对文字保留。几何与图片引用随本会话撤销/重做，不加入项目或恢复 schema。新图片、退出或收起使迟到响应失效。原位导入文件不允许从冻结桌面调整其内容。

## 2026-10-20 轻量编辑器与保存保护

项目 schema 保持 v2。`presentation.editor` 是 `presentation.workbench` 的兼容别名；返回的内部呈现值仍使用 `workbench / overlay / hidden`。用户界面共用轻量编辑器，无第二份文档。`screens` 可带宿主提供的物理 `workArea:PixelRect`；编辑器验证其位于显示器 bounds 内，只用于限制工具位置，不改变选区、图像坐标或导出尺寸。

| Method / event | Payload | 行为 |
|---|---|---|
| document.preserve | {} | 覆盖前保护当前文档，成功返回 `{saved:true}`，失败拒绝覆盖 |
| presentation.complete | {captureId?:string,documentId:string,revision:number,text:string} | text 仅接受“图片已复制到剪贴板”或“PNG 已保存”；文档身份、历史 revision、截图 ID 与呈现代数均匹配且快照成功，才收起并显示独立原生提示。返回 `{accepted,presentation?}` |
| app.terms | {} | 只读查看原生条款，不能接受条款或绕过启动门禁 |
| editor.action | {action,text?,error?} | 宿主事件；固定动作 `continue / open-image / open-project / paste / recovery / settings / notice`。`notice` 的 `error:false` 为可自动收起的普通提示，省略仍按错误保留。消费后复用已有处理器，不包含路径或秘密 |

宿主覆盖、收起、关闭和重载前读取本地 `window.screenshotPrepareLeave(reason)`，reason 固定为 `replace / close / complete`，返回 `{documentId,revision,document,empty,projectSaved}` 或 `{error}`；准备期间前端锁定编辑，宿主最终调用 `window.screenshotFinishLeave()` 解锁。documentId 与 revision 是当前内存身份；恢复库使用独立稳定 GUID 和递增写序列，避免与自动保存的同序号冲突。完整项目已在当前身份/revision 下保存时可跳过重复快照；PNG 和文字复制不会标记项目已保存。捕获替换允许取消旧 AI 任务；关闭/完成不接受正在编辑、加载或进行中的 AI。快照失败、过期或忙状态保留当前文档和呈现。

`presentation.dismiss / presentation.complete / document.preserve` 参与本地操作门控，避免与捕获/原生对话框交叠。托盘继续编辑递增呈现代数，迟到的无 captureId 文件完成请求也不能隐藏刚恢复的窗口。`presentation.changed` 的托盘原因使用 `user_editor`；历史 `user_workbench` 仍由前端兼容。

输出提示窗口不持有冻结截图；继续编辑只恢复现有 WebView 内存文档与历史。关闭应用失败时原生确认提供默认“否”的明确放弃路径。更新退出只有在独立更新快照成功且更新器 HandOff 成功后标记允许关闭，不在失败的准备阶段豁免保护。

The trusted editor is served only from `https://app.screenshot.local/`. No remote page may invoke native actions. All commands use `window.chrome.webview.postMessage`.

Request: `{ id: string, method: string, payload?: object }`.
Success: `{ id: string, ok: true, result: unknown }`.
Failure: `{ id: string, ok: false, error: { code: string, message: string } }`.
Unsolicited capture: `{ event: "image.loaded", payload: CaptureEnvelope }`.

`LoadedImage = { dataUrl: string, name: string, width: number, height: number }`.
`PixelRect = { x:number, y:number, width:number, height:number }` uses absolute physical desktop pixels; x/y may be negative.
`CaptureEnvelope = { image:LoadedImage, overlay:{ captureId:string, desktopBounds:PixelRect, selection:PixelRect, screens:{bounds:PixelRect,primary:boolean,workArea?:PixelRect}[] } }`.
The frozen full desktop remains native-only. Only the cropped image enters the editor document, project, export or AI payload. Ordinary image.open/paste results remain LoadedImage.
User cancellation returns null (or saved:false); it is not an exception.

| Method | Payload | Result |
|---|---|---|
| app.info | {} | { version, platform, capture:{backend,colorMode,supportsHdr}, capabilities: string[] } |
| image.open | {} | LoadedImage or null |
| image.paste | {} | LoadedImage or null |
| capture.screen | {} | CaptureEnvelope or null |
| capture.region | {} | CaptureEnvelope or null |
| presentation.ready | { captureId:string } | { presentation, accepted:boolean, captureId:string\|null }; only the matching pending capture may become visible |
| presentation.workbench | { captureId?:string } | same presentation result; a supplied obsolete ID cannot clear a newer capture |
| presentation.dismiss | { captureId?:string } | same presentation result; a supplied obsolete ID cannot hide a newer capture |
| image.save | { dataUrl, suggestedName } | { saved:boolean, path?:string } |
| image.copy | { dataUrl } | { copied:boolean } |
| text.copy | { text:string } | { copied:boolean }; explicit clipboard write, max100000 characters |
| project.open | {} | { name:string, document:object } or null |
| project.save | { document:object, suggestedName:string } | { saved:boolean, path?:string } |
| settings.read | {} | { providers: PublicProvider[], defaultProviderId?:string } |
| settings.configure | {} | same public settings; native dialog stores secrets |
| app.updateReady | {} | {ready:true}; trusted local React mount health acknowledgement, no installation or remote access |
| ai.ocr | { providerId, imageDataUrl } | { text:string } |
| ai.translate | { providerId, text, targetLanguage } | { text:string } |

`PublicProvider = { id, name, kind, model, baseUrl, hasApiKey }`.

The native settings dialog also contains portable update controls; it never accepts download URLs, install paths, tokens or install commands from the bridge. Before an explicit install/rollback, the host reads the local `window.screenshotPrepareUpdate()` snapshot via WebView2, rejects active edits/tasks, and persists a separate recovery snapshot. A failed save blocks shutdown. Settings itself is an allowed waiting operation. See `UPDATES.md` for the private-source limitation, integrity boundary, replacement journal and recovery flow.
Provider kinds are `openai-compatible` and `ollama`. No API key is returned to JavaScript or included in project documents. HTTP adapters execute only in the native process after explicit OCR/translate actions.

Project documents use `{ schemaVersion:2, image:LoadedImage|null, editor:object }`; v1 remains readable and is upgraded in memory. The editor validates its own version and value bounds before restoring. No executable code or network image URLs are accepted as project image sources.

The default native capture backend reports `backend:"wgc", colorMode:"sdr", supportsHdr:false`. GDI is an explicit compatibility option; failures never silently change backend. Local UI/capture operations share one gate; cloud AI and local OCR requests use a separate gate. Public metadata/settings reads and OCR cancellation remain available. A running inference request does not prevent saving/copying an existing document or importing another image; the editor rejects stale results after a document or revision change.

## P0 additions

Region selection hands off the frozen frame on valid pointer release. In-place editing exposes eight circular handles and direct dragging on empty space inside the selection; arrows move one physical pixel, Shift+arrows resize, Ctrl uses ten pixels. Escape cancels an active adjustment before editor dismissal; explicit reselect is available in the path card and More. Before handoff Escape/right-click cancels and M toggles the frozen-pixel magnifier. Desktop validation remains paused.

`capture.screen` and `capture.region` accept `{backend?:"wgc"|"gdi",target?:{kind:"desktop"|"monitor"|"window",handle?:string,area?:"window"|"client"},timeoutMs?:number}`. Native handles are nonzero decimal or `0x` strings, never JS numbers. Desktop is the default; monitor/window require an explicit valid handle. Timeout is 100–30000 ms (default 8000). Capture overlay metadata also reports the actual `backend`, `colorMode:"sdr"`, and `supportsHdr:false`. WGC uses BGRA8; HDR fidelity is not claimed. Availability is checked on capture without enumerating targets during app.info.

| Method | Payload | Result |
|---|---|---|
| capture.settings | {} | {backend:"wgc"\|"gdi"} |
| capture.configure | {backend:"wgc"\|"gdi"} | same; shared process default for toolbar, tray and hotkey, reset on app restart |
| ocr.status | {} | {available,modelVersion,message,missingFiles:string[]} |
| ocr.local | {imageDataUrl:string} | OcrDocument |
| ocr.cancel | {} | {cancelled:boolean}; inference request completes with cancelled error |
| recovery.save | {documentId:string,revision:number,document:ProjectDocument} | {saved,stale,documentId,revision,cleanupPending} |
| recovery.list | {} | {items:{documentId,revision,name,updatedAtUtc}[]} |
| recovery.load | {documentId:string} | {documentId,revision,document:ProjectDocument} |
| recovery.delete | {documentId:string} | {deleted:boolean,cleanupPending?:boolean} |

`OcrDocument = {modelVersion,imageWidth,imageHeight,blocks:{id,polygon:{x,y}[],text,confidence:number|null,order}[],text}`. Coordinates refer to the cropped/resized content PNG supplied to OCR. Solid cover privacy masks are applied before resizing; rotated covers conservatively redact their bounding rectangle plus a sampling margin. Other annotations, decoration and frozen desktop are excluded. Covers in reflow coordinates cannot be mapped safely and block OCR until the user returns to raw/beauty mode. Previously recognized text and editable project source images remain sensitive. Local OCR accepts only PNG, with a 20 MB / 32 million pixel limit and further bounded line/block limits. No network fallback or runtime model download occurs. available confirms fixed model hashes; native CPU runtime is loaded lazily at first explicit recognition.

Recovery has a dedicated serialized SQLite transaction queue and does not take the native dialog or inference lane. Storage revision is a nonnegative monotonic write sequence per document ID, independent of the editor's undo/history revision; retries allocate a newer write revision too. Equal/older saves cannot overwrite a newer snapshot. Assets are addressed by SHA256 and reconstructed only after validation. Load/delete accept IDs, never paths. Recovery stores original images and OCR text in the user's local profile; it is not an encrypted vault. List shows metadata only; restoring content requires an explicit selection. Capacity cleanup may evict the oldest snapshots. A cleanupPending result means the snapshot committed successfully but asset deletion will be retried later.

Capture success prepares a hidden native overlay. The editor maps geometry using viewport width/desktop width and viewport height/desktop height independently, commits its compact canvas, then acknowledges captureId with presentation.ready. Stale acknowledgements must not show a dismissed overlay or replace a newer capture. Workbench/dismiss clear the frozen backdrop and pending capture. Cancelling a new selection preserves the prior presentation/document. The frontend consumes Escape for IME/text editing or an open property panel before requesting dismissal; native Escape must not preempt this routing.

If no matching ready arrives within 15 seconds, the native layer releases that backdrop, restores the workbench and sends `{ event:"presentation.changed", payload:{ presentation:"workbench", reason:"overlay_timeout", timedOutCaptureId:string } }`. The editor must not recreate an overlay for that expired ID if its image decode completes later. Presentation replies include the current capture ID so an old rejection cannot clear a newer frontend overlay. The desktop-test pause does not verify the real transparency or hidden-window layout behavior of this protocol.

While overlay/selection is active, workbench/dismiss without a capture ID are rejected too. An omitted ID is valid only when already in workbench/hidden mode and not selecting. The tray recovery entry emits presentation.changed with reason:"user_workbench" and invalidatedCaptureId for any released frame; it provides access to the in-memory document even if global hotkey registration failed. These are presentation events, not new document loads.


## 0.3.0 task and storage additions

`ocr.local`, `ai.ocr`, `ai.translate` accept an optional bounded ASCII `taskId`; the editor always sends a fresh UUID. `ai.cancel {taskId}` cancels only that active identity, bypassing the inference gate. The older unscoped `ocr.cancel` is retained for v0.2 compatibility; the new editor uses scoped cancellation for OCR, translation and probes. A cancelled/obsolete result never joins a newer document/revision/configuration.

`ai.test {providerId,kind:"text"|"image",taskId}` performs an explicit noncached request with fixed synthetic input. Its text response proves only that this request returned text; it is not an accuracy/structure/general-capability claim. The UI warns that the provider may charge. Automatic validation uses mocked HTTP only.

`ai.usage {}` returns `{items:{atUtc,operation,cached,usage:{inputTokens:number|null,outputTokens:number|null}|null,errorCode:string|null}[]}`: last128 process-memory summaries, no user text/images/keys/URL. Missing provider usage remains unknown; no cost estimate. OCR/translation cache: max32 results, max200000 UTF16 characters, 15minute TTL, SHA256 identity over provider configuration/model/protected-key/operation/input; process-only, no persistent screenshot cache. Cache hits report no new token use. HTTP401/403,429,400/404/422 and5xx have distinct categories; no automatic paid retry or fallback occurs.

Long translations run sequentially in <=2000 Unicode-codepoint chunks and keep successful blocks in the editor task. Only failed blocks retry on explicit click; source document/revision/provider/target changes prevent reuse. No partial result overwrites current text. The overall20000-character output limit remains explicit.

`recovery.usage {}` returns `{documents,referencedAssetBytes,maxDocuments,maxAssetBytes}` for metadata and deduplicated currently referenced PNG bytes; SQLite/WAL and temporarily undeletable orphan files are separate. `recovery.deleteMany {documentIds:string[]}` accepts1–1000 validated IDs and deletes atomically, returning `{deleted:number,cleanupPending:boolean}`. The UI confirms selection and waits for active autosave before deleting; memory edits remain. A rollback preserves all selected records.

Schema2 gains optional `borderWidth/borderColor`, `lineSpacing/paragraphSpacing` and `translationSource` fields with bounded defaults. Translation source differs from the current text => stale; unknown legacy source remains unconfirmed. Presets contain only validated appearance fields, never document/AI content, and live in the local WebView store. Export waits for fonts and redraws text at target scale using shared layout and annotation construction.

## 0.4.0 capture and persisted translation

`capture.settings/configure` additionally expose optional `snapWindows:boolean` and `windowArea:"window"|"client"`; settings are shared for this process. Capture requests may override them. A region snap retains ordered visible-window physical geometry only, never titles or process names; the bounded snapshot is acquired only during an explicit region capture. W toggles snapping and C toggles full/client geometry, including an already snapped selection. Manual adjustment clears that association. No OS enumeration occurs in automated tests.

`capture.monitors {}` explicitly enumerates `{monitors:{handle:string,label:string,bounds:PixelRect,primary:boolean,current:boolean}[]}`. `current` is chosen by greatest overlap with active native selection or workbench bounds, with primary tie fallback. `capture.current {}` captures that WGC monitor. These methods are user-triggered; GDI keeps its existing desktop/region path. Monitor handles stay strings end to end.

`hotkey.read {}` and `hotkey.configure {enabled,ctrl,alt,shift,key}` return `{binding,registered,applied,message,cleanupPending}`. Enabled bindings need Ctrl or Alt; letters/digits/F1–F11 are accepted, Win/F12 combinations excluded. New binding registers on an alternate ID before atomic config save and old binding release. Conflict/save failure preserves prior binding. An unreleased ID cannot trigger a capture after replacement; cleanupPending requires attention/restart. Hotkey settings live under LocalApplicationData/Screenshot/capture-hotkey.json; unreadable files are warned about without automatic overwrite. Production alone calls Win32, tests use fakes.

In-place image drops retain the acknowledged captureId/backdrop, reuse shared image normalization/history/render/export, and remount without a second ready handshake. `contentScale` is frontend-only view metadata; it never changes document.resize or original export bytes. New captures/presentation invalidation take precedence over late file decoding. Editable JSON imports remain an explicit workbench action.

Public AI provider DTO gains `revision`, a SHA256 identity of native configuration (including protected-key identity), never raw credentials. `ai.ocr/ai.translate` may supply `providerRevision`; mismatch returns `provider_configuration_changed` before HTTP or cache lookup. Legacy omitted revisions remain supported; the new editor sends it and cannot resume persisted tasks without matching identity.

Schema2 adds optional `translationData:{schemaVersion:1,source,providerId,providerRevision,targetLanguage,chunks}`. Chunks retain stable id, sourceBlockId or null, exact source slice, generatedText, corrected text, status and bounded error. Sources concatenate exactly to source; all output and aggregate limits are validated, unknown fields discarded. Running state loads as pending. Completed chunks are reused only with identical source/ID/provider revision/target. OCR links exist only when whole text still equals source-block text. Full source edits suspend mapping and retries; new translations may reuse unchanged successful blocks. Each progress update joins shared undo/autosave history while validating the external request stamp. Explicit full translation deletion clears metadata. Saved project/SQLite contain sensitive source and text; they are not sanitized exports.

## 0.4.1 quality implementation

Bridge and project schemas remain unchanged. Recovery codec strips image.dataUrl while streaming bounded metadata, decodes Base64 without an entire-image substring, and restores its own generated ASCII Base64 without worst-case string escaping buffers. Duplicate top-level/image fields and oversized metadata are rejected; Unicode and unknown metadata remain roundtrippable. Existing schema1 recovery stores do not rewrite schema version on each read; actual load/GC still use write-reserved transactions. No new asset-ID IPC is claimed.

Portable diagnostics now consume native-dependencies.json and recheck external direct DLL requirements on the target host (including Visual C++ runtime); build-machine availability flags are not reused as target facts. Diagnostics do not load DLLs or install prerequisites.

Windows中断写入后观测到的SQLite IOERR_TRUNCATE（1546）仅对Load/List/Usage等幂等读取有限重开两次，额外等待共不超过75ms且可取消；写入、缺失资产、权限错误和损坏错误不自动重试，失败仍明确报告，不删除数据库/WAL/SHM。该异常的具体环境成因尚未确定；有旧版对照偶发通过/失败，不能宣称已证明某一底层原因。

## 0.4.2 native source profile

Bridge and project schemas are unchanged. CPU OCR uses the same fixed models and algorithms with a traceable minimal source-built OpenCvSharp native library. Production PNG decoding verifies the normal lazy loading path in tests; benchmarks select explicit native handles only inside an isolated Vendor-profile test executable. No desktop or provider inputs are added.

## 0.4.3 editor workflow

Bridge/project schemas remain unchanged. Workbench zoom/scroll is view-only; capture overlay keeps its physical mapping. Source/translation fields invisible in the current mode no longer rebuild the base image, while document history, autosave and export validation still use the current document. Empty OCR never clears prior corrected work.

## 0.4.4 editing refinement

No bridge or project schema change. Selection/property drafts remain view state; supported annotations retain their stable identity across style redraw and history synchronization. Compact tools, status and options share one bounded docking model without changing capture coordinates or export pixels.


## 0.4.6 native startup precondition

No editor/bridge exists before the native terms gate succeeds. Decline/close/write failure exits before main-host creation, WebView, global hotkey registration or native/provider services. Existing receipts match both terms version and the complete packaged legal digest. Every bridge dispatch and hotkey capture additionally requires this startup authorization. app.info reports the actual assembly version rather than a separate literal. There is no bridge command to accept terms; acceptance stays with the real native user, and is not included in projects or network calls.


## 0.4.7 私有更新登录边界

GitHub App device code、access/refresh token、账号授权请求与私有 Release 下载仅在原生宿主内处理。没有新增认证桥接方法、前端 token 字段或持久化；主窗口持有内存会话，设置关闭取消操作，退出登录/应用清除会话。只有现有 `window.screenshotPrepareUpdate()` 和 `app.updateReady` 参与更新前保存/更新后就绪；不把 GitHub 凭据加入项目、恢复库、日志或 React 状态。当前默认 Client ID 为空，明确未配置；真实 App 配置与实机授权另行完成。


后续公开Client ID配置仅写入原生程序集元数据，不新增认证桥接或凭据字段。登录及每次获取检查/下载lease前读取当前App安装元数据，限定Notesae/screenshot且Contents/Metadata只读；范围不符停止，不自动改GitHub权限。两次分别获准的真实授权试验均已结束但未建立可用会话，原进程的内存状态没有转移到应用或前端。诊断阶段仅为本机固定枚举，不增加服务端正文或秘密字段。


## 0.4.8 公开源免登录更新

用户自行公开仓库后，原生更新源改为固定官方公开GET；设备码、token会话和Client ID配置已删除。没有认证桥接或新增编辑器权限。公开源核对固定仓库ID与公开状态，401/403/404不转入登录；检查/下载、校验、快照保护及React就绪协议仍由原生宿主管理，安装交接继续要求用户明确确认。

后续交接修复不改变桥接字段：宿主内部 ICaptureHandoff 按捕获身份持有首次框选画面，只有当前 presentation.ready 接受且宿主已处理布局/绘制后释放；取消、超时、退出也释放。PNG 编码和 capture.adjust 裁剪在后台执行，提交前再次核对身份和取消。前端等当前图片真正绘制完成才发送 ready，收到接受结果后才播放工具入场；裁剪期间继续保留几何预览直到当前底图完成绘制。W/C 选择快捷操作已移除，自动吸附仍可通过设置控制。

## 两阶段可见绘制交接

连续截图修正：网页发起 capture.* 请求或收到新 CaptureEnvelope 时暂停旧呈现，按接收序号清理等待状态；取消后的迟到解码/回复不再替换文档，既有超时保留图片的行为不变。r5 已删除 screenshotSuspendCapture / screenshotResumeCapture 和整层 EditorSurface 透明度切换；宿主直接隐藏完整 HWND，托盘状态不再等待固定 180ms，可见状态仅等待本进程合成更新撤离。

ready 新增 hostFrameGate:true。此分支前端完成几何核对后仍不自行揭示选区；宿主处理 painted 时先订阅公开模板 PART_image 的 Source/Source.Changed，再调用 screenshotPresentCapture(captureId)。该回调只接受当前捕获并同步显示静态选区，工具仍隐藏。r5 不再接受任意一次源变化：显示回调完成后，在 Dispatcher.Background 校验现有图像的少量 alpha 样本，选区内部匹配本次冻结图，外部匹配共享遮罩 alpha；透明空帧、无遮罩及采样可识别的旧选区帧均拒绝。已有正确帧允许直接通过，无需等待新的 Changed。校验只读取已有图像，少量样本合成一行统一读回，不捕获屏幕、不保存/传输像素。WPF 渲染队列与 DwmFlush 完成后复核身份/DPI才撤挡；单次 2 秒超时保留遮挡，携 awaitingPaint:true 继续重试，不突变成无遮罩工作台。前端 12 秒及原生 15 秒的总就绪保护保留。DPI 重试不重复验同一已接受捕获。旧模拟桥不返回此标志时保留网页准备流程。

presentation.ready {captureId} 先登记准备阶段，在原生选区遮挡后显示宿主，返回 awaitingPaint:true 和 viewport:{width,height,scale}；此时 pending 身份和 15 秒就绪超时继续有效，不释放原生画面。viewport 来自 Win32 客户区及窗口 DPI，width/height 为 CSS 尺寸，scale 包含 WebView ZoomFactor。前端进入 is-preparing，直到实际视口、共享 React 布局快照与宿主目标匹配，且工具几何连续两帧一致，才调用 presentation.painted {captureId,viewport}。

宿主再次校验当前捕获身份、取消状态、Win32 客户区和 WPF 编辑器实际尺寸/DPI，在 Render 优先级继续后复核，成功才撤挡和激活；没有原生遮挡的屏幕捕获在此之前保持宿主透明。旧视口返回 accepted:false,awaitingPaint:true,viewport:最新目标，前端继续等待并重试，不提前显示工具或作废截图。设备比例容差小于 .001，物理宽高容许 2px 取整。前端等待最多 12 秒，原生 15 秒超时回退仍有效；取消、替换、退出使旧 painted 无效。它取代仅等待浏览器两帧与 WPF 两帧的实现，帧数本身不能证明 DPI 已收敛。

菜单和标注状态不跨原生桥。文档仍使用 v2 的 left/top/width/height/scale/angle 表示箭头，端点由局部中心及矩阵映射；没有保存 Fabric 任意 JSON 或新增项目 schema。

原生遮挡在宿主 Show 之前用 GWLP_HWNDPARENT 建立顶层 owned-window 关系，随后才显示和定位宿主，避免两个无所有权的 TopMost 窗口先后置顶时短暂交换层级；只对当前捕获有效。[Windows owned-window 层级规则](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features)。

## 2026-10-21 统一设置入口
settings.configure 增加可选 section（capture / services / updates），在同一原生设置浮卡中切换截图与快捷键、识别与翻译、应用更新；未知或缺省值进入截图页，返回仍为原 PublicSettings。网页不再呈现一层包含“服务设置与应用更新”的独立设置卡。文字工具齿轮指定 services，其余设置入口进入 capture。原生页复用 capture.settings/configure 与 hotkey.read/configure 的宿主处理，仅点击应用才更改配置/注册热键；打开设置只读现有配置，不枚举显示器或截图。原生服务保存与密钥边界不变。关闭后前端重新读取 capture.settings，避免截图方式缓存过期。显示器选择与截图动作在更多操作下保留；条款仍通过只读查看窗口提供。

## 2026-10-21 图片原位翻译
新增 ai.translateImage {providerId,providerRevision?,imageDataUrl,taskId?}，仅由轨道“翻译图片为中文”的显式动作调用，使用已有 AI 门控、任务取消、原生配置与图片验证。发送当前裁剪/缩放内容，沿用实色隐私遮盖，不发送冻结桌面、装饰或其他标注。要求用户所选服务支持图片输入。原生返回 {blocks:[{source,text,x,y,width,height}]}，坐标为所发图片宽高的千分比；仅接受最多 250 块、有限数值和图内正面积矩形，文字量有界。服务返回的代码、URL、HTML 不执行；格式不合规整体拒绝，无自动重试。前端二次检查并将矩形映射回源图裁剪范围，边缘主色覆盖原外语，中文按框内空间换行和缩放，完整结果作为一次文档历史事务替换图片，保持原图尺寸、裁剪、标注及选区关系。取消、文档/修订/代数/服务配置变化均拒绝迟到结果。原位译文烘焙到当前图片，项目 schema 不变；原图留在当前内存撤销历史内，不自动写盘。复杂背景/旋转文字不提供修复或精确还原保证。

## 2026-10-21 原生设置测试连接
统一设置的服务页新增“测试连接”，直接使用原生表单草稿发送一次固定文字请求，明确提示可能计费；不上传截图、不保存草稿、不使用缓存，也不新增可传密钥的网页桥。空密钥沿用当前服务已存的本机密钥，填写新密钥仅用于本次草稿测试，显式删除密钥草稿不再沿用旧值。成功仅表明这次文字请求返回，不宣称图片识别/图片翻译能力。测试可取消，关闭设置取消本次请求，修改连接信息清空旧测试状态。已保存密钥以状态和示意圆点展示，不解密回填 PasswordBox，不把占位内容作为密码提交。

## 2026-10-21 设置与截图翻译路径修正
托盘 settings 直接由原生浮卡打开，隐藏宿主不作为其 Owner，不激活工作台或作废旧截图身份；编辑器 settings.configure 复用同一窗口。关闭发送 editor.action {action:"settings-updated"}，前端仅重新读取 settings.read 与 capture.settings，不加载图片。截图翻译若本地 OCR 可用，先以 taskId 调用 ocr.local，再对外语块通过新 taskId 顺序调用 ai.translate（简体中文），重复文本在本次操作内复用结果；位置来自 OCR polygon，仍按所发内容尺寸映射回填。全部请求及回填沿用身份/修订/配置和取消保护，不自动重试。无本地 OCR 的视觉路线保留，已知 Hunyuan-MT/HY-MT 文字模型会提示准备本地 OCR，不发送图片。专用混元文字翻译改用官方单 user 模板；设置连接测试改为固定翻译示例，仍不上传截图或保存草稿。

## 2026-10-21 框选交接等待调整
presentation.ready / presentation.painted 字段与当前捕获、DPI、alpha 样本确认条件不变。等待现有 WebView 图像的样本核对改在 Dispatcher.Loaded（渲染后）队列执行，并仅在等待期间每 32ms 重查同一现有 Source，补足原地缓冲更新或通知合并未及时触发核对的情况。仅有验帧谓词才启用重查，超时/取消/结束均停止；时间本身不构成成功依据。确认后不再等 ContextIdle，改等 Render 队列，再执行现有 DwmFlush 与身份/几何复核。网页几何循环保留动画帧，但增加 32ms 定时后备，仅推进布局采样，仍由宿主真实帧检查放行。原总期限和拒绝旧帧规则保持。

## 2026-10-22 v2 动效与完成时序

桥接字段保持。App 在 image.copy 返回 copied:true 后复核 documentId/revision/generation/captureId，才请求本地表现控制器收束；约 360ms 后再复核身份，然后调用既有 presentation.complete。宿主仍执行 CheckEditorAsync 与呈现代数/捕获身份检查才隐藏。展示副本仅复制现有本地 canvas，不调用屏幕捕获，也不进入项目或导出。

等待时“取消完成”或 Esc 只取消收起意图，已交给系统的复制不能回滚。退出动画被打断、文档替换或宿主拒绝时恢复当前表面，不发送迟到隐藏。普通 presentation.dismiss 仍只改变呈现并保留文档。ready/painted/合成帧门控及原生物理像素坐标保持；工具入场只在当前 chromeVisible 后启动。
