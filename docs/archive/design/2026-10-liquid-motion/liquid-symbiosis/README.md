# Screenshot · 液态共生 / Liquid Symbiosis

2026-10-22 · 设计候选 1.0 · 独立原型，不是正式应用升级

> **一条具有整体感知的工具轨，每个按钮也拥有自己的感知。**
> 组件平时清晰独立；明确交互时短暂牵引、融合、分离。截图主操作鲜明，其他交互同源但收敛。

## 交付导航

| 文件 | 用途 |
|---|---|
| [DESIGN.md](DESIGN.md) | 产品方向、视觉体系、布局、全应用交互设计及决策理由 |
| [MOTION-SPEC.md](MOTION-SPEC.md) | 感知场、群体传导、液桥、按压、时序、中断与降级规范 |
| [COVERAGE.md](COVERAGE.md) | 与现有应用逐项映射；区分可操作、模拟和仅规范 |
| [TOKENS.md](TOKENS.md) | Token 层级、单位、消费方式、迁移与调参说明 |
| [tokens.json](tokens.json) | 本方案候选参数唯一来源，不替换生产 Token |
| [tokens.schema.json](tokens.schema.json) | 本项目自定义 JSON Schema；不是 DTCG 格式声明 |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | React/WPF 接入方案、状态边界、分阶段验收及 Codex 交接 |
| [VALIDATION.md](VALIDATION.md) | 本次实际验证结果与明确未测项 |
| [demo/](demo/) | 无第三方运行依赖的 HTML/CSS/JavaScript 交互源码 |
| [tests/qa.py](tests/qa.py) | 隔离 Chromium 回归脚本；不控制用户桌面 |
| [build.py](build.py) | 生成可直接打开的单文件演示 |

## 运行

```bash
# Python 3；仅使用标准库打包。
python build.py
# 打开生成的 standalone.html。文件不需要联网或构建前端依赖。

# 或启动仅监听本机的开发服务
python build.py --serve --port 8765
# 浏览器打开 http://127.0.0.1:8765/demo/index.html
```

双击开发源码 `demo/index.html` 会受浏览器本地 JSON 读取限制；请打开打包的 `standalone.html`，或使用上述本机服务。浏览器内不能访问系统截图、原生剪贴板、全局热键和 WPF，相关过程均明确标记为模拟。

## 建议体验顺序

先沿着工具轨缓慢移动，再快速反向经过相邻按钮；开启“显示稳定命中区”对比外观与点击位置。点击矩形、箭头、高亮、遮盖后实际绘制；使用新建截图拖出选区，拖动八个手柄调整范围。

随后打开美化、OCR、图片翻译、阅读窗及设置。右侧切换“失败 / 慢任务 / 无结果 / 部分失败 / 过期结果”，检查取消与现场保留。最后切换减少动态和低开销模式。

## 源码基线

仓库：`Notesae/screenshot`。

- 正式应用基线：`main@03dc2ef2f135e02b5131e1b9a0a46d89855f3ba2`。
- 原 G 融合设计：`docs/soft-clay-motion-plan@e106d5ffe5e0392feadb95c8bcd34480675e6d15`。
- 本包只新增设计资料与独立演示。原 G Demo、生产源码、生产设计 Token、CI、版本及 Release 均不修改。
- 原型不依赖 GitHub Pages，也没有将私有仓库内容公开部署。

截图和生成的 `standalone.html` 随交付包提供，不加入仓库，遵循项目不提交截图及构建输出的约定。**本目录的“覆盖”不等于生产功能已经改造或 Windows 验收通过。**
