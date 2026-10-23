'use strict';
/* 单一调度器：命中层始终固定，只更新表面、图标和装饰层。 */
window.Liquid = (() => {
  const T = JSON.parse(document.getElementById('tokenData').textContent);
  const $ = s => document.querySelector(s), clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const reduced = () => media.matches || $('#reduced').checked;
  const ease = t => 1-Math.pow(1-t,3);
  class Spring {
    constructor(value=0){this.x=value;this.v=0;this.to=value;}
    tick(dt,k,c){const steps=Math.max(1,Math.ceil(dt/T.motion.solver.maxStep)),h=dt/steps;for(let i=0;i<steps;i++){this.v+=(-k*(this.x-this.to)-c*this.v)*h;this.x+=this.v*h;}if(Math.abs(this.x-this.to)<T.motion.solver.positionEpsilon && Math.abs(this.v)<T.motion.solver.velocityEpsilon){this.x=this.to;this.v=0;}return this.x;}
    snap(value){this.x=this.to=value;this.v=0;}
    get moving(){return this.x!==this.to||this.v!==0;}
  }
  const E={nodes:[],pointer:{x:0,y:0,inside:false},dirty:true,raf:0,last:0,quiet:0,frames:0,pressed:null,lastNearest:null,bridge:null,bridgeLast:0,tracks:new Map(),body:new Spring(1),bodyBirth:false,bodyX:new Spring(0),bodyY:new Spring(0),indicator:{x:new Spring(),y:new Spring(),w:new Spring(44),alpha:new Spring(0),id:null},label:{x:new Spring(),y:new Spring(),until:0},intensity:T.motion.field.intensity,fieldRadius:T.motion.field.radius};
  function log(message){const li=document.createElement('li');li.textContent=message;$('#events').prepend(li);while($('#events').children.length>18)$('#events').lastChild.remove();}
  function wake(){if(!E.raf && !document.hidden){E.last=performance.now();E.raf=requestAnimationFrame(frame);}}
  function invalidate(){E.dirty=true;wake();}
  function stop(key){const a=E.tracks.get(key);if(a){E.tracks.delete(key);a.resolve(false);}}
  function spring(key,paint,options={}) {
    stop(key);const s=new Spring(options.from??0);s.to=options.to??1;s.v=options.velocity??0;
    return new Promise(resolve=>{if(reduced()){paint(s.to,0);resolve(true);return;}const q=options.spring||T.motion.spring.panel;E.tracks.set(key,{s,paint,resolve,k:q.k,c:q.c,start:performance.now(),timeout:options.timeout||1500});paint(s.x,s.v);wake();});
  }
  function tween(key,duration,paint){stop(key);return new Promise(resolve=>{if(reduced()){paint(1,1);resolve(true);return;}E.tracks.set(key,{paint,resolve,start:performance.now(),duration});paint(0,0);wake();});}
  function applyTheme(name){for(const [name,value] of Object.entries({'control':T.shape.control,'panel':T.shape.panel,'rail-radius':T.shape.rail,'rim-width':T.shape.rim,'selection-width':T.shape.selection,'handle-size':T.shape.handle,'tool-size':T.size.tool,'tool-gap':T.size.gap,'rail-padding':T.size.railPadding,'icon-size':T.size.icon,'font-body':T.type.body,'font-title':T.type.title,'font-label':T.type.label,'font-tool':T.type.toolLabel})){document.documentElement.style.setProperty('--'+name,value+'px');}const theme=T.material[name]||T.material.clay;Object.entries(theme).forEach(([k,v])=>document.documentElement.style.setProperty('--'+k,v));Object.entries(T.color).forEach(([k,v])=>document.documentElement.style.setProperty('--'+k,v));document.documentElement.dataset.theme=name;$('#themeToggle').textContent=name==='clay'?'深暖灰':'暖泥原稿';updateMode();}
  function updateMode(){const isDark=document.documentElement.dataset.theme==='dark';$('#modeLabel').textContent=(reduced()?'减少动态':$('#economy').checked?'低开销':'完整动效')+' · '+(isDark?'深暖灰材质':'暖泥材质');$('#systemReduce').textContent=media.matches?'系统已要求减少动态，应用开关不能覆盖。':'系统偏好优先；开启后停止正在运行的装饰动画。';}
  function refreshReduced(){document.body.classList.toggle('reduced',reduced());document.body.classList.toggle('economy',$('#economy').checked);updateMode();E.bridge=null;$('#liquidBridge').setAttribute('d','');$('#panelBridge').replaceChildren();if(reduced()){
      for(const [key,a] of [...E.tracks]){E.tracks.delete(key);a.paint(a.s?a.s.to:1,0);a.resolve(true);}for(const n of E.nodes){n.x.snap(0);n.y.snap(0);n.a.snap(0);n.press.snap(0);n.birth.snap(1);}E.body.snap(1);E.bodyBirth=false;E.bodyX.snap(0);E.bodyY.snap(0);document.querySelectorAll('.press-wave,.crumb').forEach(el=>el.remove());$('#pulse').getAnimations().forEach(a=>a.cancel());$('#rail').classList.remove('sweeping');
    }document.dispatchEvent(new Event('liquid-motion-change'));invalidate();}
  function initRail(){E.nodes=[...$('#rail').querySelectorAll('.tool')].map(el=>({el,id:el.dataset.action,group:el.dataset.group,skin:el.querySelector('.skin'),glyph:el.querySelector('.glyph'),x:new Spring(),y:new Spring(),a:new Spring(),press:new Spring(),birth:new Spring(1),due:0,rect:null}));invalidate();}
  function cache(){const rr=$('#rail').getBoundingClientRect();E.rr=rr;for(const n of E.nodes){const r=n.el.getBoundingClientRect();n.rect={x:r.left-rr.left,y:r.top-rr.top,w:r.width,h:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2,left:r.left,right:r.right};}E.dirty=false;}
  function activate(id){E.indicator.id=id;invalidate();}
  function press(id,down){const n=E.nodes.find(n=>n.id===id);if(!n||n.el.disabled)return;if(down){E.pressed=id;n.press.to=1;E.pointer.inside=false;const i=E.nodes.indexOf(n);for(const d of [-1,1]){const near=E.nodes[i+d];if(near&&near.group===n.group&&n.group!=='end'&&!near.el.disabled)near.y.v+=T.motion.press.neighborImpulse;}if(!reduced()){
      const ring=document.createElement('i');ring.className='press-wave';n.el.append(ring);ring.animate([{opacity:.65,scale:'.92'},{opacity:0,scale:'1.45'}],{duration:300,easing:'ease-out'}).finished.catch(()=>{}).finally(()=>ring.remove());
    }}else{E.pressed=null;n.press.to=0;}wake();}
  function cancelPress(){if(E.pressed){const n=E.nodes.find(n=>n.id===E.pressed);if(n)n.press.to=0;E.pressed=null;wake();}}
  function enter(){stop('rail-exit');E.body.snap(0.06);E.body.to=1;E.bodyBirth=true;E.pointer.inside=false;const now=performance.now();for(const [i,n] of E.nodes.entries()){n.birth.snap(reduced()?1:0);n.birth.to=1;n.due=now+(n.id==='done'?0:(E.nodes.length-i)*T.motion.duration.enterStagger);n.press.snap(0);}if(reduced()){E.body.snap(1);E.bodyBirth=false;}invalidate();sweep();}
  function sweep(){if(reduced()||$('#economy').checked)return;const rail=$('#rail');rail.classList.remove('sweeping');requestAnimationFrame(()=>{rail.classList.add('sweeping');setTimeout(()=>rail.classList.remove('sweeping'),T.motion.duration.sweep+30);});}
  function pulse(rect){if(reduced())return;const p=$('#pulse');Object.assign(p.style,{left:rect.x+'px',top:rect.y+'px',width:rect.w+'px',height:rect.h+'px'});p.animate([{opacity:.6,transform:'scale(1)'},{opacity:0,transform:'scale(1.045)'}],{duration:T.motion.duration.pulse,easing:'ease-out'});}
  function bridgePath(a,b,neck=5){
    // 用相向切线连接按钮表面，不产生可点击的新区域。
    if(a.x>b.x)[a,b]=[b,a];const x1=a.x+a.w-2,x2=b.x+2,y1=a.y+a.h*.51,y2=b.y+b.h*.51;
    const gap=x2-x1;if(gap<-8||gap>T.motion.bridge.maxGap)return '';
    const r=12,c=(x1+x2)/2;return `M${x1} ${y1-r}C${c} ${y1+neck} ${c} ${y2+neck} ${x2} ${y2-r}L${x2} ${y2+r}C${c} ${y2-neck} ${c} ${y1-neck} ${x1} ${y1+r}Z`;
  }
  function tickField(dt,t){
    if(E.dirty)cache();let moving=false;const rd=reduced(),rr=E.rr,ptr=E.pointer;
    const sc=$('#toolScroll').getBoundingClientRect();const active=ptr.inside&&!rd&&!E.pressed&&fine.matches&&$('#modalRoot').hidden&&!document.body.classList.contains('dragging-ui');
    const radius=E.fieldRadius,nearest=active?E.nodes.reduce((best,n)=>{if(n.el.disabled||n.el.hidden||n.rect.w===0)return best;const r=n.rect;if(n.el.closest('#toolScroll')&&(r.left<sc.left-2||r.right>sc.right+2))return best;const d=Math.hypot(ptr.x-r.cx,ptr.y-r.cy);return d<radius&&(!best||d<best.d)?{n,d}:best;},null):null;
    if(nearest&&nearest.n.id!==E.lastNearest){const previous=E.nodes.find(n=>n.id===E.lastNearest),curr=nearest.n;const gap=Math.abs(E.nodes.indexOf(previous)-E.nodes.indexOf(curr));if(previous&&previous.group===curr.group&&curr.group!=='end'&&gap===1&&t-E.bridgeLast>T.motion.duration.bridgeCooldown&&!$('#economy').checked){E.bridge={a:previous,b:curr,start:t};E.bridgeLast=t;}E.lastNearest=curr.id;}else if(!nearest){E.lastNearest=null;}
    let sum=0,center=0;
    for(const [index,n] of E.nodes.entries()){
      const r=n.rect;let attention=0,dx=0,dy=0;
      if(active&&!n.el.disabled&&nearest){const distance=Math.hypot(ptr.x-r.cx,ptr.y-r.cy);attention=Math.pow(clamp(1-distance/radius,0,1),2);const nearIndex=E.nodes.indexOf(nearest.n);if(n.group===nearest.n.group&&n.group!=='end')attention=Math.max(attention,Math.pow(1-nearest.d/radius,2)*(Math.abs(index-nearIndex)===1?T.motion.field.neighbor1:Math.abs(index-nearIndex)===2?T.motion.field.neighbor2:0));dx=clamp((ptr.x-r.cx)/(r.w*.7),-1,1);dy=clamp((ptr.y-r.cy)/(r.h*.7),-1,1);}
      attention*=E.intensity;n.a.to=attention;n.x.to=dx*attention*T.motion.field.shiftX;n.y.to=dy*attention*T.motion.field.shiftY;
      const config=nearest?.n===n?T.motion.spring.attention:T.motion.spring.neighbor;
      if(rd){n.x.snap(0);n.y.snap(0);n.a.snap(0);n.press.snap(0);n.birth.snap(1);}else{n.x.tick(dt,config.k,config.c);n.y.tick(dt,config.k,config.c);n.a.tick(dt,config.k,config.c);n.press.tick(dt,T.motion.spring.press.k,T.motion.spring.press.c);if(t>=n.due)n.birth.tick(dt,T.motion.spring.entry.k,T.motion.spring.entry.c);}
      const a=n.a.x,p=n.press.x,b=n.birth.x,shift=T.motion.field.maxShift,limit=Math.min(1,shift/(Math.hypot(n.x.x,n.y.x)||1)),x=n.x.x*limit,y=n.y.x*limit;n.faceX=x;n.faceY=y;
      const entryX=(rr.width-64-r.x-r.w/2)*(1-b),entryY=-25*(1-b);
      const sx=(1+T.motion.field.stretch*a*.60+(T.motion.press.x-1)*p)*Math.max(.02,b),sy=(1+T.motion.field.stretch*a*(Math.abs(dy)-.3)+(T.motion.press.y-1)*p)*Math.max(.02,b);
      n.skin.style.transform=`translate(${x+entryX}px,${y+entryY}px) scale(${sx},${sy})`;
      n.skin.style.borderRadius=`${T.shape.control+dx*a*3}px ${T.shape.control-dx*a*2}px ${T.shape.control+dx*a*2}px ${T.shape.control-dx*a*3}px`;
      n.skin.style.setProperty('--light',String(clamp(a*.95,0,.8)));n.skin.style.setProperty('--light-x',clamp((ptr.x-r.left)/r.w*100,0,100)+'%');n.skin.style.setProperty('--light-y',clamp((ptr.y-rr.top-r.y)/r.h*100,0,100)+'%');
      n.glyph.style.transform=`translate(${x*T.motion.field.iconRatio+entryX}px,${y*T.motion.field.iconRatio+entryY+p*1.2}px) rotate(${(1-b)*-22}deg)`;
      const opacity=clamp(b*1.7,0,1);n.skin.style.opacity=n.glyph.style.opacity=opacity;
      if(n.birth.moving||n.x.moving||n.y.moving||n.a.moving||n.press.moving)moving=true;
      sum+=a;center+=(r.x+r.w/2)*a;
    }
    E.bodyX.to=sum?center/sum:rr.width/2;E.bodyY.to=nearest?clamp((ptr.y-rr.top-rr.height/2)/rr.height,-1,1)*T.motion.field.bodyBulge*Math.min(sum,1.2):0;
    E.bodyX.tick(dt,T.motion.spring.body.k,T.motion.spring.body.c);E.bodyY.tick(dt,T.motion.spring.body.k,T.motion.spring.body.c);E.body.tick(dt,T.motion.spring.entry.k,T.motion.spring.entry.c);
    if(rd){E.body.snap(1);E.bodyY.snap(0);E.bodyX.snap(rr.width/2);}
    $('#railBody').style.transform=`scale(${E.body.x},${.92+.08*E.body.x}) skewX(${E.bodyY.x*.35}deg)`;
    $('#railBody').style.borderRadius=`${30+Math.max(0,-E.bodyY.x)}px ${30+Math.max(0,E.bodyY.x)}px 30px 30px`;
    $('#railBody').style.backgroundImage=`radial-gradient(ellipse 85px 30px at ${E.bodyX.x}px 0px,${document.documentElement.dataset.theme==='clay'?'#fff6':'#fff2'},transparent),linear-gradient(180deg,var(--surfaceTop),color-mix(in srgb,var(--surfaceTop) 78%,var(--surfaceBottom)) 32%,color-mix(in srgb,var(--surfaceTop) 30%,var(--surfaceBottom)) 70%,var(--surfaceBottom))`;
    if(E.body.moving||E.bodyY.moving||E.bodyX.moving)moving=true;
    const ind=E.indicator,n=E.nodes.find(n=>n.id===ind.id),blob=$('#activeBlob');
    const visible=!!n&&!n.el.disabled&&n.rect.left>=sc.left-2&&n.rect.right<=sc.right+2;
    ind.alpha.to=visible?1:0;
    if(n){ind.x.to=n.rect.x+n.faceX;ind.y.to=n.rect.y+2+n.faceY;ind.w.to=n.rect.w;if(ind.alpha.x===0||rd){ind.x.snap(ind.x.to);ind.y.snap(ind.y.to);ind.w.snap(ind.w.to);}}
    for(const s of Object.values(ind).filter(s=>s instanceof Spring)){if(rd)s.snap(s.to);else s.tick(dt,T.motion.spring.indicator.k,T.motion.spring.indicator.c);if(s.moving)moving=true;}
    Object.assign(blob.style,{left:ind.x.x+'px',top:ind.y.x+'px',width:ind.w.x+'px',height:(n?n.rect.h-2:53)+'px',opacity:ind.alpha.x,transform:`scale(${1+Math.min(.24,Math.abs(ind.x.v)/1800)},${1-Math.min(.13,Math.abs(ind.x.v)/3300)})`});
    const bridge=$('#liquidBridge');if(E.bridge&&!rd&&!$('#economy').checked){const f=(t-E.bridge.start)/T.motion.duration.bridge;if(f<1){const a=E.bridge.a,b=E.bridge.b;const valid=!a.el.disabled&&!b.el.disabled&&a.rect.left>=sc.left&&b.rect.right<=sc.right;bridge.setAttribute('d',valid?bridgePath({...a.rect,x:a.rect.x+a.faceX,y:a.rect.y+a.faceY},{...b.rect,x:b.rect.x+b.faceX,y:b.rect.y+b.faceY},T.motion.bridge.neck*(1-f)):'');bridge.style.opacity=Math.sin(Math.PI*f)*T.motion.bridge.opacity;moving=true;}else{bridge.setAttribute('d','');E.bridge=null;}}else bridge.setAttribute('d','');
    if(t>E.label.until){E.label.x.to=0;E.label.y.to=0;}if(rd){E.label.x.snap(0);E.label.y.snap(0);}else{E.label.x.tick(dt,350,27);E.label.y.tick(dt,350,27);}$('#sizeTag').style.transform=`translate(${E.label.x.x}px,${E.label.y.x}px)`;if(E.label.x.moving||E.label.y.moving)moving=true;
    return moving;
  }
  function frame(t){E.raf=0;E.frames++;const dt=Math.min(T.motion.solver.maxElapsed,Math.max(.001,(t-E.last)/1000));E.last=t;let moving=tickField(dt,t);
    for(const [key,a] of [...E.tracks]){let done=false;if(a.s){a.s.tick(dt,a.k,a.c);done=!a.s.moving||t-a.start>a.timeout;if(done)a.s.snap(a.s.to);a.paint(a.s.x,a.s.v);}else{const f=clamp((t-a.start)/a.duration,0,1);a.paint(ease(f),f);done=f===1;}if(done&&E.tracks.get(key)===a){E.tracks.delete(key);a.resolve(true);}else moving=true;}
    if(moving){E.quiet=0;E.raf=requestAnimationFrame(frame);}else if(++E.quiet<T.motion.solver.sleepFrames)E.raf=requestAnimationFrame(frame);else{E.last=0;$('#metrics').textContent=`状态：静止休眠\n累计动画帧：${E.frames}\n活跃时间线：${E.tracks.size}\n命中层：固定\n减少动态：${reduced()?'开启':'关闭'}`;}
  }
  addEventListener('pointermove',e=>{E.pointer={x:e.clientX,y:e.clientY,inside:!$('#stage').classList.contains('is-hidden')&&e.pointerType==='mouse'&&!e.target.closest('#lab,#popover,#modalRoot')};wake();},{passive:true});
  document.addEventListener('pointerleave',()=>{E.pointer.inside=false;wake();});
  addEventListener('pointerup',cancelPress);addEventListener('pointercancel',cancelPress);addEventListener('blur',()=>{E.pointer.inside=false;cancelPress();wake();});
  $('#rail').addEventListener('pointerdown',e=>{const b=e.target.closest('.tool');if(b)press(b.dataset.action,true);});
  $('#toolScroll').addEventListener('scroll',invalidate,{passive:true});addEventListener('resize',invalidate);document.addEventListener('visibilitychange',()=>{if(document.hidden){if(E.raf)cancelAnimationFrame(E.raf);E.raf=0;E.pointer.inside=false;}else invalidate();});
  media.addEventListener('change',refreshReduced);$('#reduced').addEventListener('change',refreshReduced);$('#economy').addEventListener('change',refreshReduced);$('#hitboxes').onchange=e=>document.body.classList.toggle('hitboxes',e.target.checked);
  $('#intensity').oninput=e=>{E.intensity=Number(e.target.value)/100;$('#intensityValue').textContent=e.target.value+'%';wake();};$('#radius').oninput=e=>{E.fieldRadius=Number(e.target.value);$('#radiusValue').textContent=e.target.value+' px';wake();};
  applyTheme('clay');refreshReduced();
  return {T,$,clamp,Spring,E,reduced,log,wake,invalidate,initRail,activate,press,enter,sweep,pulse,spring,tween,stop,applyTheme,refreshReduced};
})();
