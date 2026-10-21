---
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

首次框选松手后立即交接，原样路径浮卡和动作轨自动出现。编辑态使用八个圆形手柄和顶部移动把手；拖动期间从冻结背景预览，松手才请求原生重裁剪，工具重新避让。方向键 1 物理像素、Ctrl 10 像素、Shift 调尺寸；Esc 优先撤销手势，然后沿文字编辑、标注选择、浮卡、整次截图逐层退出。空白点击不重新框选，重新框选位于原样浮卡与更多。

遮罩约 50%，选区原图不加遮罩，1.25px 蓝边、软光、圆形手柄、胶囊尺寸标签均为视图，不参与导出。尺寸标签靠近顶边时移入选区，避免裁掉读数。原生提示可聚焦，Enter/空格或 Ctrl+Enter 继续编辑，聚焦和悬停暂停 2.4 秒倒计时。系统关闭客户区动画时 WPF 直接应用最终状态，网页遵守 prefers-reduced-motion。

无头 DPR 1 / 1.5 和合成截图只验证网页映射；Windows 100% / 150%、实际焦点、热键、托盘菜单及 WPF 对照截图均待后续实机授权，不能写成已经还原验收。
