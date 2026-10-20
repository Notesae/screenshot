# 发布许可复核记录

此记录区分有正文的包级清单与尚未核实的嵌入组件；自动扫描成功不是完整分发许可结论。

## 已做

- 锁定npm安装包和NuGet依赖闭包的元数据、可找到的LICENSE/NOTICE、SBOM及文件哈希随便携目录生成；保守包括测试/构建依赖，不声称全部进入运行时bundle。
- 0.4.0补充自包含Microsoft.NETCore.App.Runtime.win-x64与Microsoft.WindowsDesktop.App.Runtime.win-x64 10.0.13实际还原包的LICENSE；前者附THIRD-PARTY-NOTICES也一并打包。包缺失则发布审查失败。
- ONNX Runtime 1.31.0已携官方包级MIT和344457字节ThirdPartyNotices；OpenCvSharp/OpenCV、SQLitePCLRaw、模型和PaddleOCR/RapidOCR现有正文继续打包。文本的存在不代表已逐项完成所有嵌入二进制归属复核。
- stackback0.0.2（测试工具链）旧地址已解析为[上游仓库](https://github.com/defunctzombie/node-stackback)。确认发布提交[2963095372abf7b75ba55f01cef08ab1e62c2ff4](https://github.com/defunctzombie/node-stackback/tree/2963095372abf7b75ba55f01cef08ab1e62c2ff4)，树51c317040552c6832bb34e26ac6574eee467202f只有README、package.json和JS/测试文件，无LICENSE/NOTICE；npm包同样缺正文。MIT元数据不能补出缺失的版权归属，不臆造年份/文本，licenseReviewGaps保留。

## 未完成

- OpenCvSharp Windows runtime携带OpenCvSharpExtern及opencv_videoio_ffmpeg4130_64.dll。应用OCR只调用图像处理，不代表附带插件可忽略许可；需要确认该二进制确切构建配置、嵌入依赖和对应源码/归属，再决定裁减未用插件或补齐资料。目前保留可复现上游包，不声明所有嵌入组件已审计。
- WebView2、WindowsDesktop/SDK分发条件及原生二进制嵌入归属的逐条人工审计、干净机器验证仍未完成。
- 安装器、证书购买、签名、更新分发、卸载保留数据、额外字体及ARM64需要另行决定，不自行购买或扩大范围。

0.3.0保持固定标签与既有校验值；该版本是注明限制的预发布。后续版本的许可清单改进不会追溯改写已发布ZIP。

## 0.4.1复核进展

本批将原生运行时改为同版本官方win.slim，并以实际DLL摘要与合成OCR验证确认；新包明确拒绝FFmpeg插件和错误版本DLL。相同静态OpenCV库的构建信息保留full模块字符串，因此没有据此声称所有非自由算法/Protobuf等都不在slim二进制中。已按保守闭包补入18份源告知记录（含IPP原始RTF协议），每份来源URL/摘要均可核对。

PE审查覆盖包内全部dll/exe，包括卫星程序集，按哈希匹配来源；原先缺少归属的Windows SDK.NET/WinRT目标框架文件已补入框架pack。四个外部Visual C++ DLL前置条件原诊断未覆盖，现按实际直接导入列出，目标机器只读检查文件和版本，不复制用户系统DLL或自动安装。

确实未关闭：1）上游vendor DLL没有给出逐对象静态链接SBOM/完整版权归属映射，当前是保守构建闭包；2）Intel IPP Simplified EULA的实际再分发条件需审核，原文已取得而不是缺文件；3）Windows SDK标准条款与选中文件再分发清单映射未完成，原用户SDK许可决定仍有效；4）stackback0.0.2是开发工具链，缺完整许可正文，上游发布提交无该文件，未臆造。WebView2/ONNX/.NET附带告知是upstream bundle，不把所有可选组件都宣称实际加载。不能给出全量法律许可通过结论。

## 0.4.2 源码配置复核

本节更新前述版本的未完成项；旧包保持原样。当前自建 DLL 可追溯到四份固定官方源码归档。保留根许可证、COPYRIGHT、所选源码子树完整许可注释、源文件摘要、CMake缓存、MSVC工具链与实际逐对象链接map，平台静态CRT/Windows库另列。SoftFloat/fdlibm、OpenCV旧BSD注释未被Apache根许可覆盖掉。此证据不声称不同MSVC/SDK可生成相同字节。

通过显式禁用IPP/IW移除当前源码配置对其再分发条款的依赖，旧 vendor 回退仍保留原限制。PNG仅使用固定libpng1.6.55+zlib1.3.1。其他图像编解码、ITT/tracing、OpenCL、FlatBuffers、摄像头、contrib/DNN等关闭；以真实缓存、构建信息和链接记录交叉检查。

Windows SDK所选两文件已在[官方REDIST](https://learn.microsoft.com/en-us/legal/windows-sdk/redist) NET8.0小节逐名核实。官方[SDK LICENSE](https://download.microsoft.com/download/0/F/F/0FF2B061-47DD-4F55-89B6-FD1D8C44F14D/sdk_license.rtf)和REDIST原文随包携带并校验摘要。文件映射缺口关闭；产品/分发方/最终用户条款、公开发布所需其他条件没有自动完成。原用户对SDK使用的批准保持有效，未接受任何新协议。

剩余：stackback0.0.2开发工具的许可正文缺失；公开分发条款决定、WebView2/ONNX/.NET整体人工复核、干净机器验收、安装器/签名/更新/卸载/字体/ARM64。没有联系供应商、购买证书、发布新Release或使用真实AI/桌面输入。

## 0.4.6 发行条款及首次启动落实

实际发行方已明确确认有权以Notesae署名、承担适用SDK分发义务，并批准使用条款与首次本地同意流程；未编造公司/法定主体、未重新接受新协议或更换项目源码许可证。legal/保留正式文本与核心文件摘要，Windows SDK原文/REDIST仍按原始摘要校验。首次启动关闭、拒绝、未勾选及记录保存失败均不创建主宿主；主窗口、WebView、热键、捕获、剪贴板和AI入口位于门禁之后。确认记录仅在当前用户本地；核心条款及附加告知变化使旧记录失效。

官方Microsoft.Windows.CsWinRT2.2.0 MIT包的lib/net8.0/WinRT.Runtime.dll与当前文件SHA256完全相同，补入原始MIT正文与固定包/源码来源记录，包审查核对二进制摘要；不据此改变Microsoft.Windows.SDK.NET.dll的SDK许可。源码和Vendor配置既有边界保持。

此批是已确认发行条件的技术落实，不是全面法律审计。stackback开发工具许可正文缺口及其他人工审查项、真实条款窗口操作/桌面、干净机器验收继续保留。发布作业仅在准确main提交的CI成功后，原样取该CI便携ZIP、校验版本/版权/法律目录与全文件哈希，再发布预发布并重新下载全部附件核验。没有安装器、购买证书、新字体或ARM64。
