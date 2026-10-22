# Screenshot · 液态共生 2

对第一版独立原型的重新打磨。它不是正式 Windows 应用升级，不是把 G 原稿换成另一套产品风格。

**先打开 `Screenshot-Liquid-v2.html`，这是能操作的 Demo；不是只有截图的审阅页。**

零运行时第三方依赖，所有脚本、样式与 Token 已内嵌，不需要联网或安装 Node。建议使用桌面 Chrome / Edge；仅在隔离 Chromium 中执行了本轮验证，未声称完成所有浏览器兼容。

## 这次看什么

1. 沿工具轨缓慢移动、快速反向，再按住按钮。按钮表面主动迎向，邻居递减传导，命中区域不变；跨过同组相邻按钮时出现短暂液桥。
2. 点击矩形或箭头，在选区内手绘。选择后拖动到边界，检查形状没有被压扁；Esc 取消当前手势，Ctrl+Z 撤销。
3. 打开美化，选择预设，调整滑杆；颜色有草稿、应用和取消，自定义预设可以保存及删除。
4. 打开“设计台”，选择失败、慢任务、空结果、部分失败或过期结果，再执行 OCR / 翻译 / 完成。失败不清空截图，取消不被迟到结果覆盖。
5. 在右上角切换暖泥与深暖灰材质。暖泥用于与最初 G 演示比较，深暖灰用于检查现有应用的材质连续性；不代表修改生产主题。

## 交付文件

- `Screenshot-Liquid-v2.html`：可直接打开的完整交互原型。
- `Liquid-v2-walkthrough.mp4`：约 14 秒隔离浏览器实际操作录制，不是 Windows 真机录屏。
- `Review.html`：截图审阅与文件导航，不冒充交互原型。
- `demo/`：HTML、CSS、动作调度器与应用逻辑源码。
- `tokens.json` / `tokens.schema.json`：候选参数和本项目 Schema。
- `DESIGN.md` / `MOTION-SPEC.md` / `TOKENS.md`：设计、动效和参数说明。
- `COVERAGE.md` / `CHANGELOG.md` / `VALIDATION.md`：覆盖范围、实际修订及验证边界。
- `tests/qa_v2.py`：交互回归；`tests/results-*.json` 是本次生成结果。

## 源码构建

```bash
python build.py
# 打开生成的 Screenshot-Liquid-v2.html
```

开发入口 `demo/index.html` 保留 Token 占位符，不能直接打开替代构建产物。`build.py` 使用 Python 标准库注入 JSON，并内嵌三份本地源码。

回归测试需要已有 Python、Playwright、Chromium；脚本默认 `/usr/bin/chromium`。它不会自动安装依赖或启动正式应用。

```bash
node --check demo/engine.js
node --check demo/app.js
python tests/qa_v2.py --group core
python tests/qa_v2.py --group tasks
python tests/qa_v2.py --group system
python tests/qa_v2.py --group files
```

## 严格边界

真实可操作：页面内框选、手绘标注、对象移动及端点调整、属性、撤销重做、美化、自定义预设、颜色草稿、本机图片导入、演示项目保存/打开、1×/2× PNG 导出。

本地模拟：OCR、文字翻译、图片原位翻译、复制完成、服务测试、更新、托盘。界面标明模拟；不会访问系统剪贴板、截图 API、真实模型、凭据或安装目录。

阅读内容使用固定示例，不是识别质量证据。项目格式为 `screenshot-liquid-design` v2，不兼容正式 `.screenshot.json`。项目含原图像素，不能作为脱敏文件分享；需要脱敏应导出实色遮盖后的 PNG。

没有承诺“无任何 Bug”，也没有把浏览器通过当成 WPF / WebView2 / 混合 DPI / 中文 IME 验收。生产源码、版本和发布保持不变。
