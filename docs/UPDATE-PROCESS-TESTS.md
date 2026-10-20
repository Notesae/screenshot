# 更新后台进程夹具

显式运行 `Screenshot.App.Tests.dll --update-process-suite`。夹具在 `artifacts/windows-process-tests/Screenshot-process-tests-<GUID>` 创建独立目录，使用测试宿主 apphost 的副本和文本包元数据，链接生产 UpdateSession / UpdateTransaction / PortablePackage；不启动 WPF 产品、条款窗口、真实安装或用户数据。

2026-10-20 恢复执行后实际通过 6 场景、27 项检查：父进程未退出前目录不变；新进程健康后提交；显式回滚并启动旧测试进程；新进程提前退出自动回滚；额外实例锁拒绝替换；迟到取消拒绝替换；损坏暂存包在交接前失败。成功和失败均核对目录全清单、外部隔离数据哨兵及真实子进程信号。成功安装与显式回滚共用一个案例目录，合计 6 场景。

首次恢复证据位于忽略目录 `artifacts/windows-process-tests/Screenshot-process-tests-a2e5f613716c431d9fcc2d01573afc15/result.json`。不将测试宿主、合成 0.4.8→0.4.9 或 `fixture-ready` 信号描述成真实应用升级。真实 WPF 入口、生产编辑器就绪、用户配置、UAC、杀毒软件及断电仍未验收；用户继续仅授权后台隔离测试。

在最新 main `ca9d562` 的完整构建上再次通过相同 27 项，证据为 `artifacts/windows-process-tests/Screenshot-process-tests-7e6c9f38da2b478bb3e194499a36c04e/result.json`。此轮包含已合并的 app 子目录/旧平铺布局更新代码，原生既有测试合计376。CI另上传结果或失败文本，排除夹具二进制副本。
