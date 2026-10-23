import { Path, type TSimplePathData } from 'fabric';

type XY = [number,number];
const middle=(a:XY,b:XY):XY=>[(a[0]+b[0])/2,(a[1]+b[1])/2];

/** 画笔使用同向实心片段的并集，回折和自交不会让粗描边相互抵消；编辑与导出共用。 */
export class InkPath extends Path {
  private ink?:{source:TSimplePathData;width:number;sx:number;sy:number;ox:number;oy:number;path:Path2D};
  override _render(ctx:CanvasRenderingContext2D) {
    if(!this.stroke||this.strokeWidth<=0)return;
    const scale=this.strokeUniform?this.getObjectScaling():{x:1,y:1};
    const sx=Math.max(.0001,scale.x),sy=Math.max(.0001,scale.y),ox=this.pathOffset.x,oy=this.pathOffset.y;
    let ink=this.ink;
    if(!ink||ink.source!==this.path||ink.width!==this.strokeWidth||ink.sx!==sx||ink.sy!==sy||ink.ox!==ox||ink.oy!==oy){
      ink={source:this.path,width:this.strokeWidth,sx,sy,ox,oy,path:inkOutline(this.path,this.strokeWidth,sx,sy,ox,oy)};
      this.ink=ink;
    }
    ctx.save();
    // 与 Fabric 的 strokeUniform 使用同一缩放，粗细不因调整对象大小而漂移。
    ctx.scale(1/sx,1/sy);this._setStrokeStyles(ctx,this);ctx.fillStyle=ctx.strokeStyle;
    ctx.fill(ink.path,'nonzero');ctx.restore();
  }
}

/** 中点曲线按误差细分；每个矩形及圆都保持相同绕向，交叉区域是并集而不是挖孔。 */
function inkOutline(commands:TSimplePathData,width:number,sx:number,sy:number,ox:number,oy:number) {
  const path=new Path2D(),radius=width/2;
  const point=(x:number,y:number):XY=>[(x-ox)*sx,(y-oy)*sy];
  const dot=(p:XY)=>{path.moveTo(p[0]+radius,p[1]);path.arc(p[0],p[1],radius,0,Math.PI*2);path.closePath();};
  let current:XY=[0,0],start:XY=current;
  const line=(next:XY)=>{
    const dx=next[0]-current[0],dy=next[1]-current[1],length=Math.hypot(dx,dy);
    if(length<.0001)return;
    const nx=-dy/length*radius,ny=dx/length*radius;
    path.moveTo(current[0]+nx,current[1]+ny);path.lineTo(current[0]-nx,current[1]-ny);
    path.lineTo(next[0]-nx,next[1]-ny);path.lineTo(next[0]+nx,next[1]+ny);path.closePath();
    dot(next);current=next;
  };
  const quad=(a:XY,b:XY,c:XY,depth=0)=>{
    // 控制多边形二阶差分同时约束弯曲和原路折返，不能只检查离直线的距离。
    if(depth>=9||Math.hypot(a[0]-2*b[0]+c[0],a[1]-2*b[1]+c[1])<=.8){line(c);return;}
    const ab=middle(a,b),bc=middle(b,c),m=middle(ab,bc);quad(a,ab,m,depth+1);quad(m,bc,c,depth+1);
  };
  const cubic=(a:XY,b:XY,c:XY,d:XY,depth=0)=>{
    const error=Math.max(Math.hypot(a[0]-2*b[0]+c[0],a[1]-2*b[1]+c[1]),Math.hypot(b[0]-2*c[0]+d[0],b[1]-2*c[1]+d[1]));
    if(depth>=9||error<=.6){line(d);return;}
    const ab=middle(a,b),bc=middle(b,c),cd=middle(c,d),left=middle(ab,bc),right=middle(bc,cd),m=middle(left,right);
    cubic(a,ab,left,m,depth+1);cubic(m,right,cd,d,depth+1);
  };
  for(const command of commands){
    switch(command[0]){
      case 'M':current=start=point(command[1],command[2]);dot(current);break;
      case 'L':line(point(command[1],command[2]));break;
      case 'Q':quad(current,point(command[1],command[2]),point(command[3],command[4]));break;
      case 'C':cubic(current,point(command[1],command[2]),point(command[3],command[4]),point(command[5],command[6]));break;
      case 'Z':line(start);break;
    }
  }
  return path;
}
