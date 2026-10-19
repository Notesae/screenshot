# Screenshot project

- Preserve the Windows-first .NET 10 / WPF / WebView2 / React / TypeScript architecture authorized in the original task.
- Follow the global `C:\Users\admin\.codex\AGENTS.md`: reply in Chinese; explain non-obvious declarations and longer methods with concise comments, keep simple logic together, and do not run Maven checks for this project.
- Read docs/SCOPE.md and docs/BRIDGE.md before changing application behavior.
- Keep native OS access and provider secrets in the host. The editor never receives API keys.
- Do not add paid dependencies, silently download OCR models, send screenshots to a provider without an explicit user action, or claim untested features work.
- Use Chinese user-facing copy and concise comments explaining non-obvious behavior. No Maven checks apply to this project.
- Keep screenshots, credentials, provider configuration, build outputs, and task exports out of Git.
- Each independent worker owns its assigned paths. The integrator controls solution files, root scripts, docs, CI, and commits.
- Verify changes with editor tests/build, .NET tests/build, and real Windows UI where applicable. Record limitations in docs/VALIDATION.md.
- 当前用户已明确停止桌面交互测试：未经后续明确授权，不操作鼠标、键盘、窗口焦点、原生对话框、剪贴板、全局热键或屏幕捕获，也不要为清理测试而关闭窗口或恢复剪贴板。当前仅执行后台代码编辑、构建、单元/模拟测试和已授权提交推送；实机未测项据实记录。
