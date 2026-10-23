# Screenshot project

- Preserve the Windows-first .NET 10 / WPF / WebView2 / React / TypeScript architecture authorized in the original task.
- Follow the global `C:\Users\admin\.codex\AGENTS.md`: reply in Chinese; explain non-obvious declarations and longer methods with concise comments, keep simple logic together, and do not run Maven checks for this project.
- Read docs/SCOPE.md and docs/BRIDGE.md before changing application behavior.
- Keep native OS access and provider secrets in the host. The editor never receives API keys.
- Do not add paid dependencies, silently download OCR models, send screenshots to a provider without an explicit user action, or claim untested features work.
- Use Chinese user-facing copy and concise comments explaining non-obvious behavior. No Maven checks apply to this project.
- 用户动效基准（2026-10-23）：所有动效都视作「有韧性的软体受力」，先产生连续拉扯/收腰或合并吸收，再继承受力速度衰减弹动并停稳；常规、绘制、调整三态及浮卡、滑块、档位点亮/熄灭均遵循此基准。快速反向和重开必须从当前形变与速度续接，不能重置姿态、硬切文字/材质或只做淡入淡出。浮卡整体连同内容一起形变；业务值即时生效，动效不能阻挡连续输入。优先共享时钟和合成层变换，避免逐帧布局读写、大面积滤镜及无意义循环；隐藏和减少动态直接到达准确终态。按现行约定只编译，不能宣称未经实机验证的流畅度已验收。
- Keep screenshots, credentials, provider configuration, build outputs, and task exports out of Git.
- Each independent worker owns its assigned paths. The integrator controls solution files, root scripts, docs, CI, and commits.
- 用户最新要求（2026-10-23）：日常修改和修复暂时不运行 GitHub 自动化测试、CI 测试、本地自动化回归或复杂测试，由用户自行验收；仅在用户明确确认进入发布版本阶段后恢复测试，覆盖此前恢复测试/CI 的约定。日常仅执行必要编译、打包与文件更新，不主动触发或重跑 CI，不擅自修改仓库工作流或绕过合并门禁；不将编译通过写成桌面交互已经验收。
- 每次完成修改后，都必须提交本次变更并推送到当前工作区所用分支对应的 GitHub 远程分支；未经用户要求不切换分支、不夹带无关的既有改动。测试暂停期间提交说明必须包含 [skip ci]；提交或推送失败时据实说明原因和当前状态，不宣称已经同步。
- 使用当前工作区作为项目目录，运行入口为该目录下的 output\Screenshot.exe；不在此文件写死项目绝对路径，也不沿用历史记录中的盘符和目录。
- 当前用户已明确停止桌面交互测试：未经后续明确授权，不操作鼠标、键盘、窗口焦点、原生对话框、剪贴板、全局热键或屏幕捕获，也不要为清理测试而关闭窗口或恢复剪贴板。当前仅执行后台代码编辑、构建和输出整理；未经验证的项目据实说明。
