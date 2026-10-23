"""复用 v2 原型源码，生成独立离线背景方案；生产及原 v2 文件不变。"""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent
V2 = ROOT.parent
REPO = ROOT.parents[4]
OUT = REPO / 'output/design/liquid-v2-background'


def replace_once(text, old, new):
    """基准结构变化时显式失败，避免交付未装入动效的静默副本。"""
    if text.count(old) != 1:
        raise ValueError(f'v2 基准入口不唯一：{old[:80]}')
    return text.replace(old, new, 1)


html = (V2 / 'demo/index.html').read_text(encoding='utf-8')
html = replace_once(html, '<title>Screenshot · 液态共生 2</title>', '<title>Screenshot · v2 背景轻移动效</title>')
html = replace_once(html, '液态共生 / 02', 'v2 · 背景动效草案')
html = replace_once(html, '独立交互原型', '独立背景方案')
intro = '<section class="intro"><h1>背景轻移，截图稳住。</h1><div class="intro-note">在截图舞台内移动鼠标，感受轻微的同向牵引。<br>停住就安定，离开便回正。</div></section>'
html, count = re.subn(r'<section class="intro">.*?</section>', lambda _: intro, html, count=1)
assert count == 1
controls = '''<nav class="scenes background-controls" aria-label="背景动效设计参数">
<label class="switch">背景跟手<input id="backgroundEnabled" type="checkbox" checked><span></span></label>
<label>幅度 <input id="backgroundGain" type="range" aria-label="背景跟随幅度"><output id="backgroundGainValue">100%</output></label>
<button id="backgroundCompare" aria-pressed="false">静态对照</button>
<label class="switch">减少动态<input id="backgroundReduced" type="checkbox"><span></span></label>
<button id="replay" class="replay">重播启动</button></nav>'''
html, count = re.subn(r'<nav class="scenes".*?</nav>', lambda _: controls, html, count=1)
assert count == 1
html = replace_once(html, '移动鼠标感受牵引 · 拖动绘制 · Esc 逐层返回', '<span id="backgroundStatus" role="status">背景已停稳</span>')
notes = '''<div class="background-notes"><span><b>轻跟随</b>默认 ±6 / ±4 px</span><span><b>稳操作</b>框选归正，按住暂停</span><span><b>同一套 v2</b>截图与工具轨保持原坐标</span></div>'''
html = replace_once(html, '</footer>', '</footer>' + notes)
html = replace_once(html, '<div class="lab-body">', '<div class="lab-body"><h3>背景候选参数</h3><pre id="backgroundMetrics"></pre><button id="backgroundExport" class="secondary">导出背景参数</button>')
tokens = json.loads((V2 / 'tokens.json').read_text(encoding='utf-8'))
html = replace_once(html, '__TOKENS__', json.dumps(tokens, ensure_ascii=False).replace('</', '<\\/'))
css = (V2 / 'demo/style.css').read_text(encoding='utf-8') + '\n' + (ROOT / 'background.css').read_text(encoding='utf-8')
html = replace_once(html, '<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
for script in ['engine.js', 'app.js']:
    code = (V2 / 'demo' / script).read_text(encoding='utf-8').replace('</script', '<\\/script')
    html = replace_once(html, '<script src="' + script + '"></script>', '<script>\n' + code + '\n</script>')
background_tokens = (ROOT / 'tokens.json').read_text(encoding='utf-8').replace('</', '<\\/')
code = (ROOT / 'background.js').read_text(encoding='utf-8').replace('</script', '<\\/script')
html = replace_once(html, '</body>', '<script id="backgroundTokenData" type="application/json">' + background_tokens + '</script><script>\n' + code + '\n</script></body>')
OUT.mkdir(parents=True, exist_ok=True)
target = OUT / 'Screenshot-Background-v2.html'
target.write_text(html, encoding='utf-8')
print(f'已生成：{target} ({target.stat().st_size} bytes)')
