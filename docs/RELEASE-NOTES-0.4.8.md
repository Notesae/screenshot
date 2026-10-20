# Screenshot v@VERSION@ 预发布版

固定提交：`@COMMIT@`；[对应 Windows 验证 CI](@CI_URL@)。附件取自该提交成功的主分支 CI，不在发布阶段重新构建。

- [安装版 MSI（推荐）](https://github.com/Notesae/screenshot/releases/download/v@VERSION@/Screenshot-@VERSION@-setup-x64.msi)：中文安装界面、桌面和开始菜单快捷方式、系统卸载入口。
- [便携版 ZIP](https://github.com/Notesae/screenshot/releases/download/v@VERSION@/Screenshot-@VERSION@-win-x64.zip)：完整解压后双击根目录带图标的 `Screenshot.exe`。

修复首次启动条款目录的末尾分隔符导致空路径失败的问题。增加统一截图图标，便携包根目录只保留带图标的 Screenshot.exe、使用说明、校验文件与 app 依赖目录。必须先完整解压，再双击根目录 Screenshot.exe。

新增同版本 Windows x64 MSI，提供中文安装界面、桌面/开始菜单入口及系统卸载入口，只安装给当前 Windows 用户。缺少 WebView2 时明确提示官方准备地址，不自动安装系统组件。安装版用新版 MSI 升级；便携版继续使用应用内更新。卸载保留用户设置及恢复数据。MSI 离线解包的全部文件与便携包逐一比较，中文条款、图标及快捷方式配置已验证；没有实际运行安装器。

应用更新改为 Notesae/screenshot 官方公开仓库免登录模式，移除 GitHub App、设备码、令牌与 Client ID 依赖。默认只检查稳定版；预发布需主动选择，只有预发布时明确提示。保留下载进度、取消/重试、API SHA-256与长度、包内清单/SBOM版本、Windows ZIP路径防护。

检查及下载前核对固定仓库身份和公开状态；匿名限流显示重试时间，不使用凭据或其他源绕过。重复下载不能清理首笔暂存，取消/中断后重试，错误包不能安装。安装前保存恢复快照，退出后隔离切换、旧版备份和回滚保护沿用原方案；无法原地更新时解压到新目录。

已发布0.4.7仍有旧登录门控和启动路径问题。请先保存并关闭旧版，再手动下载本版 MSI 安装，或将 ZIP 完整解压至全新目录运行一次。不要把 ZIP 直接覆盖到正在使用的目录。数据、设置和恢复库继续使用原 Windows 用户目录。

ZIP 大小 @ZIP_BYTES@ 字节，SHA-256：`@ZIP_SHA256@`。MSI 大小 @MSI_BYTES@ 字节，SHA-256：`@MSI_SHA256@`。条款目录摘要：`@TERMS_DIGEST@`。附件另提供各自校验文件、统一 SHA256SUMS.txt 和 release-manifest.json。

验证结果见 VALIDATION.md 及上述精确 CI。MSI 离线解包核对全部文件及中文条款；这不等于真实安装验收。SHA 与同源清单不构成发布者数字签名，仍信任 GitHub 官方账号和 HTTPS。真实 WPF 启动、安装/升级/卸载、Windows 退出交接/重启、UAC/只读介质、杀毒软件及断电未实机验收。遵守桌面交互暂停要求，没有实际替换用户安装、勾选条款、修改仓库权限或发起设备授权。
