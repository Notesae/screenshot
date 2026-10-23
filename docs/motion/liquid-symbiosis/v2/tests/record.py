from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
(ROOT/'previews').mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 context=b.new_context(viewport={'width':1440,'height':1000},record_video_dir=str(ROOT/'previews/video'),record_video_size={'width':1440,'height':1000})
 page=context.new_page();page.set_content((ROOT/'Screenshot-Liquid-v2.html').read_text(encoding='utf-8'),wait_until='load');page.wait_for_timeout(800)
 page.evaluate('''()=>{const c=document.createElement('div');c.id='recordCursor';c.style.cssText='position:fixed;left:0;top:0;z-index:99999;pointer-events:none;filter:drop-shadow(0 1px 2px #0008)';c.innerHTML='<svg width="20" height="24" viewBox="0 0 20 24"><path d="M2 1L18 13L11 14L8 22Z" fill="white" stroke="#34474e" stroke-width="1.3"/></svg>';document.body.append(c);document.addEventListener('pointermove',e=>c.style.transform=`translate(${e.clientX}px,${e.clientY}px)`);}''')
 # 正常页面指针驱动；不是脚本改写动画值。
 for name in ['select','rect','arrow','text','highlight','cover','highlight','text','arrow','rect']:
  r=page.locator(f'.tool[data-action="{name}"]').bounding_box();page.mouse.move(r['x']+r['width']*.65,r['y']+8,steps=12);page.wait_for_timeout(100)
 page.screenshot(path=str(ROOT/'previews/03-proximity.png'),full_page=True)
 page.locator('.tool[data-action=rect]').click();r=page.locator('#capture').bounding_box();page.mouse.move(r['x']+r['width']*.62,r['y']+r['height']*.38,steps=16);page.mouse.down();page.mouse.move(r['x']+r['width']*.93,r['y']+r['height']*.80,steps=25);page.mouse.up();page.wait_for_timeout(700)
 page.locator('.tool[data-action=beauty]').click();page.wait_for_timeout(700);page.locator('[data-preset=sage]').click();page.wait_for_timeout(800)
 page.screenshot(path=str(ROOT/'previews/04-beauty-styled.png'),full_page=True)
 page.locator('#panelClose').click();page.wait_for_timeout(350);page.locator('.tool[data-action=translate]').click();page.wait_for_timeout(1500);page.locator('.tool[data-action=reader]').click();page.wait_for_timeout(450);page.locator('#compareText').click();page.wait_for_timeout(600)
 page.screenshot(path=str(ROOT/'previews/05-reader.png'),full_page=True)
 page.locator('#readerClose').click();page.locator('.tool[data-action=done]').click();page.wait_for_timeout(1300)
 page.screenshot(path=str(ROOT/'previews/06-complete.png'),full_page=True)
 path=page.video.path();context.close();print(path)
 # 静态审阅画面不保留录制指针。
 context=b.new_context(viewport={'width':1600,'height':1080});page=context.new_page();page.set_content((ROOT/'Screenshot-Liquid-v2.html').read_text(encoding='utf-8'),wait_until='load');page.wait_for_timeout(800)
 page.screenshot(path=str(ROOT/'previews/01-capture.png'),full_page=True);page.locator('.tool[data-action=beauty]').click();page.wait_for_timeout(650);page.screenshot(path=str(ROOT/'previews/02-beauty.png'),full_page=True)
 page.locator('#themeToggle').click();page.wait_for_timeout(350);page.screenshot(path=str(ROOT/'previews/07-dark.png'),full_page=True)
 page.evaluate('demo.openSettings("services")');page.wait_for_timeout(350);page.screenshot(path=str(ROOT/'previews/08-settings.png'),full_page=True)
 page.evaluate('demo.openComponents()');page.wait_for_timeout(350);page.screenshot(path=str(ROOT/'previews/09-components.png'),full_page=True)
 try:
  page.goto((ROOT/'Screenshot-Liquid-v2.html').as_uri(),wait_until='load',timeout=8000);page.wait_for_timeout(500);print('file navigation',page.evaluate('!!window.demo'))
 except Exception as e:print('file navigation unavailable',type(e).__name__)
 b.close()
