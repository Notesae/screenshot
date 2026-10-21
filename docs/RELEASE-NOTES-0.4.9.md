# Screenshot v@VERSION@ 预发布版

固定提交：`@COMMIT@`；[对应 Windows 验证 CI](@CI_URL@)。附件取自该提交成功的主分支 CI，不在发布阶段重新构建。

- [安装版 MSI](https://github.com/Notesae/screenshot/releases/download/v@VERSION@/Screenshot-@VERSION@-setup-x64.msi)：中文界面，安装给当前 Windows 用户，提供桌面、开始菜单和系统卸载入口。
- [便携版 ZIP](https://github.com/Notesae/screenshot/releases/download/v@VERSION@/Screenshot-@VERSION@-win-x64.zip)：完整解压到新目录，再双击根目录的 `Screenshot.exe`。

本版合入 [PR #4](https://github.com/Notesae/screenshot/pull/4)，交付 Soft Clay 轻量编辑器与截图、保存、恢复流程。接受条款后默认驻留托盘；托盘提供区域/当前屏幕/全屏截图、图片/项目打开、粘贴、继续编辑、恢复、设置及退出入口，截图和文件共用文档与撤销历史。

编辑器提供原样、美化、文字三条路径，保留 OCR、翻译、源框校对、标注、项目、恢复、更新与条款入口。工具条和浮卡支持拖动、键盘微调、重置位置与工作区约束，并支持减少动态效果。

PNG 输出成功且可编辑恢复快照确认后收起，完成提示可继续编辑。覆盖、导入、恢复、收起、重载与退出均保护当前编辑；失败或取消保留文档，复制 PNG/文字不作为项目已保存。更新辅助进程确认接手后才允许已保存退出。

应用更新仍使用 Notesae/screenshot 官方公开源，免登录。默认检查稳定版；本次为预发布版，便携版用户需主动选择预发布通道。MSI 安装版请保存并退出旧版后，通过新版 MSI 升级；便携 ZIP 应解压到全新目录，不覆盖正在使用的目录。用户设置和恢复数据继续使用原 Windows 用户目录。首次运行仍需确认条款，机器需具备 WebView2 Runtime。

验证使用既有 CI：前端测试/构建、.NET、固定合成输入的本地 OCR、存储与大图保护、无头界面/生命周期回归、原生 OCR 性能门禁，以及便携包与 MSI 构建/离线提取校验。原生 OCR 门禁保留 1.15 阈值和失败即停止；旧失败记录保留，成功结果只表示对应机器与固定合成输入。四份旧界面审计保留为历史参考，未逐项迁移全部旧故障注入场景。详细范围见 [验证记录](https://github.com/Notesae/screenshot/blob/@COMMIT@/docs/VALIDATION.md)及 [改版实现记录](https://github.com/Notesae/screenshot/blob/@COMMIT@/docs/REDESIGN-IMPLEMENTATION.md)。

这是预发布版，未完成真实 Windows 桌面验收。遵守桌面交互暂停要求，没有启动产品或实际运行 MSI；托盘/全局热键、WPF/WebView2 合成、多屏 DPI、IME、原生对话框/剪贴板、完成提示、更新退出/重启/回滚，以及安装/升级/卸载均未实机验证。MSI 离线提取校验不等于安装验收。保留 Vite 主包体积提示及 NuGetAudit=false/缓存依赖的审计限制，不宣称完成依赖安全审计或法律审查。

ZIP 大小 @ZIP_BYTES@ 字节，SHA-256：`@ZIP_SHA256@`。MSI 大小 @MSI_BYTES@ 字节，SHA-256：`@MSI_SHA256@`。条款目录摘要：`@TERMS_DIGEST@`。另附独立校验文件、SHA256SUMS.txt 和 release-manifest.json；发布流程回下载全部附件核对字节和摘要。SHA-256 与同源清单属于完整性校验，不构成独立发布者数字签名，仍信任官方 GitHub 账号和 HTTPS。
