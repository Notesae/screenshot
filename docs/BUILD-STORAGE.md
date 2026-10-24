# 构建产物清理与成品体积

`artifacts/` 存放构建、打包和验证过程中的生成物，不随 `output/` 一起交付给使用者。

## 本地产物保留规则

日常构建复用固定的 `publish-build-source` / `publish-build-vendor`、`verify-source` / `verify-vendor` 缓存，完整包使用 `artifacts/Screenshot-win-x64` 暂存。不再为每个提交或每次修改复制一套完整包和构建目录。`output/Screenshot.exe` 继续作为当前工作区的运行入口。

```powershell
# 只列出清理计划；不会删除文件。
$plan = ./scripts/clean-artifacts.ps1
$plan.Items | Format-Table Path, Reason, Bytes, Status

# 清理上次暂存包后，可以复用同一路径打包。
./scripts/clean-artifacts.ps1 -Apply
./scripts/publish.ps1 -SkipRestore

# 需要临时保留某个包时，显式排除其目录。
./scripts/clean-artifacts.ps1 -Apply -KeepPath artifacts/Screenshot-win-x64
```

本地 `publish.ps1` 成功后自动清理已识别的旧产物，排除本次输出目录。GitHub Actions 不执行此自动清理，原有验证、证据上传及发布门禁保持原样。自定义的非空输出目录仍拒绝覆盖。

清理范围：

- 能通过宿主 DLL、运行时配置和编辑器入口识别的旧完整包。
- 不属于固定缓存的 `bin/obj` 构建目录。
- 已知命名的局部备份、隔离测试临时目录、部署脚本和日志。
- CI 下载和发行目录中的压缩包、安装包、旧输出备份；保留报告、摘要和其他证据。

保留 `output/`、源码、工具和依赖缓存、原生源码及来源记录、固定发布/验证缓存、`qa/` 和无法识别的目录。遇到正在使用的旧 Screenshot 目录或重解析点会保留并提示；不会结束进程。执行删除前逐级核对绝对路径及内部文件，递归目标必须位于当前工作区的 `artifacts/`。

执行记录固定写入被 Git 忽略的 `artifacts/cleanup/last-run.json`，不持续新增时间戳报告。清理后重新预览，应没有新的历史产物候选；未知目录和缓存仍需单独判断。

2026-10-24 本地清理移除了 224 项，释放约 27.84 GiB，`artifacts/` 从约 34.22 GiB 降至 6.37 GiB。剩余主要是工具/依赖、原生构建及固定验证/发布缓存。清理前后对 `output/` 的 768 个文件逐一计算 SHA-256，内容均未改变。

## 当前成品的组成

以下为 2026-10-24 本地 `output/` 的静态盘点，使用 MiB（1024² 字节），不是压缩包下载大小。运行时二进制按现有 `native-dependencies.json` 中的归属划分；来源证据和模型按实际文件统计。

| 组成 | MiB | 说明 |
| --- | ---: | --- |
| .NET 核心与 Windows 桌面运行时 | 170.98 | 含 WPF、Windows Forms 和 13 种语言资源 |
| Windows SDK / WinRT 投影 | 24.23 | 当前 WGC 捕获路线使用相关 Windows API |
| 本地 OCR 模型及推理、图像库 | 46.14 | 包括模型、ONNX Runtime、OpenCV 和托管适配 |
| 原生构建证据 | 17.85 | 链接映射、源码输入列表、配置和构建日志 |
| React 编辑器成品 | 0.80 | HTML、CSS 和 JavaScript，未携带 node_modules |
| 其余文件 | 7.77 | SQLite、WebView2 适配、程序、许可、清单等 |
| 合计 | 267.77 | 本轮未修改成品 |

WebView2 浏览器运行时本身不在此包内。自包含发布携带 .NET 运行时，因此使用者无需另外准备 .NET；体积的大头来自这一部署方式和本地 OCR。

## 保留现有功能的精简顺序

1. **完整压缩原生构建证据**：17 个证据文件共 17.85 MiB，逐文件在内存中使用 gzip 实测约 1.70 MiB，可节省约 16.15 MiB。16 MiB 左右的 `OpenCvSharpExtern.map` 是主要来源。应保留解压后的原始字节及 SHA-256，并让打包校验核对完整证据；现行 `release-audit.cjs` 和 `verify-native-runtime.cjs` 要求原始文件及映射，直接删除会使门禁失败。此方案仅调整证据包装，无需改变截图或 OCR 运行逻辑，尚未实施。
2. **调试符号独立保存**：当前四个 PDB 共 0.18 MiB。它们用于诊断，不承担截图和编辑逻辑；可在构建缓存/独立符号产物中保留，发布包不附带。收益很小，并会降低随包排查异常时的便利性。

两项合计的静态估算可将当前包从 267.77 MiB 降至约 251.44 MiB。压缩测量只在内存进行；没有改写 `output/`，也没有据此宣称实际桌面功能已验收。

以下项目不纳入本轮的无损精简承诺：

- **非中文语言资源 14.62 MiB**：保留简繁中文及程序集内的默认英文，可使用 SDK 的 `SatelliteResourceLanguages` 控制打包。但其它系统语言下的框架对话框/错误提示会回退，属于语言呈现变化；不能将其描述为完全没有影响。若接受这个语言范围，总体静态估算可进一步到约 236.82 MiB。
- **名字含 Design 的组件 9.22 MiB**：属于 Windows Desktop 运行时，其是否可移除不能只按文件名判断。存在间接引用和动态加载的可能，需要依赖分析及恢复测试后的实际验证；不能直接从当前成品删 DLL。该数字包含语言资源，与上一项有重叠，不可简单相加。
- **171 MiB 左右的 .NET 运行时**：改为依赖系统运行时会改变安装及便携使用前提；不满足现有部署体验保持不变的要求。
- **Windows SDK 投影、本地 OCR 模型、ONNX/OpenCV、WPF/Windows Forms 和 SQLite**：当前捕获、离线识别、托盘/选区及存储代码确有使用。删除或改成云端、运行时下载会影响既有能力，不采用。
- **通用裁剪或 Native AOT**：不能用开启开关代替兼容性工作。当前架构使用 WPF 和 Windows Forms，微软仍将它们列为不支持通用 trimming 的框架。

官方依据：[.NET 部署方式](https://learn.microsoft.com/en-us/dotnet/core/deploying/)、[语言资源保留配置](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props#satelliteresourcelanguages)、[WPF / Windows Forms 的裁剪限制](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/incompatibilities)。本轮仅执行脚本语法检查、清理预览、实际文件清理和静态体积/内容核对，未运行自动化回归、CI 或桌面交互测试。
