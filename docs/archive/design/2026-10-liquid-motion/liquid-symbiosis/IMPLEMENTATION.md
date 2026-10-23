# 生产接入与 Codex 交接

## 0. 本次边界

本包只交付设计、规范、参数、独立Demo与隔离验证。它不修改Screenshot生产代码，不授权合并、不发布版本、不自动执行真实桌面测试。原型与生产架构不同是为了便于直接审阅，不意味着生产栈改成纯JavaScript。

生产实施开始前再次核对main与本包记录的基线。应用若已变化，先更新COVERAGE.md，再决定接入点；不要为迎合Demo而删除现有入口。

## 1. 应当分离的模块

| 模块 | 职责 | 不负责 |
|---|---|---|
| MotionTokens | 只读语义参数、系统降级及类型化适配 | 文档/项目/密钥 |
| MotionCoordinator | 单组帧调度、几何缓存、休眠、中断令牌 | 真实业务成功判断 |
| LiquidGroup | 临近、邻近传导、底座形变、短液桥 | 改变命中位置或鼠标 |
| LiquidButtonSurface | 表面与图标独立绘制 | 新建工具/改变点击语义 |
| SurfaceTransition | 浮卡方向、尺寸、开关重定向 | 安全窗口/权限边界 |
| TaskFeedback | 订阅任务状态、取消/错误/重试呈现 | 发起未经请求的OCR/网络 |
| CompletionPresentation | 成功确认后的短尾部和原生隐藏交接 | 把动画结束视为复制成功 |
| ReducedMotionPolicy | 系统OR应用减少动态，运行中即时生效 | 隐藏真实错误或取消能力 |

建议组件API（概念，不是已存在接口）：

```ts
type MotionTier = 'hero' | 'editing' | 'system' | 'reading';
type OperationStamp = {
  documentId: string; revision: number; captureId?: string; runId: number;
};
type LiquidGroupOptions = {
  tier: MotionTier;
  disabled: boolean;
  layoutRects: ReadonlyMap<string, DOMRectReadOnly>;
  activeToolId: string | null;
  excludedIds: ReadonlySet<string>;
};
// returns a view-only controller; destroy() cancels all owned effects.
// Business click handlers continue to live in the existing components.
```

## 2. 接入当前界面

优先对 `CompactOverlay` 的工具轨增加独立表面层，不重写文档模型或EditorCanvas。现有选择、标注、undo/redo、panel、reader、busy及hostLocked仍是状态源。

`CaptureSelection`保持真实框选手势与几何；在装饰层添加低幅响应，不transform整个捕获内容。`EditorCanvas`继续控制草稿、有效手势、真实绘制与导出；不要给Fabric对象套液态位移。

`StyleTools / TextTools / ImageTranslationReader / RecoveryPanel`分别采用低强度容器与状态反馈。原生设置、条款、托盘和确认通过 `SoftClayControls / SoftClaySurface / SoftClayTheme` 复用材质，不将密码或原生权限交给WebView。

## 3. 完成流程必须先改协议设计，再加动画

现有 `presentation.complete` 的原生实现会核对身份后直接隐藏窗口。因此不能只在React先播放300ms动画，也不能在窗口隐藏后尝试播放退出。

建议实施前明确一个受控的两阶段契约（以下名称仅提议，不是当前API）：

1. 导出当前不可变输出快照，携带documentId/revision/captureId。
2. 原生复制成功并记录该输出身份；失败返回当前可编辑状态。
3. `completion.authorize` 校验当前窗口/文档并锁定本次关闭许可，不立即隐藏。
4. 网页按许可播放短退出；新捕获、用户取消、宿主变化会作废许可。
5. `completion.commit` 再次校验许可与身份后隐藏；必要时提供超时安全路径。
6. 仅在当前身份关闭被接受后清空对应编辑文档；过期回调不清理新内容。

超时策略必须由真实宿主决定：若复制已成功而动画失联，应有可恢复、可记录的出口，不能无限占住屏幕。不要给网页任意隐藏其他窗口的权限。所有新增消息仍遵守现有桥接白名单、可信来源与数据大小限制。

## 4. 状态与故障矩阵

必须验证：双击完成；完成期间新捕获；复制失败；复制成功但身份失效；关闭许可过期；退出中用户取消；PNG导出失败；原生隐藏失败；窗口DPI变化；任务取消后的迟到回调；旧文档翻译回填；正在输入时Esc；原生模态上方按Esc；pointercancel/lostcapture。

所有案例记录最终文档、工具、面板、捕获身份与可操作性。动画观感不是覆盖错误状态的理由。

## 5. 分阶段，不把全部特效一次接入

### 阶段A：基础与不变量

引入token解析、系统降级、集中调度和稳定HitTarget，先验证交互不变：工具仍能立即选择，所有入口仍存在，导出不含UI，减少动态关闭已运行装饰，停稳休眠。

### 阶段B：主工具轨

加入局部感知、同组传导、底座承托、一次短液桥和明确激活迁移。只接工具轨，不动截图边界。验证完成/收起/危险操作排除、窄屏滚动与动态按钮。

### 阶段C：主流程与浮卡

完成真实交接事件驱动，选区→编辑、属性卡开关、面板切换、正确成功退出、分层取消。先满足安全协议，再美化尾部。

### 阶段D：其余应用

按COVERAGE.md依次接美化、OCR、图片翻译、阅读、历史、设置、托盘、条款与更新。每个条目更新“设计/实现/验证”状态，不因复用了按钮样式就宣称功能全覆盖。

### 阶段E：授权后的Windows验收

仅在用户明确恢复真实桌面交互后，检查100%/150%/混合DPI、不同刷新率、多屏、中文IME、透明合成、真实剪贴板占用、托盘定位与WPF焦点。录测应包含输入响应、宿主等待、可点、装饰停稳、失败恢复，而非只截漂亮关键帧。

## 6. 验证要求

复用现有生产测试，不删除或放松旧门槛。本包的Chromium QA仅验证独立原型，不替代原生产测试或远程CI。新增局部回归应覆盖不变量，而不是为每个像素建立昂贵截图快照。

生产验收中对60/120/144Hz使用时间戳测量，不假设每帧16.67ms。低性能设备的降级必须关闭高成本效果而不是改变业务。长时间静止要确认帧回调停止，重复开关100次不能累积监听或SVG。

## 7. 可直接交给 Codex 的执行说明

> 只在用户授权生产实现后执行下面说明。当前设计PR不表示已有此授权。
>
> 阅读本包README、DESIGN、MOTION-SPEC、COVERAGE、TOKENS、VALIDATION和当前仓库AGENTS/SCOPE/BRIDGE。基于最新main新建实现分支，保留此设计分支作为依据；不要直接修改或替换原G设计。
>
> 技术栈保持.NET/WPF/WebView2/React/TypeScript。先将覆盖矩阵对齐当前main，再按A→E实现。先稳定命中、业务时序和减少动态，再液态外观；不要把纯演示任务、演示项目格式、固定画布或合成翻译结果带进正式代码。
>
> 主轨有整体传导，按钮独立迎向并形变；B方案只在明确交互时短暂液桥。禁止全屏goo、常驻扫光、原图视差、真实边界弹性、hover自动选择及等待动画完成才执行动作。
>
> 完成必须在复制和身份确认后才退出；Esc分层；旧任务不得隐藏新截图；不恢复自动保存。原生权限和密钥仍由宿主持有。所有状态与未测项据实记录。
>
> 每一阶段仅提交审阅用draft PR；不自动合并、不发布、不控制用户桌面，不把浏览器合成结果写成Windows实测。
