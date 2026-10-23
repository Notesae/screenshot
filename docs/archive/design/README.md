# 设计 demo 归档

2026-10-24 按用户发布要求整理。历史 demo 与当时的验证结论保留，归档不代表这些模拟实现属于生产应用，也不重写旧测试记录。构建输出、录屏及本地测试导出继续排除在 Git 之外。

| 资料 | 入口 | 原始来源 |
| --- | --- | --- |
| 原 Soft Clay G 方案、静态画面 | [方案](2026-10-liquid-motion/MOTION-PLAN.md)、[演示](2026-10-liquid-motion/index.html) | `docs/soft-clay-motion-plan`，`e106d5f` |
| 液态共生 v1 | [设计包](2026-10-liquid-motion/liquid-symbiosis/README.md) | `design/liquid-symbiosis`，PR #6 |
| 液态共生 v2 | [设计包](2026-10-liquid-motion/liquid-symbiosis/v2/README.md)、[历史验证](2026-10-liquid-motion/liquid-symbiosis/v2/VALIDATION.md) | `e478516`，PR #6 |
| 冻结背景跟随 demo | [说明](2026-10-liquid-motion/liquid-symbiosis/v2/background/README.md) | `codex/liquid-motion-v2`，PR #7 |

归档目录保留原内部层级和离线构建脚本；需要查看单文件 demo 时，在相应目录执行 `build.py`。不将 demo 加入应用发行包，不使用 demo 项目格式读取生产项目，也不把旧原型断言计入本次产品测试。

本次合并前 `design/liquid-symbiosis`、`docs/soft-clay-motion-plan`、`main` 的提交均已包含在 `codex/liquid-motion-v2` 历史中。生产参数从接入实现的最终值单独提取到根目录 `design/`，归档中的参数只保留作历史对照。
