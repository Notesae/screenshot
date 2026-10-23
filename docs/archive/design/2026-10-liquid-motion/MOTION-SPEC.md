# Soft Clay 截图工具 · 动效规范（G 融合）

> 来源：`v3/index.html`（模式 G）。文中数值全部取自 demo 实际代码；token 定义见 `motion-tokens.json`。
> 记法：spring 以 `k/c`（stiffness/damping，mass=1）表示；`EO`=easeOutCubic `cubic-bezier(.33,1,.68,1)`，`EIO`=easeInOutCubic `cubic-bezier(.65,0,.35,1)`，`EI`=easeInCubic `cubic-bezier(.32,0,.67,0)`。
> Spring 求解：半隐式欧拉，每帧 4 子步；|x−to|<0.5% 行程且 |v|<5% 行程/s 视为停稳。

## 1. 概述

快捷键唤起 → 遮罩进入 → 拖框 → 松手出现 ActionRail + 属性卡 → 选工具绘制 → 完成（已复制）或 Esc 取消。视觉为 Soft Clay：暖泥渐变、双外阴影 + 内顶高光/底暗、强调色 `#3B82F6`。

### 分层原则

| 层 | 来源 | 负责 | 不做 |
|---|---|---|---|
| 主体 Body | D 黏土塑形 | 选区厚泥边框、泥珠手柄、按钮挤出、卡片挤出变形、按压压扁、泥丸收起、塌落取消 | — |
| 背景 Background | E 光与层 | 跟随光标的暗角、视差、边框光束、数字滚轮、松手光脉冲、轨面扫光、指针悬停光、景深模糊/退场、待机呼吸光 | 卡片 3D 倾斜、工具条从模糊升起（已移除） |
| 细节 Detail | F 液态磁吸（克制使用） | 液态激活指示、按钮↔卡片短暂液桥、尺寸胶囊弹簧拖尾、提示滴落 | 整条 metaball 轨道生成、合并成勾号 |

### 关键路径预算

| 指标 | 预算 | 实测（headless，最近两轮） | 减少动态 |
|---|---|---|---|
| 松手 → 首个按钮可点 | ≤220 ms | 133 / 171 ms | 64 ms（勾选模拟）/ 80 ms（系统媒体查询） |
| 松手 → 全部停稳 | ≤600 ms（目标 ≤560） | 主轮 482 / 550 ms；Esc 轮 518 / 497 ms | 142 / 164 ms |
| 完成 → 窗口消失 | ≤420 ms（目标 ≤380） | 369 / 361 ms | 145 / 127 ms |
| Esc → 消失 | ≤420 ms | 363 / 376 ms | 145 / 131 ms |

表中为加入悬停光和轨面扫光后最近两轮的数据。“全部停稳”含装饰层：光脉冲 400ms、暗角脉冲 380ms、轨面扫光到 460ms。
调参期间各轮实测：停稳 482–574 ms，其中扫光调短前有两轮为 564 / 574，超过 560 目标；完成→消失 336–403 ms，有两轮为 384 / 403，超过 380 目标，但都在 420 预算内。

## 2. Motion tokens

### 2.1 Spring

| Token | k | c | 初速 | 用途 |
|---|---|---|---|---|
| motion.spring.clayPop | 700 | 40 | 0 | 按钮从角落挤出 |
| motion.spring.rimPress | 700 | 40 | 0 | 边框按压 .97→1 |
| motion.spring.beadSettle | 600 | 38 | 0 | 松手手柄 1.6→1 |
| motion.spring.beadPop | 520 | 18 | 0 | 拖框开始手柄出现 0→1 |
| motion.spring.railBody | 420 | 28 | 0 | 轨道底板挤出 |
| motion.spring.pressRebound | 600 | 14 | 0 | 按下回弹 |
| motion.spring.hover | 520 | 16 | 0 | 按钮悬停 1→1.08 |
| motion.spring.handleHover | 520 | 14 | — | 手柄悬停膨胀 1→1.7（逐帧跟随） |
| motion.spring.cardMorph | 400 | 22 | 0 | 卡片/抽屉挤出 |
| motion.spring.cardClose | 600 | 34 | 0 | 卡片/抽屉收回 |
| motion.spring.buttonRecoil | 500 | 14 | −6 | 卡片挤出时按钮反冲 |
| motion.spring.iconWobble | 400 | 10 | 0 | 选中图标 −28°→0 |
| motion.spring.badgePop | 500 | 14 | 0 | 光标工具角标 0→1 |
| motion.spring.tipDab | 520 | 12 | 0 | 落笔泥点 |
| motion.spring.pellet | 620 | 40 | 0 | 选区压成泥丸 |
| motion.spring.doneSwell | 520 | 22 | 8 | 完成键膨胀 1→1.3 |
| motion.spring.railFollow | 360 | 20 | — | 轨道/卡片跟随选区（逐帧） |
| motion.spring.rimStretch | 300 | 16 | — | 边框速度拉伸（逐帧） |
| motion.spring.liquidLead / liquidTrail | 520 / 150 | 28 / 17 | 0 | 液态指示主滴 / 尾滴 |
| motion.spring.liquidAppear | 420 | 12 | 0 | 指示首次出现 |
| motion.spring.bridgeIn / bridgeSnap | 600 / 520 | 30 / 16 | 0 | 液桥出现 / 断开 |
| motion.spring.capsuleLag | 170 | 16 | — | 尺寸胶囊跟随光标（逐帧） |
| motion.spring.toastDrop / toastSpread | 300 / 400 | 16 / 18 | 0 | 提示滴落 / 展开 |
| motion.spring.parallax | 90 | 19 | — | 背景视差（逐帧） |
| motion.spring.vignette | 140 | 22 | — | 暗角中心（逐帧） |
| motion.spring.hoverLightPos | 300 | 30 | — | 悬停光位置跟随指针（逐帧） |
| motion.spring.hoverLightFade | 200 | 28 | — | 悬停光强度 0↔1（进入/离开，逐帧） |

### 2.2 时长 / 曲线 / 间隔

| Token | 值 | 曲线 |
|---|---|---|
| motion.duration.reducedFade | 120 ms | EO |
| motion.duration.maskIn / vignetteIn / deskRecedeIn / rippleIn | 320 / 520 / 420 / 500 ms | EO |
| motion.duration.pulse / vignettePulse | 400 / 380 ms | EO / sin 半周期 |
| motion.duration.innerShadow | 340 ms | 0→12px（前 35%）→5px |
| motion.duration.pressDown | 60 ms | EO |
| motion.duration.penStroke | 480 ms | EIO |
| motion.duration.doneMask / doneDesk / doneFlash | 230 / 280 / 240 ms | EO / EO / 线性 |
| motion.duration.doneSlide / doneRailBody | 210 / 240 ms | EIO |
| motion.duration.escSel / escCrumb / escBead | 290 / 270 / 280 ms | EI / 线性 / 线性 |
| motion.duration.odometer | 260 ms | cubic-bezier(.2,.8,.2,1)（CSS transition） |
| motion.loop.borderSweep | 2600 ms | linear infinite |
| motion.loop.railAmbient | 4000 ms | ease-in-out infinite，opacity .15↔.7 |
| motion.duration.railSweep | 240 ms，延迟 220 ms | 线性；translateX −200→520px |
| motion.loop.idleSweep | 8000 ms，首次延迟 1200 ms | ease-in-out；前 18% 扫过（opacity .35），其余时间淡出并静止 |
| motion.stagger.railPop | 18 ms（自右向左，完成键最先） | — |
| motion.stagger.handleSettle / handlePop | 8 / 25 ms | — |
| motion.stagger.doneSlide | 12 ms | — |

### 2.3 数值

| Token | 值 |
|---|---|
| motion.value.rim | 宽 7px；按压 scale .97→1；速度拉伸 max 8%（速度/9000），垂直方向收缩一半 |
| motion.value.handle | 直径 16px；悬停 ×1.7（光标 16px 内）；松手 1.6→1 |
| motion.value.railPop | 起点 dx=轨道右端−14−按钮中心，dy=−38px；挤压 |v|×.035（max .4），scaleY 系数 .7；图标 −40°→0；opacity=p×3；p≥.85 可点 |
| motion.value.railBody | scale(p, .75+.25p − clamp(v×.01, ±.08))，原点 92% 50% |
| motion.value.railFollow | 跟随时挤压 max 12%（速度/3500），skewX max ±8° |
| motion.value.press | scaleX 1.06 / scaleY .86，阴影塌陷（.flat） |
| motion.value.card | 180×114（抽屉 180×158），r20；起点=按钮 {x65,y−60,w50,h44,r22}；内容 p>.6 渐显；挤压 v×.006 / v×.008 |
| motion.value.indicator | 40px 圆；拉伸 X 1+|v|/3000（max .35），Y 1−|v|/5000（max .2） |
| motion.value.bridge | 22×34px，r11；停留 110ms 后断开 |
| motion.value.capsule | 偏移光标 (18,22)；沿速度方向拉伸 min(.6, v/2200)，横向 1−.45s |
| motion.value.parallax | 桌面 ±10px(x) / ±8px(y)；暗角额外 ±5 / ±4px |
| motion.value.vignette | 半径 VR：待机 240，进入 900→240，脉冲峰 360，完成 →520，Esc →30；色标 `#140c0826 0 / #140c0870 VR / #0a0604d0 720px` |
| motion.value.depth | 桌面 scale .975 + blur 1.2px；完成时 blur 额外 +1.6px 峰值后归零 |
| motion.value.pulse / flash | 光脉冲 opacity .85→0、scale 1→1.12；闪光峰 .35（30% 处） |
| motion.value.pellet | 28px 圆（r14），fill opacity p×1.4 |
| motion.value.done | 其余按钮滑向完成键 scale→.25；底板 scale(.14,.9)；完成键 ×1.3 |
| motion.value.hoverLight | 按钮：radial 40px 圆，#fff → #fffa 25% → 透明 75%，opacity = 强度×.6（完成键 ×.55）；卡片/抽屉：90px 圆，#fff → #fff9 25% → 透明 75%，×.75；首次进入时光点直接定位到指针 |
| motion.value.railSweep | 光带宽 90px，skewX −24°，渐变 #fff0 → #fffe → #fff0；位于按钮之上（z-index 2），不接收指针；待机扫光 opacity .35 |
| motion.value.esc | 选区 translateY 40k²、scale(1.04,.85)、skewX 4°；碎屑 16 颗，下落 260k²、旋转 300°；按钮下落 280k²、旋转 ±45°、scaleY .75；卡片 translateY 120k²、rotate 8° |

## 3. 时间线（起始 ms 相对于该时刻触发点）

### 3.1 进入框选与遮罩（快捷键）

| 起始 | 时长 | 层 | 元素 | 属性 from→to | 曲线 | 备注 |
|---|---|---|---|---|---|---|
| 0 | 1100 | 细节 | 快捷键提示 | opacity 0→1→0（15%/80%） | 线性分段 | 仅 demo 演示 |
| 0 | 320 | 背景 | 遮罩 | opacity 0→1 | EO | |
| 0 | 520 | 背景 | 暗角 | VR 900→240 | EO | 中心随光标（vignette spring） |
| 0 | 420 | 背景 | 桌面 | scale 1→.975，blur 0→1.2px | EO | 景深后退 |
| 0 | 500 | 主体 | 光标处涟漪环 | opacity 0→1（30%）→0，scale 1→6 | EO | 泥色环 |
| 持续 | — | 背景 | 桌面 / 暗角 | 视差位移 | parallax / vignette | 全程有效 |

### 3.2 拖框中

| 起始 | 时长 | 层 | 元素 | 属性 | 曲线 | 备注 |
|---|---|---|---|---|---|---|
| 0 | — | 主体 | 选区 | 尺寸随光标 | 直接跟手 | demo 中脚本拖动 780ms |
| 0+i×25 | spring | 主体 | 8 个泥珠手柄 | scale 0→1 | beadPop 520/18 | |
| 逐帧 | — | 主体 | 厚泥边框 | 沿速度方向拉伸 ≤8% | rimStretch 300/16 | 原点左上 |
| 逐帧 | — | 细节 | 尺寸胶囊 | 位置跟随光标+(18,22)，速度拉伸 | capsuleLag 170/16 | 松手后回到选区左上 −34px |
| 逐帧 | 260 | 背景 | 尺寸数字 | 数字滚轮 translateY | cubic-bezier(.2,.8,.2,1) | 3 位，前导 0 |
| 循环 | 2600 | 背景 | 边框光束 | conic 角度 0→360° | linear | |

### 3.3 松手 → 编辑交接（关键路径）

| 起始 | 时长 | 层 | 元素 | 属性 | 曲线 | 备注 |
|---|---|---|---|---|---|---|
| 0 | 400 | 背景 | 光脉冲环 | opacity .85→0，scale 1→1.12 | EO | 装饰 |
| 0 | 380 | 背景 | 暗角 | VR 240→360→240 | sin | 装饰 |
| 0 | spring | 主体 | 边框 | scale .97→1 | rimPress 700/40 | |
| 0 | 340 | 主体 | 边框内阴影 | 0→12px→5px | EO 分段 | 加深 |
| 0+i×8 | spring | 主体 | 手柄 | scale 1.6→1 | beadSettle 600/38 | |
| 0 | spring | 主体 | 轨道底板 | scaleX 0→1，scaleY .75→1 | railBody 420/28 | 原点 92% |
| (6−i)×18 | spring | 主体 | 7 个按钮 | 从选区右下角挤出，挤压/拉伸，图标 −40°→0 | clayPop 700/40 | p≥.85 接受点击；完成键最先 |
| 220 | 240 | 背景 | 轨面扫光 | 斜向光带 translateX −200→520px | 线性 | 装饰；不影响可点（首个可点 ≈110–175 ms 已发生） |
| 停稳后 | 4000 循环 | 背景 | 轨道 | 顶部高光 opacity .15↔.7 | ease-in-out | 待机呼吸 |
| 停稳后 +1200 | 8000 循环 | 背景 | 轨面扫光 | 每周期扫过一次（前 18%），opacity .35 | ease-in-out | 很淡的待机扫光 |

实测：首个可点 133–171 ms，全部停稳 482–550 ms（含扫光）。

### 3.4 选区调整

| 起始 | 时长 | 层 | 元素 | 属性 | 曲线 | 备注 |
|---|---|---|---|---|---|---|
| 悬停 | 逐帧 | 主体 | 右下手柄 | scale 1→1.7 | handleHover 520/14 | 光标 16px 内 |
| 拖动 | 逐帧 | 主体 | 边框 | 速度拉伸 | rimStretch | |
| 拖动 | 逐帧 | 主体 | 轨道 + 卡片 | 位置滞后跟随，挤压 ≤12%、skew ≤8° | railFollow 360/20 | 卡片挂在按钮下方随轨道 |
| 拖动 | 逐帧 | 背景/细节 | 数字滚轮、胶囊 | 同 3.2 | | |

### 3.5 工具待命与落笔

| 起始 | 时长 | 层 | 元素 | 属性 | 曲线 | 备注 |
|---|---|---|---|---|---|---|
| 点击 | 见 3.8 | 主体 | 按钮 | 按压 | | |
| 点击 | spring | 细节 | 液态指示 | 首次 scale 0→1；切换时主滴 + 尾滴滑动拉伸 | liquidAppear / liquidLead / liquidTrail | 激活按钮底透明，露出蓝滴 |
| 点击 | spring | 主体 | 图标 | rotate −28°→0 | iconWobble 400/10 | |
| 点击 | spring | 细节 | 光标 | 箭头→十字，角标 scale 0→1 | badgePop 500/14 | |
| 落笔 0 | spring | 主体 | 笔尖泥点 | scale(1.8,.45)→1 | tipDab 520/12 | |
| 落笔 0 | 360 | 主体 | 涟漪 | opacity .8→0，scale .3→1.7 | EO | |
| 落笔 0 | 300 | 细节 | 卡片“描边”行 | scale 1→1.06→1 | sin | |
| 落笔 0 | 480 | 主体 | 矩形描边 | 宽高 0→目标 | EIO | 线宽 4px |
| 抬笔 | 160 | 主体 | 笔尖 | scale 1→0 | EO | |

### 3.6 属性卡开合

| 起始 | 时长 | 层 | 元素 | 属性 | 曲线 | 备注 |
|---|---|---|---|---|---|---|
| 0 | spring | 主体 | 卡片底板 | 按钮形 {65,−60,50,44,r22} → {0,0,180,114,r20}，附挤压 | cardMorph 400/22 | 共享元素变形 |
| 0 | spring | 主体 | 内容 | opacity 在 p .6→1 段 0→1 | 随 cardMorph | |
| 0 | spring | 主体 | 来源按钮 | scaleY 反冲 | buttonRecoil 500/14, v0 −6 | |
| 0 | spring | 细节 | 液桥 | scale 0→1 | bridgeIn 600/30 | |
| 桥出现后 +110 | spring | 细节 | 液桥 | scale 1→0（Y 先断） | bridgeSnap 520/16 | “啪”地断开 |
| 关闭 0 | 70 | 主体 | 内容 | opacity 1→0 | EO | |
| 关闭 70 | spring | 主体 | 底板 | 卡片→按钮形，opacity 末段归零 | cardClose 600/34 | |

### 3.7 更多抽屉

| 起始 | 时长 | 层 | 元素 | 属性 | 曲线 | 备注 |
|---|---|---|---|---|---|---|
| 0 | 70 + spring | 主体 | 属性卡 | 按 3.6 关闭 | cardClose | 与抽屉重叠 |
| 40 | spring | 主体 | 抽屉 | 从“更多”按钮挤出，180×158 | cardMorph 400/22 | |
| 40 | spring | 细节 | 液桥 | 同 3.6 | bridgeIn / bridgeSnap | |
| 再次点击 | 70 + spring | 主体 | 抽屉 | 收回按钮 | cardClose | |

### 3.8 hover / pressed / focus

| 状态 | 层 | 元素 | 属性 | 曲线 | 备注 |
|---|---|---|---|---|---|
| hover | 主体 | 按钮 | scale 1→1.08（离开回 1） | hover 520/16 | 从当前值重定向 |
| hover 光 | 背景 | 按钮（含完成键）、属性卡、抽屉底板 | 高光中心跟随指针位置；强度进入 0→1、离开 1→0 | hoverLightPos 300/30，hoverLightFade 200/28 | 逐帧 follow；减少动态下关闭 |
| pressed | 主体 | 按钮 | 60ms 到 scaleX 1.06 / scaleY .86 + 阴影塌陷，然后回弹 | EO → pressRebound 600/14 | 不阻塞点击 |
| focus-visible | 主体 | 按钮 | 3px `#3B82F6aa` 外环 | 无动画 | Tab 可达 |

### 3.9 完成 → 复制 → 收起

| 起始 | 时长 | 层 | 元素 | 属性 | 曲线 | 备注 |
|---|---|---|---|---|---|---|
| 0 | 60 + spring | 主体 | 完成键 | 按压 | 同 3.8 | 同时禁用全部按钮 |
| 0 | 150 | 细节 | 液态指示 | 滑向完成键并 scale→0 | EIO | |
| 0 | 280 | 背景 | 桌面 | scale .975→1，blur 峰值 +1.6px 后→0；VR 240→520 | EO | 景深退场 |
| 0 | spring | 主体 | 选区 | 压成 28px 泥丸飞向完成键中心；边框圆角 10→21；手柄消失 | pellet 620/40 | 遮罩镂空冻结为原矩形 |
| 0 | 按 3.6 | 主体 | 打开的卡片/抽屉 | 收回 | cardClose | |
| 0+(5−i)×12 | 210 | 主体 | 其余 6 个按钮 | 滑向完成键，scale 1→.25，opacity→0 | EIO | |
| 30 | 230 | 背景 | 遮罩 | opacity 1→0 | EO | |
| 40 | 240 | 主体 | 轨道底板 | scale(1,1)→(.14,.9) | EIO | |
| 140 | 240 | 背景 | 闪光 | opacity 0→.35→0 | 线性 | |
| 150 | spring | 细节 | 提示（滴落） | y −40→35（速度拉伸），宽 30→150 | toastDrop / toastSpread | 文字 +80ms 起 160ms 渐显 |
| 170 | spring | 主体 | 完成键 | scale 1→1.3 | doneSwell 520/22, v0 8 | 泥丸落入 |
| 170 / 190 | 100 / 120 | 主体 | 选区 / 轨道 | opacity→0 | EO | 窗口消失点 |
| 1150 | 220 | 细节 | 提示 | opacity→0，scale→0 | EO | 不计入预算 |

实测完成→消失 361–369 ms（最近两轮）。

### 3.10 Esc 取消

| 起始 | 时长 | 层 | 元素 | 属性 | 曲线 | 备注 |
|---|---|---|---|---|---|---|
| 0 | 260 | 背景 | 暗角 | VR 当前→30（向光标收拢） | EO | |
| 40 | 270 | 背景 | 遮罩 | opacity→0 | EO | |
| 0 | 290 | 主体 | 选区 | translateY 40k²、scale(1.04,.85)、skewX 4°、opacity 1−k² | EI | 下垂，原点底边 |
| 0–50 | 270 | 主体 | 16 颗碎屑 | 下落 260k²、横移 ±40px、旋转 300°、淡出 | 线性 | 从边框四边 |
| 0–40 | 280 | 主体 | 按钮 | 下落 280k²、旋转 ±45°、scaleY .75、opacity 1−k² | 线性 | |
| 0 | 290 | 主体 | 轨道底板 | translateY 60k²、scaleY .6、淡出 | EI | |
| 0 | 280 | 主体 | 卡片/抽屉 | translateY 120k²、rotate 8°、淡出 | EI | |

可在任意时刻触发，从当前值开始。实测 363–376 ms（最近两轮）。

### 3.11 托盘浮卡（未在 demo 中验证）

demo 未实现托盘。建议复用同一组 token：
- 出现：`motion.spring.cardMorph`（400/22）从托盘图标形变为卡片，内容在 p>.6 渐显；背景层不变暗，仅加 `motion.value.pulse` 弱化版。
- 关闭：内容 70ms 淡出 + `motion.spring.cardClose`（600/34）。
- 悬停/按压：沿用 3.8。
- 减少动态：120ms 淡入淡出。
以上均**未在 demo 中验证**。

## 4. 可交互性规则

1. 按钮逐个可点：挤出 spring 进度 p≥.85 时启用 `pointer-events`。完成键最先出现，所以最先可点。减少动态下 60ms 后全部启用。
2. 打断/重定向：
   - 所有 spring 带运行令牌。重播或 Esc 会使进行中的 spring 停在当前值，新动画从当前值开始。
   - hover 与跟随类（轨道、胶囊、视差、暗角、边框拉伸）是逐帧 follow spring，目标随时变化，可连续重定向。
   - 按压不阻塞点击；完成或 Esc 开始时立即禁用全部按钮。
3. Esc 在选区可见的任意阶段有效（进入、拖框、编辑、抽屉打开）。
4. 完成开始时冻结遮罩镂空矩形，防止收起过程中镂空跳变。

## 5. 性能

- 尽量只动 transform / opacity / filter。例外：
  - 卡片共享元素变形逐帧改 left/top/width/height/border-radius；
  - 泥丸收起改选区几何；
  - 遮罩镂空每帧重算 `clip-path: path(evenodd, …)`；
  - 暗角每帧重写 radial-gradient。
  生产实现建议：卡片变形改为 transform scale + 反向缩放内容（FLIP）；暗角用固定大渐变层 + transform 平移。
- SVG goo filter（feGaussianBlur σ7 + feColorMatrix alpha 22/−9 + feComposite atop）是全屏 filter，成本最高。G 中只用于液态指示、液桥、提示滴落三处：
  - 建议把 filter 区域限制在元素包围盒，不用全屏容器；
  - 闲置时 `display:none`；
  - 低端设备回退为普通圆角块 + 同一 spring（无融合效果）。
- 悬停光每帧对 9 个元素（7 个按钮 + 卡片 + 抽屉底板）调用 getBoundingClientRect，并写 3 个 CSS 变量。生产实现建议改用 pointermove 事件缓存矩形，元素不可见时跳过。
- 边框光束（conic-gradient + mask-composite，`@property` 角度动画）与桌面 blur 也有合成成本。低端设备可关闭光束、把 blur 降为 0。

## 6. prefers-reduced-motion 降级

触发条件：系统 `prefers-reduced-motion: reduce`，或 demo 中勾选“模拟减少动态效果”。

| 时刻 | 正常 | 降级 |
|---|---|---|
| 遮罩进入 | 暗角收拢 + 景深 + 涟漪 | 遮罩 opacity 120ms |
| 拖框 | 边框拉伸、胶囊拖尾拉伸、手柄弹出 | 全部关闭；胶囊固定在选区左上；手柄直接显示 |
| 视差 / 轨道跟随挤压 | 开 | 关（轨道直接贴合） |
| 松手 | 多层挤出 | 轨道 opacity 120ms，60ms 后按钮可点 |
| hover | spring 放大 + 指针高光 | 无（高光层隐藏） |
| 轨面扫光 / 待机扫光 | 开 | 关（隐藏） |
| pressed | 压扁回弹 | opacity .6→1 120ms |
| 卡片/抽屉 | 共享元素变形 + 液桥 | opacity 120ms |
| 完成 | 泥丸 + 景深 + 滴落 | 遮罩/选区/轨道/卡片 opacity 120ms，提示 opacity 120ms |
| Esc | 塌落碎屑 | 各层 opacity 120ms |

实测（勾选 / 系统媒体查询）：首个可点 64 / 80 ms，停稳 142 / 164 ms，完成→消失 145 / 127 ms，Esc 145 / 131 ms。截图：`G_reduced_release.png`、`G_reduced_done.png`。

悬停光、轨面扫光、待机扫光在减少动态下通过 `.rdm` 类与 `@media (prefers-reduced-motion:reduce)` 隐藏；逐帧循环中强度也强制为 0。

## 7. 验收标准

- [ ] 松手→首个按钮可点 ≤220 ms（读数“松手→首个按钮可点”）。
- [ ] 松手→全部停稳 ≤600 ms，目标 ≤560 ms（主轮与 Esc 轮）。
- [ ] 完成→窗口消失 ≤420 ms，目标 ≤380 ms。
- [ ] Esc→消失 ≤420 ms。
- [ ] 减少动态下每个时刻只有 ≤120 ms 的透明度变化；无视差、拉伸、旋转、悬停光与扫光。
- [ ] 拖框时边框可见拉伸（≤8%），胶囊有滞后与拉伸。
- [ ] 按钮自右向左挤出，间隔 18 ms，完成键最先。
- [ ] 卡片从被点击按钮变形而出，液桥在约 110 ms 停留后断开。
- [ ] 完成时提示“已复制”从顶部滴落；窗口消失后提示仍保留约 1.15 s。
- [ ] 悬停按钮/卡片时可见跟随指针的柔和高光；离开后淡出；减少动态下不出现。
- [ ] 松手后约 220 ms 出现一次斜向轨面扫光，约 460 ms 结束；不推迟首个可点。
- [ ] 背景视差全程可见：桌面 ≤10/8px，暗角额外 ≤5/4px。
- [ ] 无 JS 报错；`rec.py G` 与 `rec_reduced.py` 能重现读数。

## 8. 已知缺口

- 遮罩镂空始终是矩形；泥丸收起时镂空冻结，靠遮罩淡出掩盖。
- 减少动态下暗角中心仍以 spring 跟随光标（无位移类动画，但仍有缓动跟随）。
- 实测数据来自 headless Chromium 帧时序，未在真机或高刷屏上测量。“全部停稳”最近两轮最差 550 ms，余量 50 ms；完成→消失偶有超过 380 目标（最高 403）。
- 悬停光在浅色泥面上较淡，盖在文字上时会略微冲淡标签。
- demo 为脚本驱动：选区不能手动拖动/绘制；只能点击按钮、悬停、Tab 聚焦、按 Esc。
- 调整选区只演示了右下手柄。
- 托盘浮卡未实现（见 3.11）。
