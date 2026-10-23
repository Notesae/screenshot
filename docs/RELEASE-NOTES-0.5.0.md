# Screenshot 0.5 预发布版

固定提交：`@COMMIT@`；[对应 Windows 验证 CI](@CI_URL@)。发行附件取自该提交成功的主分支 CI，发布时不重新构建或打包。

- [安装版 MSI](https://github.com/Notesae/screenshot/releases/download/v@VERSION@/Screenshot-@VERSION@-setup-x64.msi)：中文安装界面，面向当前 Windows 用户。
- [便携版 ZIP](https://github.com/Notesae/screenshot/releases/download/v@VERSION@/Screenshot-@VERSION@-win-x64.zip)：完整解压到新目录，再运行根目录 `Screenshot.exe`。

本版汇总旧设计方案、液态共生设计分支和最新生产实现，旧 demo 与验证记录整理到独立设计归档，生产动效参数独立维护。

- 工具轨、浮卡、滑杆与图标统一使用受力拉扯、形变和衰减回弹；快速反向和连续切换继承当前速度。工具普通、绘制、调整三态的布局与材质同步过渡，浮卡连同内容整体开合，修整按钮收尾高光的硬切。
- 矩形、椭圆、箭头等支持连续绘制，并在绘制和调整时表现弹性形变。绘制新对象与调整已有对象使用不同状态标记；粗轮廓交叠改为实心笔触并集合成，避免小尺寸粗线条出现异常空洞。
- 参数浮卡改为悬停打开；点击工具直接进入绘制，美化点击切换启用状态。空白处原地长按不隐藏工具，选区实际移动后才进入拖动呈现。
- 翻译中的取消、完成后的阅读入口从翻译按钮分出并吸收收回。关闭截图时直接取消进行中的翻译，迟到回复不回写；完善兼容服务地址处理和推理超时反馈。截图与服务输入仍只在用户显式操作时发送。
- 美化样式增加清晰预览，修整缩放预览背景边缘。冻结背景与编辑平面共享可见位移，改善截图交接与选区移动的连续性。

自动化验证使用合成图片、内存桥、隔离测试库和本地固定 OCR 模型，覆盖前端、原生边界、存储、翻译排版、连续截图交接及发行包完整性。具体结果以对应 CI 与 [验证记录](https://github.com/Notesae/screenshot/blob/@COMMIT@/docs/VALIDATION.md) 为准。

此版本继续标记为预发布：真实 Windows 桌面、混合 DPI、热键、剪贴板、IME、GPU 合成、真实服务质量及安装升级流程未作本轮实机验收。MSI 仅离线提取校验，不等同安装验证。程序未作发布者数字签名。首次运行仍需条款确认及 WebView2 Runtime；升级前保存项目并退出旧版，便携包解压到全新目录。仓库访问权限决定下载及更新可用性。

ZIP 大小 @ZIP_BYTES@ 字节，SHA-256：`@ZIP_SHA256@`。MSI 大小 @MSI_BYTES@ 字节，SHA-256：`@MSI_SHA256@`。条款目录摘要：`@TERMS_DIGEST@`。附独立校验文件、SHA256SUMS.txt 和 release-manifest.json，发布流程回下载全部附件核对字节及摘要。
