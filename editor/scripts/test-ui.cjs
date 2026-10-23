// 合成页面共用真实入口：语义名称可变化，绘制工具用稳定的工具种类定位。
const kinds={'文字标注':'text','矩形标注':'rect','圆形标注':'ellipse','箭头标注':'arrow','画笔标注':'brush','高亮标注':'highlight','马赛克':'mosaic'};
function button(page,name){name=({'简洁截图':'选择清透样式','柔和留白':'选择暖纸样式','标注颜色':'自定义标注颜色'})[name]??name;return kinds[name]?page.locator(`[data-annotation-kind="${kinds[name]}"]`):page.getByRole('button',{name:({'美化图片':/^美化图片：/,'提取文字':/^提取文字：/,'更多操作':/^更多操作：/})[name]??name,exact:!['美化图片','提取文字','更多操作'].includes(name)});}
async function inspect(page,name){const target=button(page,name);await target.hover();await page.waitForTimeout(400);if(await target.getAttribute('aria-expanded')!=='true'){await page.mouse.move(20,20);await target.hover();}await page.waitForFunction(selector=>document.querySelector(selector)?.getAttribute('aria-expanded')==='true',name==='美化图片'?'[data-hover-panel="beauty"]':name==='提取文字'?'[data-hover-panel="text"]':name==='更多操作'?'[data-panel-trigger="more"]':`[data-annotation-kind="${kinds[name]}"]`);await page.locator('.clay-card:not(.is-closing)').waitFor();await page.waitForFunction(()=>{const body=document.querySelector('.liquid-panel-body'),content=document.querySelector('.liquid-panel-page');return body?.style.opacity==='1'&&content&&!content.inert&&getComputedStyle(content).opacity==='1';});}
async function click(page,name){
  if(name==='美化图片'){const target=button(page,name);if(await target.getAttribute('aria-pressed')!=='true')await target.click();return inspect(page,name);}
  if(name==='提取文字'||name==='更多操作')return inspect(page,name);
  if(['保存项目','导出图片','设置','重新框选'].includes(name)&&!await button(page,name).isVisible())await inspect(page,'更多操作');
  if(['自定义标注颜色','标注颜色'].includes(name)&&(!await button(page,name).isVisible()||await button(page,name).evaluate(el=>!!el.closest('[inert],[aria-hidden=true]'))))await inspect(page,'矩形标注');
  return button(page,name).click();
}
module.exports={button,inspect,click};
