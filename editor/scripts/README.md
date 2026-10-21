# 无头合成检查

当前 CI 使用以下脚本，全部只连接独立无头页面和内存桥，不连接桌面应用、系统剪贴板或真实服务：

- `scripts/test-editor-lifecycle.cjs`：确认布局后播放路径浮卡/工具栏入场，框内空白拖动且保留标注手势、选区移动/缩放/撤销、等待裁剪时落点与工具位置不变、手势 Esc、空白点击不重新框选、裁剪失败和迟到保护，以及完成复制/失败保留/成功清空/无自动保存/迟到回复保护、共享历史、工具位置、Esc 与窄屏。额外生成 DPR 1 / 1.5 合成页面，不等同于 Windows DPI 验收。
- `editor/scripts/soft-clay-audit.cjs`：原样字节、美化 2×、选中属性与撤销、源框校对、空 OCR 保护、块翻译重试/迟到取消、文字卡片、项目往返、缺模型、显示器/热键设置。
- `editor/scripts/update-safety-audit.cjs`：设置等待期间仍可取得精确更新快照。
- `editor/scripts/product-performance.cjs`：复用原有 12 次不可见文字编辑检查及动效属性限制；采用新浮卡 320ms 规格，不作为桌面帧率结论。
- `editor/scripts/benchmark-large-images.cjs`：复用原有 1080p/4K/8K 原样字节、导出尺寸和过大面积保护，不改变样本或扩大研究。

`headless-overlay.cjs`、`product-audit.cjs`、`refinement-audit.cjs`、`delivery-audit.cjs` 留作 0.4.x 三栏/旧紧凑界面的历史证据，不再由当前 CI 执行，也不能作为新界面验收。它们依赖已移除的“完整工作台”、旧 CSS 和旧路径。当前脚本重述可保留的能力断言，移除旧界面结构要求；并非所有历史逐项注入场景都已一对一迁移，不将新套件的通过写成旧套件完整通过。

环境变量 `PLAYWRIGHT_MODULE` 指向已有 Playwright；本地可通过 `SCREENSHOT_CHROMIUM_EXECUTABLE` 指定隔离的无头可执行文件，否则使用独立 headless Edge。生命周期套件也接受 `SCREENSHOT_PLAYWRIGHT_MODULE`。测试不安装浏览器或 OCR 模型。输出位于 Git 忽略的 artifacts 目录。

新增 scripts/test-annotation-drawing.cjs：11 组合成场景，覆盖 ready/painted 两阶段、五类标注落笔、反向绘制、箭头首尾独立调整与撤销、矩形角/边调整、属性卡关闭位置保持、误触/Esc 取消。文字先退出实际编辑才读取受保护快照。既有能力/生命周期/性能脚本改为在无头画布中实际绘制矩形，不移除原有能力断言。CI 运行新脚本并收集 artifacts/qa/annotation-drawing 的报告；不代表 Windows 实机交接或托盘 Popup 验收。
