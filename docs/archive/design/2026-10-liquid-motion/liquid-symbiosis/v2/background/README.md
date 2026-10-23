# v2 背景轻移 · 设计草案

本目录保留先行交付的 Demo 与设计规范。用户后续已授权接入系统，正式宿主通过嵌入同一份 `tokens.json` 使用默认幅度；接入与验证见 `docs/LIQUID-MOTION-V2.md`。

后续生产修订已按用户要求改为框内内容与背景同步轻移，并修复重复截图黑底；此 Demo 保留旧的“选区固定”对照效果。

生成后双击仓库内 `output/design/liquid-v2-background/Screenshot-Background-v2.html` 即可离线体验。无需联网、安装包或服务配置。打开后在截图舞台内移动鼠标，选区外桌面和暗角轻微同向移动；截图本身、框线和工具命中区保持稳定。

可以直接调整幅度，打开静态对照，重播启动，切换减少动态；右上角保留 v2 的暖泥 / 深暖灰材质及设计台。设计台提供运行数值与背景候选参数导出。新建截图可体验框选期间归正，原有标注、浮卡、模拟完成用来检查与 v2 的衔接。

## 文件与重建

- `DESIGN.md`：来源、取舍、图层和状态规范。
- `tokens.json`：Demo 与正式 WPF 背景共享的参数；幅度调节仅用于 Demo 对照。
- `background.js` / `background.css`：背景扩展与简化的体验控件。
- `build.py`：从上一级 v2 的原始 Demo、材质、引擎构建离线单文件；不改写基准。
- `test.cjs` / `VALIDATION.md`：隔离回归和验证边界。

在仓库根目录使用已有 Python 3 与 Node 运行：

```powershell
python docs/motion/liquid-symbiosis/v2/background/build.py
node --check docs/motion/liquid-symbiosis/v2/background/background.js
# 使用已安装的 Playwright；不自动安装浏览器。
$env:SCREENSHOT_PLAYWRIGHT_MODULE = '<已有 Playwright 模块绝对路径>'
node docs/motion/liquid-symbiosis/v2/background/test.cjs
```

测试默认独立无头 Edge，可通过 `SCREENSHOT_CHROMIUM_EXECUTABLE` 指向已有 Chromium。生成页面、预览图、参数导出和回归结果都位于 Git 忽略的 `output/design/liquid-v2-background/`。

## 体验范围

沿用 v2 内置合成桌面和演示工具。背景本身不读取真实屏幕、没有原生桥、不调用外部网络，也不接触系统剪贴板或服务密钥。页面里的 OCR、翻译、完成、托盘、服务与更新仍是原 v2 的本地模拟；不能据此判断正式功能效果。

原始草稿、v1、v2 Demo 基准保持不变。正式 React/WPF 已接入背景表现：原生冻结桌面仍由 WPF 宿主持有，只迁移背景显示变换及参数，不把整屏数据交给编辑器。
