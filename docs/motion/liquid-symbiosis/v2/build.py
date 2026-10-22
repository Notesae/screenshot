"""把审阅原型打成离线单文件；不安装依赖，不访问网络。"""
from pathlib import Path
import json
ROOT = Path(__file__).resolve().parent
html = (ROOT / 'demo/index.html').read_text(encoding='utf-8')
tokens = json.loads((ROOT/'tokens.json').read_text(encoding='utf-8'))
html = html.replace('__TOKENS__', json.dumps(tokens, ensure_ascii=False).replace('</', '<\\/'))
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + (ROOT/'demo/style.css').read_text(encoding='utf-8') + '\n</style>')
for script in ['engine.js','app.js']:
    code = (ROOT/'demo'/script).read_text(encoding='utf-8').replace('</script', '<\\/script')
    html = html.replace('<script src="'+script+'"></script>', '<script>\n'+code+'\n</script>')
(ROOT/'Screenshot-Liquid-v2.html').write_text(html, encoding='utf-8')
print('Built Screenshot-Liquid-v2.html:', len(html.encode('utf-8')), 'bytes')
