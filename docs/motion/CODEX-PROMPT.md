# 给 Codex：Soft Clay G 融合动效实施

你在 **Notesae/screenshot** 上实现一整套 Soft Clay 动效。从 `docs/soft-clay-motion-plan` 分支最新提交拉出实现用新分支（例如 `feat/soft-clay-motion`），不要从 main 拉（docs/motion/ 只在这个分支上）。先读 docs/motion/ 里的文档再动手，开 **draft PR**，不要 merge。技术栈不变（.NET / WPF / WebView2 / React），不改产品流程和编辑内核。

## 先读
- `docs/motion/MOTION-PLAN.md`（阶段与缺口）
- `docs/motion/MOTION-SPEC.md`（权威数值：时间线、spring k/c、曲线、交互规则、降级、验收）
- `docs/motion/motion-tokens.json`、`docs/motion/index.html`（用浏览器打开，模式 G 是目标效果）、`docs/motion/frames/`
- `editor/DESIGN.md`

## 已定，不要改
- 截完就走：松手即原位编辑，动作轨立即出现；「完成」= 复制 PNG 到剪贴板后收起；无自动保存、无「继续编辑」。
- 动效不得延后可点：按钮 spring 进度 p≥0.85 即可点，完成键最先出现；完成/Esc 开始立即禁用按钮；所有动画可打断、从当前值续接。
- Esc 在任何阶段有效。

## 要做
1. motion tokens 单一来源，WPF 与 React 共用；spring 求解与 SPEC 一致。
2. 按 MOTION-PLAN 阶段 2→6 实现，先关键路径再装饰。
3. 修 SPEC 第 8 节缺口：悬停光不冲淡文字；镂空收起不跳变；托盘浮卡按 3.11 实现。
4. 性能：只动 transform/opacity 为主；卡片变形改 FLIP；goo filter 限局部且闲置隐藏；低端回退。
5. reduced-motion：系统设置开启时按 SPEC 第 6 节降级。
6. 同步更新 `editor/DESIGN.md`，数值与实现一致。

## 验收（PR 描述里给证据）
- SPEC 第 7 节逐条；预算：松手→可点 ≤220ms，停稳 ≤600ms，完成→消失 ≤420ms，Esc ≤420ms。
- Windows 真机 ≥60fps 录屏实测，DPI 100% 与 150% 各一套；与 demo 模式 G 并排对照截图。
- reduced-motion 开/关各一轮。
- CI 全绿。
- 没能真机验证的项单独列出，不要写成已通过。
