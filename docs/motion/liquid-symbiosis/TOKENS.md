# Token 系统与消费契约

## 1. 文件关系

`tokens.json` 为设计包的唯一参数源。`build.py` 从它读取数据并内联到单文件演示；修改原型参数后必须重新构建，不能手改生成 HTML。开发模式同源读取同一JSON，不使用CDN。

生产的 `design/soft-clay.tokens.json` **未被修改**。本文件复制了需要审阅的现有视觉基准，并新增候选运动参数；正式接入时应该引用/扩展原唯一源，而不是让两份主题长期竞争。

Schema 为本项目自定义嵌套JSON，不宣称符合 DTCG `$type/$value` 格式，也不宣称可以无转换导入 Figma Variables。

## 2. 分层命名

| 层 | 路径 | 角色 |
|---|---|---|
| 视觉基础 | `color / radius / size / type / space` | 保持现有材质、逻辑尺寸与字体层级 |
| 控件状态 | `state / scroll` | 禁用透明度、滚动条及空闲隐藏 |
| 运动基础 | `motion.duration / easing / spring / solver` | 时长、曲线、动力学与休眠 |
| 交互语义 | `motion.proximity / bridge / press / intensity` | 感知、传导、液桥、按压与不同场景的强度 |
| 降级约束 | `motion.reduced / quality / policy` | 硬性行为边界，不只是可调审美参数 |
| 验收目标 | `motion.budget` | 候选性能门槛，不能当作实测值 |
| 空间 | `layout` | 避让、安全边距与阅读窗 |
| 纯演示 | `demo` | 模拟任务时长/无网络无剪贴板；禁止带入生产 |

单位：CSS px 与 WPF DIP 都是逻辑单位；图片导出使用独立物理像素。时长为ms，求解器dt为秒。弹簧mass固定1，k/c只在相同方程与积分器下可比较。

## 3. 核心参数

| 参数 | 候选值 | 用意 |
|---|---:|---|
| proximity.radius | 108 | 接近时就感知，不需要进入按钮才响应 |
| proximity.localX/localY | 2.4 / 3.2 | 小幅迎向，垂直触感略强 |
| proximity.maxTotalShift | 4 | 防止高强度调校把表面推离命中位置 |
| proximity.neighbor1/2 | 0.22 / 0.07 | 近邻递减，远处安静 |
| proximity.bodyShift/bodyBulge | 0.7 / 2 | 承托而非全轨漂移 |
| bridge.maxLinks/maxGap | 1 / 14 | 防止全体黏连与跨组视觉误导 |
| bridge.neck/opacity | 4 / 0.40 | 连接可辨但不遮盖标签 |
| bridge.maxPanelSpan | 48 | 远距离面板不画长液丝 |
| duration.bridge | 160 | 短暂关系，不是常驻装饰 |
| press.scaleX/scaleY | 1.045 / 0.90 | 表面受力，不缩小命中区域 |
| duration.panelEnter/Exit | 260 / 180 | 入场有触感，退出利落 |
| duration.selectionTransfer | 210 | 明确选择的连续迁移 |
| duration.exit | 300 | 仅在成功确认后播放的尾部 |
| duration.reducedFade | 100 | reduced不超过120ms |
| solver.sleepFrames | 8 | 停稳后关闭帧调度 |

调校面板的强度0–140%、半径60–150只修改本次原型会话，不保存应用配置，不覆盖JSON。降低强度不会更改业务时序；0强度不等同系统Reduced，Reduced另有严格禁用规则。

## 4. 原型实际消费与边界

| 路径 | 原型消费者 | 说明 |
|---|---|---|
| color | CSS变量注入 | 外观常用色引用；合成图片有独立内容色 |
| radius.control | CSS变量 `--r` | 主要表单及普通控件；原型局部装饰仍有常量 |
| motion.spring.attention/neighbor/body/press | `frame / springValue` | 实际连续计算，不是只写文档 |
| motion.solver.* | `frame / springValue / wake` | 帧步长、收敛阈值和休眠 |
| motion.proximity.* | `frame` | 临近、相邻、位移与底座；硬限位单独裁切 |
| motion.bridge.* | `frame / panelAnimate` | 次数、距离、连接强度、颈部和条件 |
| motion.duration.* | `panelAnimate / closePanel / runTask / finishSuccess / tooltip / toast` | 核心表面与反馈时长 |
| motion.quality / reduced / policy | 控制器规则 | JSON记录约束，代码通过分支实现；不能作为松散可关闭开关 |
| layout.* | 面板和阅读窗口 | 部分尺寸注入，安全约束始终存在 |
| demo.* | `runTask` | 合成时序与数据说明，禁止导入生产 |
| size / type / space / scroll / state | 样式基线及接入规范 | CSS按基准实现；并非所有值都实时由JSON注入 |
| spring.indicator / spring.panel | 生产适配候选 | 原型用有限时长过渡近似；未使用这两个弹簧求解 |
| motion.intensity / easing / budget | 设计/接入/验收契约 | 原型场景使用简化层级，非全量自动配方运行时 |

这里明确区分“有参数定义”和“已经消费”。生产代码需要生成类型化适配器，消除剩余样式常量；不能仅因为JSON包含某字段就宣称两端已统一。

## 5. 生产适配建议

### React

扩展现有 `softClayTokens.ts`，加载经过schema校验的只读token对象。`MotionCoordinator`只管理视图，`useLiquidGroup`接收稳定rect与语义状态；通过 `requestAnimationFrame`集中写transform。React state管理选中/任务/文档，不每帧setState。

使用独立 `<button>` HitTarget 和内部 `<span aria-hidden>` 表面。SVG装饰 `pointer-events:none`。`ResizeObserver`与滚动/DPI变化标记rect缓存失效。清理所有事件和RAF；不创建轮询组件。

### WPF / WinForms框选

现有SoftClayTheme作为唯一注入入口。逻辑尺寸通过DIP/DPI映射，不把CSS物理像素直接复制成桌面坐标。WPF通过RenderTransform和可冻结Drawing层更新外观；WinForms框选保持真实边界，装饰另层绘制。`SystemParameters.ClientAreaAnimation`关闭时使用Reduced。

不同平台可以采用不同绘制方法，但同一语义的方向、幅度上限、因果和业务门槛保持一致。阴影像素级完全一致不是动效正确性的替代指标。

## 6. 变更流程

视觉基准变化与运动参数变化分开评审。优先调整感知半径、邻近衰减、形变上限、阻尼，最后才考虑增加特效。每次只改一组有因果关系的参数，并复查快速反向、连续点击、危险操作邻近、窄屏、Reduced与空闲休眠。

参数版本变更记录来源与影响。不得用增大总预算来掩盖某次验证失败；记录失效场景及未完成项。系统性能、图像尺寸和真实服务耗时不是动画token能解决的问题。
