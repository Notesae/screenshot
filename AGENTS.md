# Screenshot project

- Preserve the Windows-first .NET 10 / WPF / WebView2 / React / TypeScript architecture authorized in the original task.
- Follow the global `~/.codex/AGENTS.md` for the current user when present: reply in Chinese; explain non-obvious declarations and longer methods with concise comments, keep simple logic together, and do not run Maven checks for this project.
- Read docs/SCOPE.md and docs/BRIDGE.md before changing application behavior.
- Keep native OS access and provider secrets in the host. The editor never receives API keys.
- Do not add paid dependencies, silently download OCR models, send screenshots to a provider without an explicit user action, or claim untested features work.
- Use Chinese user-facing copy and concise comments explaining non-obvious behavior. No Maven checks apply to this project.
- 用户动效基准（2026-10-23）：所有动效都视作「有韧性的软体受力」，先产生连续拉扯/收腰或合并吸收，再继承受力速度衰减弹动并停稳；常规、绘制、调整三态及浮卡、滑块、档位点亮/熄灭均遵循此基准。快速反向和重开必须从当前形变与速度续接，不能重置姿态、硬切文字/材质或只做淡入淡出。浮卡整体连同内容一起形变；业务值即时生效，动效不能阻挡连续输入。优先共享时钟和合成层变换，避免逐帧布局读写、大面积滤镜及无意义循环；隐藏和减少动态直接到达准确终态。按现行约定只编译，不能宣称未经实机验证的流畅度已验收。
- Keep screenshots, credentials, provider configuration, build outputs, and task exports out of Git.
- 工具三态重排时，轨道底座、按钮和拖动柄共用布局测量与同相过渡，不能额外触发邻居碰撞造成抽动。选区移动、手动搬动轨道或视口变化后重建位置基准并清除旧余振，不从旧屏幕位置飞入；浮卡档位的底座、选中材质和标识作为同一个软体运动。
- 展开/收起完成后的受力回弹属于动效基准：先连贯抵达展开或收起形态，再由一次释放的力带动整个软体拉伸、压缩并来回弹动，幅度逐次衰减至停稳。调整↔普通、绘制↔普通均适用；标识跟随整体受力，不能另起图标上下抖动。快速反向继承现有形变和速度，只保留最新一次落位后的释放，旧过渡不能延迟补弹。
- 用户新增要求（2026-10-24）：导轨所有图标本身也要有受力动效，作用于 SVG 线条/部件的拉伸、弯转、分合与衰减回弹，不能只移动按钮代替。图标与三态切换共用时钟及外力，不额外重播上下抖动；重排引起的移入不触发邻近图标，布局补偿必须在画面显示前同步完成。
- Each independent worker owns its assigned paths. The integrator controls solution files, root scripts, docs, CI, and commits.
- 用户最新要求（2026-10-23）：日常修改和修复暂时不运行 GitHub 自动化测试、CI 测试、本地自动化回归或复杂测试，由用户自行验收；仅在用户明确确认进入发布版本阶段后恢复测试，覆盖此前恢复测试/CI 的约定。日常仅执行必要编译、打包与文件更新，不主动触发或重跑 CI，不擅自修改仓库工作流或绕过合并门禁；不将编译通过写成桌面交互已经验收。
- 每次完成修改后，都必须提交本次变更并推送到当前工作区所用分支对应的 GitHub 远程分支；未经用户要求不切换分支、不夹带无关的既有改动。测试暂停期间提交说明必须包含 [skip ci]；提交或推送失败时据实说明原因和当前状态，不宣称已经同步。
- 仅使用当前工作区作为项目目录，运行入口为相对路径 output\Screenshot.exe；本文件不指定盘符或用户绝对目录，不沿用历史位置，也不向其它工作区同步编译输出。
- 当前用户已明确停止桌面交互测试：未经后续明确授权，不操作鼠标、键盘、窗口焦点、原生对话框、剪贴板、全局热键或屏幕捕获，也不要为清理测试而关闭窗口或恢复剪贴板。当前仅执行后台代码编辑、构建和输出整理；未经验证的项目据实说明。
