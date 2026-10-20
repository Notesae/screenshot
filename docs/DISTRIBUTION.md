# 安装、启动与发行目录（0.4.8 候选）

本次范围是下载解压后的程序目录，不重排源码工程。源码从 `Notesae/screenshot` 的 main `9ab7f35` 拉取；0.4.7 的公开发布包 SHA-256 为 `bcf83d7cae05e2caee04cc8a7937bdae3acf99c4647140bf8515df6a271fd794`，已下载静态核对。候选尚未发布，不改写旧版本附件。

## 启动故障

真实 WPF 启动传入的 `AppContext.BaseDirectory` 带末尾目录分隔符，旧条款祖先检查却按没有分隔符的目录比较。检查越过应用根目录后会遇到空路径。过去的测试和包检查均传入无末尾分隔符的路径，未覆盖真实启动形态。

`TermsAgreement.Load` 统一完整路径并去掉非盘符根目录的末尾分隔符。回归测试同时覆盖条款加载及文档解析，发行包检查也改用带末尾分隔符的路径。未同意条款时仍不会初始化工作台、截图和全局热键。启动错误提示区分发行目录检查、读取/显示条款及创建工作台，避免全部误报为条款文件缺失。

## 用户下载格式

安装版文件名为 `Screenshot-版本-setup-x64.msi`。中文安装界面显示原始使用条款；只安装给当前用户，默认目录 `%LOCALAPPDATA%\Programs\Screenshot`。安装器创建桌面和开始菜单的 Screenshot 快捷方式，系统提供卸载入口；卸载只处理安装器管理的文件、注册值及快捷方式，不删除 `%LOCALAPPDATA%\Screenshot` 用户数据。

MSI 根据微软公开的每用户/每机器注册位置检查 WebView2 Runtime，缺少时明确提示官方准备地址；没有静默下载或接受系统组件条款。程序首次启动的条款确认独立保留。入口、主窗口、条款窗口及托盘共用多尺寸截图图标。

便携版文件名保持 `Screenshot-版本-win-x64.zip`，便于既有发布源识别。完整解压后根目录只有 `Screenshot.exe`、`使用说明.txt`、`SHA256SUMS.txt` 和 `app/`。根目录为静态链接 C 运行时的 Windows 原生入口，仅依赖 kernel32/user32；它通过自身绝对路径定位 `app/Screenshot.exe`，不依赖当前工作目录，不经过 shell。所有 .NET、网页、模型及许可文件均在 app 中；不要单独移动 EXE。

## 更新兼容

新代码同时校验旧平铺包和新结构包，整包 SHA 清单覆盖入口、说明及 app 全部文件。宿主使用外层整包作为文件锁、替换、备份和回滚边界。更新辅助进程直接运行隔离目录的实际宿主，确保跟踪真实进程退出及编辑器健康信号；不会跟踪立即退出的原生启动入口。

已发行 0.4.7 不认识新布局且存在启动问题，因此需要手动下载新包一次。新便携版之后可以使用应用内更新。MSI 安装会写入当前用户的安装路径标记，设置页识别后明确显示安装版并关闭便携替换及回滚按钮；安装版使用新版 MSI 升级，避免绕开 Windows Installer 的文件维护记录。匿名检查和便携目录导出仍可使用。

## 构建与检查

```powershell
./scripts/publish.ps1
./scripts/prepare-installer-tools.ps1
./scripts/build-installer.ps1
./scripts/test-launcher.ps1 -PackagePath artifacts/Screenshot-win-x64
./scripts/verify-installer.ps1 -Installer artifacts/Screenshot-0.4.8-setup-x64.msi -PackagePath artifacts/Screenshot-win-x64 -ReportPath artifacts/installer-verification.json
```

安装器编译使用固定的 WiX 4.0.6 和同版本中文 UI 扩展，仅准备在 `artifacts/installer-tools` 及工程 `.wix` 缓存；不安装系统工具，不接受新版本维护费条款，不增加应用运行依赖。已有 .NET 10 通过进程级 runtime roll-forward 运行编译器，环境变量随后恢复。原生入口使用已有 MSVC x64/Windows SDK。

CI 完成原有测试、源码原生运行时构建及发行目录审查，再生成 MSI。离线反编译 MSI，逐一比较安装目录中的全部文件哈希、图标、快捷方式、每用户范围、依赖检查及真正嵌入的中文条款。报告绑定便携目录清单和 MSI 摘要，不运行安装器。发布脚本要求相同精确提交的成功 main CI 同时具有便携和安装器 artifact，且离线报告与两个载荷一致；缺 MSI、损坏 artifact 或报告错配均拒绝发布。发布后重新下载全部七个附件核对。

## 验证边界

后台检查和模拟更新可验证路径与包内容，不能替代 Windows 安装/卸载、首次条款窗口、WebView2 加载、真实退出/重启或干净机器验收。本任务继续遵守桌面交互暂停，没有替用户安装、勾选条款或操作窗口。签名和真实桌面验收状态不因生成 MSI 而改变。

依据：[微软 WebView2 分发与检测](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)、[WiX 每用户安装范围](https://docs.firegiant.com/wix/schema/wxs/packagescopetype/)、[WiX 快捷方式](https://docs.firegiant.com/wix/schema/wxs/shortcut/)、[WiX 4.0.6 包和许可](https://www.nuget.org/packages/wix/4.0.6)。
