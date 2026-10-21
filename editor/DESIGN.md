---

## 2026-10-21 面板重排与自由拖动

原样模式不再打开浮卡；属性面板只展示当前类型可编辑的字段并即时应用，移除重复绘制入口和应用按钮。更多操作按文件、项目、输出分组；所有网页下拉替换为应用内绘制菜单，含选中态、方向键/首尾键、输入查找、Escape/Tab 和外部关闭，弹出菜单不受卡片滚动区裁剪。面板改用轻量分组、统一字段和细滚动条。预设摆放只用于未手动定位的工具，开始拖动即固定现有两组位置，手动坐标不钳制、不参与避让，选区调整不清空位置；重置工具位置才回到默认。

## 2026-10-21 关闭自动保存、统一完成

当前完成流程：动作轨只保留带勾图标的“完成”，移除复制 PNG/保存 PNG 及路径卡内重复输出按钮。完成复制当前 PNG，宿主确认后收起并清空本次编辑，不提供继续编辑。移除自动保存 Hook 和状态提示，旧恢复记录仅在用户主动打开时可读/清理；手动项目保存保留。
name: Screenshot — Soft Clay Capsule v2
description: 深暖灰触感编辑工具，以蓝色标记主动作和选择。
colors:
  primary: "#3b82f6"
  focus: "#9cc4ff"
  ink: "#f5f5f7"
  muted: "#b7b5b3"
  well: "#181719"
  canvas: "#202022"
typography:
  headline:
    fontFamily: "\"Segoe UI Variable\",\"Segoe UI\",\"Microsoft YaHei UI\",\"Microsoft YaHei\",sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.6
  title:
    fontFamily: "\"Segoe UI Variable\",\"Segoe UI\",\"Microsoft YaHei UI\",\"Microsoft YaHei\",sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.5
  body:
    fontFamily: "\"Segoe UI Variable\",\"Segoe UI\",\"Microsoft YaHei UI\",\"Microsoft YaHei\",sans-serif"
    fontSize: "13px"
    lineHeight: 1.6
  label:
    fontFamily: "\"Segoe UI Variable\",\"Segoe UI\",\"Microsoft YaHei UI\",\"Microsoft YaHei\",sans-serif"
    fontSize: "12px"
    lineHeight: 1.65
rounded:
  control: "12px"
  field: "12px"
  floating: "12px"
  pill: "999px"
spacing:
  compact: "8px"
  standard: "12px"
  section: "16px"
  content: "20px"
components:
  button-primary:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-neutral:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  field:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "9px 12px"
  card:
    textColor: "{colors.ink}"
    rounded: "{rounded.floating}"
---

# Design System: Screenshot — Soft Clay Capsule v2

## Overview

**Creative North Star: "Soft Clay Capsule v2"**

深暖灰凸面动作轨与浮卡承接操作，深色凹面输入区承接校对。顶部高光、底部内阴影和投影塑造触感；截图内容保持视觉中心。

**Key Characteristics:**

- 深暖灰凸面操作、凹面输入。
- 同一蓝色色系表达动作和选择。
- Windows 中文系统字体。
- 小幅弹性反馈与减少动态效果支持。

## Colors

### Primary

动作蓝用于主按钮、选中路径和预设；焦点浅蓝用于键盘轮廓和输入光标。

### Neutral

正文浅白与辅助暖灰区分信息层级；输入深井用于校对区，画布暗灰承载普通文件。错误、未保存和过期状态沿用暖色语义提示。

**The One Blue Rule.** 主动作和选中态共享蓝色色系，警示色只表达相应状态。

## Typography

统一使用 frontmatter 中的系统字体栈，不下载字体。入口标题、浮卡标题、操作正文、字段说明分别使用 headline、title、body、label；滑杆读数用等宽数字。

## Layout

截图按宿主物理元数据定位，普通文件使用中性可缩放滚动画布。动作轨、浮卡、状态属于视图层，不写入项目。动作轨最大宽度（800px），文字/美化/其他浮卡目标宽度分别为（420/360/320px），受工作区约束；空间不足时浮卡可滚动。

把手和浮卡标题可拖动，也可聚焦后用方向键微调，更多中可重置。窄窗口（680px）减少工具内边距并允许换行；适配窗口不能改变导出像素。

## Elevation & Depth

渐变、顶部内高光、底部内阴影和分层投影形成凸面；文字井、路径槽、滑杆轨道使用内阴影形成凹面。完整渐变和阴影记录在 sidecar，运行实现以 src/soft-clay.css 为准。

**The Tactile Hierarchy Rule.** 操作表面凸起，输入和容纳区域下沉。

## Shapes

动作轨/浮卡使用共享 12px 圆角，按钮/字段使用紧圆角，预设为完整胶囊。浮层靠材质与投影分离，保留焦点和源框的必要轮廓。

## Components

普通按钮用暖灰凸面，主动作与选择用蓝色渐变。悬停提高亮度，按压缩小至（.92）；浅蓝 focus-visible 轮廓始终可见，禁用态移除凸起感。常规按钮最小高度（40px），动作轨按钮使用 36px 紧凑适配，更多列表为（44px）。

原样/美化/文字共用路径槽和文档，打开文字浮卡不自动识别或生成卡片。美化预设用胶囊按钮，当前外观匹配时显示选中态。浮卡标题与滚动内容分离；识别设置、翻译、校对、排版与样式管理采用原生折叠区。

字段用深色凹面和浅色文字。浮卡入场只改变 opacity/transform（320ms），退出 220ms；按钮按下 120ms、释放回弹 280ms；网页和 WPF Toast 均使用 280ms 入场、180ms 退出。prefers-reduced-motion 关闭动画与过渡，保留全部功能。

## Do's and Don'ts

### Do:

- Do 延续暖灰渐变、内高光和投影的触感层级。
- Do 保留中文标签、可见焦点、独立滚动和减少动态效果支持。
- Do 将低频选项收进更多或相关折叠区。

### Don't:

- Don't 为三条路径另起文档或视觉外壳。
- Don't 用新的强调色装饰普通动作。
- Don't 将工具位置或显示缩放写入导出像素。
- Don't 将合成预览固化为真实 Windows、DPI 或 IME 验收。

## 2026-10-21 框选修复与共享来源

运行 token 的唯一来源是 `../design/soft-clay.tokens.json`：颜色、核心阴影、高光、圆角、尺寸、字体、时长与 cubic-bezier 控制点由 React 挂载前写入 CSS，WPF 嵌入同一 JSON。额外材质层仍由平台绘制。Figma 参考 1:2 / 3:33 / 3:7 / 4:7 / 7:7 / 7:76；最新修复要求中的 12px 浮层圆角、约 40px 控件高度优先于原 Figma 大尺寸展示组件。图标继续复用已有五个本地 Figma SVG，不引入运行期外链。

首次框选松手后立即交接，原样路径浮卡和动作轨自动出现。编辑态使用八个圆形手柄，在框内空白处按住拖动整体移动；命中标注时交还画布。拖动期间从冻结背景预览，松手才请求原生后台重裁剪；保持落点和工具位置，直到当前图片按正确比例完成绘制再交回画布。方向键 1 物理像素、Ctrl 10 像素、Shift 调尺寸；Esc 优先撤销手势，然后沿文字编辑、标注选择、浮卡、整次截图逐层退出。空白点击不重新框选，重新框选位于原样浮卡与更多。

遮罩约 50%，选区原图不加遮罩，1.25px 蓝边、软光、圆形手柄、胶囊尺寸标签均为视图，不参与导出。尺寸标签靠近顶边时移入选区，避免裁掉读数。原生提示可聚焦，Enter/空格或 Ctrl+Enter 继续编辑，聚焦和悬停暂停 2.4 秒倒计时。系统关闭客户区动画时 WPF 直接应用最终状态，网页遵守 prefers-reduced-motion。

无头 DPR 1 / 1.5 和合成截图只验证网页映射；Windows 100% / 150%、实际焦点、热键、托盘菜单及 WPF 对照截图均待后续实机授权，不能写成已经还原验收。

后续反馈修复：动作轨、浮卡、状态条在 presentation.ready 被宿主接受之后才播放入场，浮卡延后 40ms、状态延后 80ms；隐藏等待阶段 animation:none，避免动画提前播完后整组突现。启动仅在屏外预热，异常使用独立小提示，不展示常规主窗口作为 loading。W/C 提示及快捷操作已删除。

后续交互：工具按钮 aria-pressed 表示绘制待命，不立即插入图形；十字指针在实际画布落笔，矩形/高亮/遮盖拖拽确定范围，箭头按下为尾、松手为头。箭头选中只呈现两个圆形端点，框类为边角控制，无旋转柄。文字点击后进入编辑。关闭浮卡的尺寸、位置基于仍显示的面板直至退出完成；ready/painted 两阶段交接下，原生撤挡前完成浏览器静态画面，工具之后入场。托盘菜单使用 WPF 同色浮卡、16px 线性图标和36px行高，命令按用途分组。

交接抽动的后续修正：宿主与网页的客户区/DPI 匹配后才揭示编辑层，resize 同步更新选区、画布及工具。遮罩使用视口内 SVG evenodd 路径，取消百倍视口的扩散阴影；选区柔光保留。捕获初始动作轨/原样卡片只淡入 120ms，不移动或缩放；打开其他属性卡和关闭交互沿用既有语言，reduced-motion 仍关闭动画。原生尺寸胶囊不因松手改变文案宽度。

连续截图时，在新图解码前同步暂停旧边框/遮罩/工具；失败或取消保留旧文档，新图完成后才整体切换。支持宿主帧门时，静态选区只由当前捕获的宿主回调揭示，原生合成图像更新确认前工具保持隐藏；不把“网页已布局”当作“Windows 已显示新图”。

r5 删除原生整层透明度切换。宿主以选区和遮罩的 alpha 采样过滤空帧，单次验帧超时保留当前遮挡重试，不自动突变无遮罩工作台。截图入口删除固定 180ms 等待；界面不新增性能技术提示，耗时仅记在本机诊断文件，实际 Windows 流畅度仍未验收。

## 2026-10-21 原生设置浮卡
服务配置与更新继续由原生 WPF 承担安全边界，外观跟随编辑器属性卡：共享暖灰渐变表面、12px 外圆角、15px 标题、12px 标签和说明、40px 凹面字段、中性导航、蓝色保存操作、无箭头细滚动条。命名 ClayPanel 控件资源只由该设置浮卡引用，标题可直接拖动，保存固定在内容滚动区之外。外观仍待用户实机反馈，未恢复桌面测试。
