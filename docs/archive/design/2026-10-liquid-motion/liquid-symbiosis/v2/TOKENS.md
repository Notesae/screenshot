# Token 结构与消费说明

`tokens.json` 是本方案候选参数的来源，不替换仓库 `design/soft-clay.tokens.json`。这是本项目自定义结构，不宣称兼容 DTCG。

| 分组 | 实际消费者 | 边界 |
|---|---|---|
| material / color | engine.applyTheme → CSS 变量 | 两种材质共用几何与运动 |
| shape | CSS 控件、轨道、面板、手柄与选区装饰层 | 精确内线与外部泥边分开 |
| size | CSS 工具尺寸；app 浮卡、阅读布局 | 窄窗口可覆盖密度，不改文档尺寸 |
| type | CSS 正文、标题、标签与工具文字 | 图像样例的排版不是界面 Token |
| motion.spring | 调度器的 Spring | mass=1；k/c 并非毫秒 |
| motion.field | 临近场与邻居传导 | 最大位移按向量长度约束 |
| motion.press | 材质压缩与邻居速度冲量 | 命中槽位不缩放 |
| motion.duration | 液桥、错峰、扫光、脉冲、提示、折叠与退出 | 减少动态单独处理 |
| motion.bridge | 短暂桥的几何、透明度与来源距离 | maxLinks=1 为结构上限 |
| motion.solver | 子步长、长帧夹紧、停稳与休眠 | 不把长帧累计成超大弹跳 |
| motion.policy | 设计不变量、测试约束 | 不是任意关闭安全边界的开关 |
| layout | 安全边距、间隔与阅读最小值 | 几何使用 CSS px，不冒充 Windows 像素 |
| demo | 本地模拟时长、输入大小上限、网络/剪贴板边界 | 不用于生产性能判断 |

## 三类单位

CSS px / WPF DIP 用于界面布局；原型图像像素用于 PNG 和标注；毫秒用于时长与任务模拟。三者分开，不把原生多屏映射简化成 CSS 像素。

## 调参建议

先调整响应幅度，再调刚度/阻尼，最后调邻居比例。不要用减少阻尼弥补过小位移；否则得到的是抖动而不是迎向。大面板比按钮更稳，阅读内容完全不参与形变。

设计台改变 `field.radius` 和 `field.intensity`，导出时写回它们；不自动保存到生产配置。修改其他 JSON 后重新执行 `python build.py`。

主题切换只改变材质色，不改变任务语义、禁用状态、框选几何或 PNG 输出。候选里增加的暖泥是原 G 质感对照，不表示已批准生产主题迁移。

## 校验

`tokens.schema.json` 对当前参数结构、字段和数值类型进行校验，拒绝未知字段。运行：

```python
import json, jsonschema
jsonschema.validate(json.load(open('tokens.json')), json.load(open('tokens.schema.json')))
```

布尔 policy 表达本方案固定规则；不能把 fixedHitBoxes、ackBeforeExit 等改为 false 后认为仍符合本设计。生产接入仍需业务侧测试，而不是仅有 JSON 类型校验。
