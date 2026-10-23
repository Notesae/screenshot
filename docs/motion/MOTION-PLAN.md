# Soft Clay 动效迭代计划（G 融合）

基线：main `03dc2ef`（0.4.10 Soft Clay prerelease）。产品路径已定：截完就走——热键/托盘 → 框选 → 松手即原位编辑 → 「完成」复制 PNG 并收起；无自动保存、无「继续编辑」。

权威材料（本目录）：`MOTION-SPEC.md`（时间线/token/规则/降级/验收）、`motion-tokens.json`、`index.html`（可点 demo，模式 G）、`frames/`（关键帧）。Figma：https://www.figma.com/design/UzKxsZKfMWqSLZR7gNB4kA

## 分阶段
1. **Token 落地**：把 `motion-tokens.json` 接成 WPF 与 React 共用的一份来源；加 spring 求解器（半隐式欧拉，4 子步，带运行令牌可打断）。全局 reduced-motion 开关（系统设置 + `prefers-reduced-motion`）。
2. **关键路径**：3.3 松手交接、3.9 完成收起、3.10 Esc。先满足预算，再加装饰。
3. **主体层**：3.2 拖框（泥珠手柄、边框速度拉伸、尺寸胶囊）、3.4 选区调整、3.5 工具待命与落笔、3.6 属性卡、3.7 更多抽屉、3.8 hover/pressed/focus。
4. **背景与细节层**：暗角/视差/景深、边框光束、光脉冲、轨面扫光与待机呼吸、悬停光、液态指示/液桥/提示滴落。
5. **托盘浮卡**：按 3.11 建议实现（demo 未验证，需实机确认）。
6. **性能与降级收尾**：按第 5 节改 FLIP、限制 goo filter 区域、缓存矩形；低端回退。

## 需一并解决的缺口（SPEC 第 8 节）
- 悬停光冲淡浅色泥面上的文字：降低强度或用 blend/遮罩避开文字，保证对比度。
- 遮罩镂空目前恒为矩形：收起时可选让镂空跟随泥丸圆角收缩，至少不得跳变。
- 托盘浮卡：实现并实机验收。
- 原生层（WPF 框选窗口、托盘）与 WebView2 层动效节奏一致，DPI 100%/150% 不糊。

## 预算（硬门槛）
松手→首个可点 ≤220ms；松手→全部停稳 ≤600ms（目标 ≤560）；完成→消失 ≤420ms（目标 ≤380）；Esc→消失 ≤420ms；reduced-motion 下每时刻仅 ≤120ms 透明度变化。

## 验收
按 SPEC 第 7 节逐条，**必须在 Windows 真机**测：录屏（≥60fps）给出各预算实测，DPI 100%/150% 各一套，与 `index.html` 模式 G 对照。
