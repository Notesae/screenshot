# Screenshot project

- Preserve the Windows-first .NET 10 / WPF / WebView2 / React / TypeScript architecture authorized in the original task.
- Follow the global `C:\Users\admin\.codex\AGENTS.md`: reply in Chinese; explain non-obvious declarations and longer methods with concise comments, keep simple logic together, and do not run Maven checks for this project.
- Read docs/SCOPE.md and docs/BRIDGE.md before changing application behavior.
- Keep native OS access and provider secrets in the host. The editor never receives API keys.
- Do not add paid dependencies, silently download OCR models, send screenshots to a provider without an explicit user action, or claim untested features work.
- Use Chinese user-facing copy and concise comments explaining non-obvious behavior. No Maven checks apply to this project.
- Keep screenshots, credentials, provider configuration, build outputs, and task exports out of Git.
- Each independent worker owns its assigned paths. The integrator controls solution files, root scripts, docs, CI, and commits.
- 用户最新要求（2026-10-22）：后续修改和修复暂时不进行自动化测试或 CI 测试，覆盖此前恢复测试/CI 的约定；未经明确恢复授权，不运行自动化回归、不触发或重跑 CI。仅执行必要编译、打包与文件更新，提交说明使用 [skip ci]；不擅自修改仓库工作流或绕过合并门禁。固定本地入口仍为 F:\work\screenshot\output\Screenshot.exe；不将编译通过写成桌面交互已经验收。
- 当前用户已明确停止桌面交互测试：未经后续明确授权，不操作鼠标、键盘、窗口焦点、原生对话框、剪贴板、全局热键或屏幕捕获，也不要为清理测试而关闭窗口或恢复剪贴板。当前仅执行后台代码编辑、构建和输出整理；未经验证的项目据实说明。
