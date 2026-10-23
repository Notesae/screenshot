# Screenshot project

- Preserve the Windows-first .NET 10 / WPF / WebView2 / React / TypeScript architecture authorized in the original task.
- Follow the global `C:\Users\admin\.codex\AGENTS.md`: reply in Chinese; explain non-obvious declarations and longer methods with concise comments, keep simple logic together, and do not run Maven checks for this project.
- Read docs/SCOPE.md and docs/BRIDGE.md before changing application behavior.
- Keep native OS access and provider secrets in the host. The editor never receives API keys.
- Do not add paid dependencies, silently download OCR models, send screenshots to a provider without an explicit user action, or claim untested features work.
- Use Chinese user-facing copy and concise comments explaining non-obvious behavior. No Maven checks apply to this project.
- Keep screenshots, credentials, provider configuration, build outputs, and task exports out of Git.
- Each independent worker owns its assigned paths. The integrator controls solution files, root scripts, docs, CI, and commits.
- 用户最新要求（2026-10-23）：日常修改和修复暂时不运行 GitHub 自动化测试、CI 测试、本地自动化回归或复杂测试，由用户自行验收；仅在用户明确确认进入发布版本阶段后恢复测试，覆盖此前恢复测试/CI 的约定。日常仅执行必要编译、打包与文件更新，不主动触发或重跑 CI，不擅自修改仓库工作流或绕过合并门禁；不将编译通过写成桌面交互已经验收。
- 每次完成修改后，都必须提交本次变更并推送到当前工作区所用分支对应的 GitHub 远程分支；未经用户要求不切换分支、不夹带无关的既有改动。测试暂停期间提交说明必须包含 [skip ci]；提交或推送失败时据实说明原因和当前状态，不宣称已经同步。
- 固定本地入口仍为 F:\work\screenshot\output\Screenshot.exe。
- 当前用户已明确停止桌面交互测试：未经后续明确授权，不操作鼠标、键盘、窗口焦点、原生对话框、剪贴板、全局热键或屏幕捕获，也不要为清理测试而关闭窗口或恢复剪贴板。当前仅执行后台代码编辑、构建和输出整理；未经验证的项目据实说明。
