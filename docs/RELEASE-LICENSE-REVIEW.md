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
