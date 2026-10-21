import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

// 下拉统一使用同一套菜单，选项沿用现有声明；值变化直接回调，不伪造原生事件。
type Props = { value:string|number; onChange:(value:string)=>void; children:ReactNode; disabled?:boolean; id?:string; 'aria-label'?:string; title?:string; className?:string };
type Option = { value?:string|number; children?:ReactNode; disabled?:boolean };

/** 菜单挂在编辑器根层，避免被浮卡滚动区裁剪；支持方向键、首尾、输入查找和取消。 */
export function Select(props:Props) {
  const id=useId(),button=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
  const options=Children.toArray(props.children).filter(isValidElement<Option>).map(child=>({value:String(child.props.value??Children.toArray(child.props.children).join('')),label:child.props.children,disabled:child.props.disabled}));
  const selected=options.findIndex(option=>option.value===String(props.value));
  const [open,setOpen]=useState(false),[active,setActive]=useState(0),[placement,setPlacement]=useState({left:0,top:0,width:0,height:240});
  const search=useRef({text:'',at:0});
  function reveal(index=selected) {
    if(!button.current||button.current.matches(':disabled'))return;
    const rect=button.current.getBoundingClientRect(),below=window.innerHeight-rect.bottom-12,above=rect.top-12;
    const height=Math.min(280,Math.max(48,Math.max(below,above))),down=below>=Math.min(280,options.length*40+12)||below>=above;
    const width=Math.min(Math.max(rect.width,180),window.innerWidth-16);
    setPlacement({left:Math.max(8,Math.min(rect.left,window.innerWidth-width-8)),top:down?rect.bottom+6:Math.max(8,rect.top-Math.min(height,options.length*40+12)-6),width,height:down?Math.min(height,below):Math.min(height,above)});
    setActive(index>=0&&!options[index]?.disabled?index:options.findIndex(option=>!option.disabled));setOpen(true);
  }
  function choose(index:number) {
    if(button.current?.matches(':disabled')||!options[index]||options[index].disabled){setOpen(false);return;}
    props.onChange(options[index].value);setOpen(false);button.current?.focus({preventScroll:true});
  }
  // 只在菜单内部导航；不把 Escape、空格或方向键传给截图编辑快捷键。
  function navigate(event:KeyboardEvent<HTMLElement>) {
    if(['ArrowDown','ArrowUp','Home','End','Enter',' ','Escape','Tab'].includes(event.key)) {
      event.stopPropagation();
      if(event.key==='Tab'){setOpen(false);button.current?.focus({preventScroll:true});return;}
      event.preventDefault();
      if(event.key==='Escape'){setOpen(false);button.current?.focus({preventScroll:true});return;}
      if(event.key==='Enter'||event.key===' '){if(open)choose(active);else reveal();return;}
      const enabled=options.map((option,index)=>option.disabled?-1:index).filter(index=>index>=0);
      const cursor=enabled.indexOf(active),step=event.key==='ArrowUp'?-1:1;
      const next=event.key==='Home'?enabled[0]:event.key==='End'?enabled.at(-1):enabled[(cursor+step+enabled.length)%enabled.length];
      if(!open)reveal(event.key==='Home'?enabled[0]:event.key==='End'||event.key==='ArrowUp'?enabled.at(-1):selected);else if(next!==undefined)setActive(next);
    } else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.nativeEvent.isComposing) {
      event.stopPropagation();event.preventDefault();
      search.current={text:(event.timeStamp-search.current.at<700?search.current.text:'')+event.key.toLocaleLowerCase(),at:event.timeStamp};
      const next=options.findIndex(option=>!option.disabled&&Children.toArray(option.label).join('').toLocaleLowerCase().startsWith(search.current.text));
      if(next>=0){if(open)setActive(next);else reveal(next);}
    }
  }
  useEffect(()=>{if(open&&button.current?.matches(':disabled'))setOpen(false);});
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!button.current?.contains(event.target as Node)&&!menu.current?.contains(event.target as Node))setOpen(false);};
    const moved=(event:Event)=>{if(!menu.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',outside,true);window.addEventListener('resize',moved);window.addEventListener('scroll',moved,true);
    return()=>{document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',moved);window.removeEventListener('scroll',moved,true);};
  },[open]);
  useLayoutEffect(()=>{
    if(!open||!menu.current)return;menu.current.focus({preventScroll:true});
    const option=menu.current.querySelector<HTMLElement>(`[data-option-index="${active}"]`);
    if(option){const top=option.offsetTop,bottom=top+option.offsetHeight;if(top<menu.current.scrollTop)menu.current.scrollTop=top;else if(bottom>menu.current.scrollTop+menu.current.clientHeight)menu.current.scrollTop=bottom-menu.current.clientHeight;}
  },[open,active]);
  return <span className={'clay-select '+(props.className??'')}>
    <button ref={button} id={props.id} type="button" className="clay-select-trigger" role="combobox" aria-label={props['aria-label']} aria-expanded={open} aria-controls={open?id:undefined} aria-haspopup="listbox" title={props.title} disabled={props.disabled} onClick={()=>open?setOpen(false):reveal()} onKeyDown={navigate}><span>{options[selected]?.label??options[0]?.label}</span><ChevronDown aria-hidden="true"/></button>
    {open&&createPortal(<div ref={menu} id={id} className="clay-select-menu" role="listbox" tabIndex={-1} aria-label={props['aria-label']} aria-activedescendant={active>=0?`${id}-${active}`:undefined} style={{left:placement.left,top:placement.top,width:placement.width,maxHeight:placement.height}} onKeyDown={navigate}>
      {options.map((option,index)=><button key={index} id={`${id}-${index}`} type="button" role="option" tabIndex={-1} data-option-index={index} aria-selected={index===selected} disabled={option.disabled} className={index===active?'is-active':''} onPointerMove={()=>{if(!option.disabled)setActive(index);}} onPointerDown={event=>event.preventDefault()} onClick={()=>choose(index)}><span>{option.label}</span>{index===selected&&<Check aria-hidden="true"/>}</button>)}
    </div>,button.current?.closest('.clay-editor')??document.body)}
  </span>;
}
