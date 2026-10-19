# 0.4.2 源码原生构建与后台证据

从已交付0.4.1基线b0dfbf1继续。没有取得旧离线电脑的未提交草稿，也没有修改旧0.3.0/0.4.0/0.4.1包。H:\work\screenshot仓库与Codex screenshot项目路径已核实。本轮不创建新Release。

## 来源与构建

固定官方OpenCV4.13.0、OpenCvSharp4.13.0.20260627、libpng1.6.55、zlib1.3.1源码提交及归档SHA256见[native/sources.lock.json](../native/sources.lock.json)。现有MSVC19.44.35229 x64，获用户批准的免安装CMake3.31.11/Ninja1.13.2仅位于artifacts/tools，使用进程内PATH。未安装编译器、修改系统配置或接受新协议。

只编译core/imgproc/imgcodecs，显式外部PNG/zlib，关闭IPP/IW、ITT/tracing、OpenCL、FlatBuffers、Orbbec及视频/UI/额外编码器。OpenCvSharp源码未改动，以上游NO_*宏裁减。源码归档重用时逐文件校验；zlib标准生成流程的zconf.h重命名单列允许。

实际DLL 8,094,208字节，SHA256 `75a76b4369ccbb8bae7e62589e4af787386d42b45a58dcabde8aa40c8dab2f4f`。源锁SHA256 `60fc173b262787095d1cb9e43c1115fc4ba8c06df680824ca82b5ba38259cff5`。原vendor DLL55,547,904字节，摘要固定在[native/vendor-baseline.json](../native/vendor-baseline.json)。

native-provenance保留完整CMake缓存、链接map、逐库/对象记录、工具链与源码输入摘要、原始根许可/COPYRIGHT及保守源码注释告知。链接记录含OpenCV三模块、libpng/zlib和单列Windows/MSVC平台库，未见IPP/IW/ITT/Tesseract等额外库。所选源码子树中SoftFloat/fdlibm及旧BSD告知也保留；不将四个归档误写成四种全部许可义务。不同工具链可产生不同字节，不声明位级可复现。

## 实际CPU模型比较

同一Vendor配置测试驱动，独立进程明确加载并核验指定DLL；3轮交替执行顺序，每进程预热后5次采样，每场景15个观测。固定PP-OCRv5 mobile CPU模型，内存生成中英文900×260/1920×1080文本图和3200×1800噪声PNG。没有屏幕、剪贴板或AI服务输入。

文字、块ID/顺序、识别多边形、置信度、PNG解码像素和采样预处理张量一致；坐标、置信度、采样张量最大差均为0。

| 场景 | vendor中位ms | 源码中位ms | 本机耗时下降 |
|---|---:|---:|---:|
| small-text | 43.4617 | 40.0901 | 7.8% |
| large-text | 163.4205 | 148.8433 | 8.9% |
| large-png-decode-and-detection-preprocess | 54.6457 | 47.6932 | 12.7% |

20ms采样的私有内存峰值vendor 402,767,872字节，源码 270,573,568字节。此值含实际模型/图像工作集，是本机合成观察，不是最大内存、现实准确率或一般性能保证。比较脚本对>15%中位退化报错，未降低正确性或性能门槛。

## 验证与打包

- 编辑器51测试；原生边界190断言；模拟AI18；SQLite56；源码OCR16算法/加载检查、含实际模型17检查通过。
- 离屏Edge 24检查通过，涵盖原位与工作台、共享导出、隐私遮盖、译文/恢复与竞态；nativeCalls=false、clipboardAccess=false。
- 4阶段专用SQLite子进程硬终止与重新打开验证通过；不等于断电/磁盘控制器测试。
- Source正常生产PNG入口加载的实际DLL摘要与manifest一致。比较驱动的显式DLL句柄覆盖只存在于测试程序。
- 独立artifacts/Screenshot-0.4.2-win-x64便携目录静态审查通过：757项文件哈希（另附SHA256SUMS）、191项SBOM组件、491项PE来源、2模型摘要；.NET10.0.13自包含。未启动Screenshot.exe。

原始本机证据位于artifacts/qa/native-rebuild，原生来源位于artifacts/native-runtime/win-x64，均不进入Git。CI按本提交的Actions实际结果判断，本机通过不替代CI结果，也不预填绿色状态。

独立ZIP共758文件，113,076,864字节，SHA256 `1dccbc8444fa06d8f67cfe5f7517cdd1f97fedf2d2a1c178aa8cc7a3485accf1`；逐项摘要与ZIP CRC复核通过。新进程状态查询也验证未加载原生OCR库，便携只读诊断在本机未见缺失前置文件，仍不等于干净机器运行。

## 仍需决定或操作

SDK两文件已对应官方REDIST并附LICENSE/原文摘要；产品/分发方/最终用户条款尚需决定。stackback0.0.2是开发工具依赖，仍缺上游许可正文；未联系供应商或臆造。WebView2/ONNX/.NET整体人工复核与干净机器验收仍独立。

真实捕获、透明选区、焦点、混合DPI/旋转/负坐标、窗口吸附、显示器选择、全局热键/剪贴板、拖放/文件对话框、IME和真实样本OCR/服务商端到端未测。安装器、签名、更新、卸载策略、字体、ARM64、P1/P2不在本轮自动扩展范围。

显式Vendor回退使用隔离构建目录，旧便携包可直接保留；不做运行时静默回退。使用方法见[native/README.md](../native/README.md)。
