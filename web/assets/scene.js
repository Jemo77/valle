/* Escena del valle: cielo, luna, torres en la bruma, pasto vivo, polen y aves. Se dibuja sola al cargar. */

(function(V){
'use strict';
var $=function(s,r){return (r||document).querySelector(s)};
var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
function rng(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function lerp(a,b,t){return a+(b-a)*t}
function hex(h){h=h.replace('#','');return [0,2,4].map(function(i){return parseInt(h.substr(i,2),16)})}
function mix(a,b,t){return a.map(function(v,i){return Math.round(v+(b[i]-v)*t)})}
function rgb(c,a){return 'rgba('+c[0]+','+c[1]+','+c[2]+','+(a==null?1:a)+')'}

/* =========================================================
   ESCENA
   ========================================================= */
var SKY=[[0,'#050d0e'],[.38,'#11222a'],[.58,'#2a4046'],[.68,'#66777a'],[.75,'#b09b84'],[.82,'#d4b48f'],[1,'#d4b48f']];
var SKYRGB=SKY.map(function(s){return [s[0],hex(s[1])]});
function skyAt(f){
  f=Math.min(1,Math.max(0,f));
  for(var i=0;i<SKYRGB.length-1;i++){
    var a=SKYRGB[i],b=SKYRGB[i+1];
    if(f<=b[0]){return mix(a[1],b[1],(f-a[0])/((b[0]-a[0])||1))}
  }
  return SKYRGB[SKYRGB.length-1][1];
}
$('#sky').style.background='linear-gradient(to bottom,'+SKY.map(function(s){return s[1]+' '+(s[0]*100)+'%'}).join(',')+')';

var cStars=$('#stars'),cFar=$('#far'),cLife=$('#life'),cFront=$('#front');
var sx,fx,lx,rx;
var W=0,H=0,DPR=1,HZ=.72,hy=0;
var stars=[],midB=[[],[],[],[],[]],frontB=[],pol=[],flocks=[],nextFlock=6;
var P={x:-999,y:-999},M={x:-999,y:-999};
var T=0;

function fit(c,w,h){
  c.width=Math.round(w*DPR);c.height=Math.round(h*DPR);
  c.style.width=w+'px';c.style.height=h+'px';
  var x=c.getContext('2d');x.setTransform(DPR,0,0,DPR,0,0);return x;
}

function drawPlanet(c,w,h){
  var pr=Math.min(W,H)*.13,px=w*.72,py=h*.27,g;
  g=c.createRadialGradient(px,py,pr*.8,px,py,pr*3.6);
  g.addColorStop(0,'rgba(226,228,208,.22)');g.addColorStop(1,'rgba(226,228,208,0)');
  c.fillStyle=g;c.fillRect(px-pr*4,py-pr*4,pr*8,pr*8);
  c.save();c.translate(px,py);c.rotate(-.28);
  c.strokeStyle='rgba(228,232,214,.3)';c.lineWidth=1;
  c.beginPath();c.ellipse(0,0,pr*2.5,pr*.5,0,Math.PI,Math.PI*2);c.stroke();
  c.restore();
  g=c.createRadialGradient(px-pr*.35,py-pr*.35,pr*.1,px,py,pr*1.25);
  g.addColorStop(0,'#efeedc');g.addColorStop(.55,'#a9b0a0');g.addColorStop(1,'#4a5a57');
  c.fillStyle=g;c.beginPath();c.arc(px,py,pr,0,Math.PI*2);c.fill();
  c.save();c.beginPath();c.arc(px,py,pr,0,Math.PI*2);c.clip();
  c.fillStyle='rgba(5,12,12,.42)';c.beginPath();c.arc(px+pr*.55,py+pr*.3,pr*1.05,0,Math.PI*2);c.fill();
  c.fillStyle='rgba(40,52,48,.12)';
  [[-.3,-.1,.16],[.1,-.45,.1],[-.1,.35,.12],[.35,.1,.08]].forEach(function(k){c.beginPath();c.arc(px+pr*k[0],py+pr*k[1],pr*k[2],0,Math.PI*2);c.fill()});
  c.restore();
  c.save();c.translate(px,py);c.rotate(-.28);
  c.strokeStyle='rgba(228,232,214,.34)';c.lineWidth=1;
  c.beginPath();c.ellipse(0,0,pr*2.5,pr*.5,0,0,Math.PI);c.stroke();
  var a=Math.PI*.22;c.fillStyle='rgba(236,238,222,.9)';
  c.beginPath();c.arc(Math.cos(a)*pr*2.5,Math.sin(a)*pr*.5,2.4,0,Math.PI*2);c.fill();
  c.restore();
}

function drawFar(R){
  var c=fx,w=W+60,h=H,g,i;
  c.clearRect(0,0,w,h);
  g=c.createRadialGradient(w*.28,hy,0,w*.28,hy,Math.max(w,h)*.6);
  g.addColorStop(0,'rgba(240,150,80,.30)');g.addColorStop(.5,'rgba(220,130,90,.10)');g.addColorStop(1,'rgba(220,130,90,0)');
  c.fillStyle=g;c.fillRect(0,0,w,h);
  drawPlanet(c,w,h);

  var hz=skyAt(HZ);
  g=c.createLinearGradient(0,hy,0,h);
  g.addColorStop(0,rgb(mix(hz,[60,78,52],.55)));
  g.addColorStop(.18,'rgb(34,50,36)');
  g.addColorStop(1,'rgb(8,16,12)');
  c.fillStyle=g;c.fillRect(0,hy,w,h-hy);

  var dark=hex('#0a1513'),hazeC=mix(hz,[236,214,180],.25);
  var layers=[
    {n:30,d:.05,wmin:10,wmax:34,hmin:.08,hmax:.34,edge:0},
    {n:22,d:.28,wmin:16,wmax:52,hmin:.10,hmax:.46,edge:.2},
    {n:14,d:.58,wmin:26,wmax:80,hmin:.16,hmax:.62,edge:.55},
    {n:8,d:.88,wmin:44,wmax:120,hmin:.24,hmax:1,edge:.85}
  ];
  layers.forEach(function(L){
    var d=L.d,base=hy+d*H*.045,k=.16+d*.72;
    for(var n=0;n<L.n;n++){
      var tw=lerp(L.wmin,L.wmax,R());
      var th=hy*lerp(L.hmin,L.hmax,Math.pow(R(),1.25));
      var x;
      if(R()<L.edge){x=R()<.5?R()*w*.3:w*(.7+R()*.3)-tw}else{x=R()*w}
      var top=base-th;
      var cTop=mix(skyAt(top/h),dark,k),cBot=mix(skyAt(HZ),dark,Math.min(1,k+.06));
      var gr=c.createLinearGradient(0,top,0,base);
      gr.addColorStop(0,rgb(cTop));gr.addColorStop(1,rgb(cBot));
      c.fillStyle=gr;
      var sh=R();
      c.beginPath();
      if(sh<.25){
        c.moveTo(x,base);c.lineTo(x,top+tw*.4);c.lineTo(x+tw*.55,top);c.lineTo(x+tw,top+tw*.15);c.lineTo(x+tw,base);c.closePath();
      }else if(sh<.5){
        c.rect(x,top+th*.12,tw,th*.88);c.rect(x+tw*.2,top,tw*.55,th*.14);
      }else{c.rect(x,top,tw,th)}
      c.fill();
      if(d>=.28){
        c.strokeStyle='rgba(215,232,208,'+(.04+d*.07)+')';c.lineWidth=1;
        var step=Math.round(lerp(10,26,R()));
        c.beginPath();
        for(var yy=base-step;yy>top+4;yy-=step){c.moveTo(x,yy+.5);c.lineTo(x+tw,yy+.5)}
        c.stroke();
        c.strokeStyle='rgba(0,0,0,.25)';c.beginPath();c.moveTo(x+tw*.34,Math.max(top,0));c.lineTo(x+tw*.34,base);c.stroke();
      }
      if(d>=.58){
        var nw=Math.floor(tw*Math.min(th,h)/2600);
        for(i=0;i<nw;i++){
          var wx=x+4+R()*(tw-8),wy=Math.max(top,0)+8+R()*(base-Math.max(top,0)-16);
          c.fillStyle=R()<.12?'rgba(240,138,60,.75)':'rgba(230,236,214,.32)';
          c.fillRect(wx,wy,2,3);
        }
        if(top>0){
          var nv=1+Math.floor(R()*3);
          for(i=0;i<nv;i++){
            var x0=x+R()*tw,len=24+R()*90*d;
            c.strokeStyle='rgba(134,176,106,'+(.45+R()*.25)+')';c.lineWidth=1.1;
            c.beginPath();c.moveTo(x0,top);c.bezierCurveTo(x0+6,top+len*.3,x0-6,top+len*.6,x0+2,top+len);c.stroke();
            c.fillStyle='rgba(134,176,106,.6)';
            for(var q=1;q<6;q++){c.beginPath();c.ellipse(x0+(q%2?2:-2),top+len*q/6,2.2,1.2,0,0,Math.PI*2);c.fill()}
          }
          c.fillStyle='rgba(120,164,96,.55)';
          for(i=0;i<3;i++){c.beginPath();c.arc(x+R()*tw,top+1,2+R()*3,Math.PI,Math.PI*2);c.fill()}
        }
      }
    }
    var fy0=hy-h*.42;
    var fg=c.createLinearGradient(0,fy0,0,hy+26);
    fg.addColorStop(0,'rgba('+hazeC.join(',')+',0)');
    fg.addColorStop(1,'rgba('+hazeC.join(',')+','+(.34*(1-d)+.06)+')');
    c.fillStyle=fg;c.fillRect(0,fy0,w,hy+26-fy0);
    var by=base,bg=c.createLinearGradient(0,by-4,0,by+24);
    bg.addColorStop(0,'rgba('+hazeC.join(',')+','+(.26*(1-d)+.04)+')');bg.addColorStop(1,'rgba('+hazeC.join(',')+',0)');
    c.fillStyle=bg;c.fillRect(0,by-4,w,28);
  });
}

function initStars(R){
  stars=[];var n=Math.min(220,Math.round(W*H/9000));
  for(var i=0;i<n;i++){
    stars.push({x:R()*W,y:hy*Math.pow(R(),1.4)*.92,r:.35+R()*.9,a:.25+R()*.6,ph:R()*6.28,sp:.4+R()*1.6,v:R()<.2});
  }
}
function initBlades(R){
  midB=[[],[],[],[],[]];
  var n=Math.round(W/4.2),i;
  for(i=0;i<n;i++){
    var f=R(),y=hy+6+Math.pow(f,1.2)*(H-hy-4),depth=(y-hy)/(H-hy);
    var h=lerp(7,50,depth)*(.55+R()*.9);
    midB[Math.min(4,Math.floor(depth*5))].push({x:R()*W,y:y,h:h,lean:(R()-.5)*.5,ph:R()*6.28});
  }
  midB.forEach(function(b){b.sort(function(a,c){return a.y-c.y})});
  frontB=[];var m=Math.round(W/12);
  for(i=0;i<m;i++){
    frontB.push({x:R()*W,h:lerp(34,Math.min(120,H*.16),Math.pow(R(),.8)),lean:(R()-.5)*.6,ph:R()*6.28,k:R()<.7?0:1,seed:R()<.1,fl:R()<.09,tx:0,ty:0});
  }
}
function initPollen(R){
  pol=[];var n=Math.round(Math.min(60,W/26));
  for(var i=0;i<n;i++){
    pol.push({x:R()*W,y:R()*H,r:.6+R()*1.3,vx:.1+R()*.25,vy:-(.05+R()*.2),ph:R()*6.28,a:.18+R()*.5,am:R()<.12});
  }
}

function build(){
  W=window.innerWidth;H=window.innerHeight;DPR=Math.min(2,window.devicePixelRatio||1);hy=H*HZ;
  sx=fit(cStars,W,H);fx=fit(cFar,W+60,H);lx=fit(cLife,W,H);rx=fit(cFront,W,H);
  var R=rng(11);
  drawFar(R);initStars(R);initBlades(R);initPollen(R);
  if(reduce){drawStars(2);drawLife(2,0,false);drawFront(2)}
}

function wind(x,t){return (Math.sin(t*.55+x*.0036)*.55+Math.sin(t*1.35+x*.012)*.22)*(.65+.35*Math.sin(t*.14))}
function push(x,yMid){
  var dx=x-P.x;if(dx>110||dx<-110)return 0;
  var dy=yMid-P.y;if(dy>150||dy<-150)return 0;
  var k=(1-Math.abs(dx)/110)*(1-Math.abs(dy)/150);
  return (dx<0?-1:1)*k*k;
}
function drawStars(t){
  sx.clearRect(0,0,W,H);
  for(var i=0;i<stars.length;i++){
    var s=stars[i],a=s.a*(.6+.4*Math.sin(t*s.sp+s.ph));
    sx.fillStyle=s.v?'rgba(200,196,236,'+a+')':'rgba(232,236,220,'+a+')';
    sx.beginPath();sx.arc(s.x,s.y,s.r,0,6.283);sx.fill();
  }
}
var midCols=['rgba(78,102,70,.85)','rgba(88,120,76,.9)','rgba(104,142,84,.95)','rgba(120,160,92,1)','rgba(138,182,104,1)'];
var midW=[.8,1,1.2,1.5,1.9];
function drawLife(t,dt,live){
  var c=lx,b,i,g;
  c.clearRect(0,0,W,H);
  c.lineCap='round';
  for(b=0;b<5;b++){
    c.strokeStyle=midCols[b];c.lineWidth=midW[b];c.beginPath();
    var arr=midB[b];
    for(i=0;i<arr.length;i++){
      g=arr[i];
      var d=(wind(g.x,t)+g.lean)*g.h*.5+Math.sin(t*2.1+g.ph)*g.h*.04+push(g.x,g.y-g.h*.5)*g.h*.9;
      c.moveTo(g.x,g.y);
      c.quadraticCurveTo(g.x+d*.2,g.y-g.h*.65,g.x+d,g.y-g.h*(1-Math.min(.4,Math.abs(d)/g.h*.25)));
    }
    c.stroke();
  }
  for(i=0;i<pol.length;i++){
    var p=pol[i];
    if(live){
      p.x+=(p.vx+Math.sin(t*.7+p.ph)*.12)*dt*60;p.y+=p.vy*dt*60;
      if(p.y<-10){p.y=H+10;p.x=Math.random()*W}
      if(p.x>W+10)p.x=-10;
    }
    c.fillStyle=p.am?'rgba(240,138,60,'+(p.a*.12)+')':'rgba(230,236,214,'+(p.a*.12)+')';
    c.beginPath();c.arc(p.x,p.y,p.r*3.4,0,6.283);c.fill();
    c.fillStyle=p.am?'rgba(240,160,90,'+p.a+')':'rgba(230,236,214,'+p.a+')';
    c.beginPath();c.arc(p.x,p.y,p.r,0,6.283);c.fill();
  }
  if(live){
    if(t>nextFlock){
      var n=5+Math.floor(Math.random()*4);
      flocks.push({t0:t,y:H*(.12+Math.random()*.28),dir:Math.random()<.5?1:-1,n:n,sp:W/(46+Math.random()*20),s:3.2+Math.random()*2.2,ph:Math.random()*6.28});
      nextFlock=t+38+Math.random()*32;
    }
    for(i=flocks.length-1;i>=0;i--){
      var f=flocks[i],el=t-f.t0,x0=f.dir>0?-80+el*f.sp:W+80-el*f.sp;
      if(x0>W+200||x0<-200){flocks.splice(i,1);continue}
      c.strokeStyle='rgba(214,220,200,.6)';c.lineWidth=1.2;
      for(var j=0;j<f.n;j++){
        var k=Math.ceil(j/2)*(j%2?1:-1);
        var bx=x0-f.dir*Math.abs(k)*22,by=f.y+k*9+Math.sin(el*.6+f.ph)*8;
        var fl=Math.sin(el*7+j*1.3)*f.s*.6;
        c.beginPath();c.moveTo(bx-f.s*1.6,by+fl);
        c.quadraticCurveTo(bx-f.s*.5,by-f.s*.5,bx,by);
        c.quadraticCurveTo(bx+f.s*.5,by-f.s*.5,bx+f.s*1.6,by+fl);c.stroke();
      }
    }
  }
}
function drawFront(t){
  var c=rx,i,g,k;
  c.clearRect(0,0,W,H);
  c.lineCap='round';
  var by=H+4;
  for(k=0;k<2;k++){
    c.strokeStyle=k===0?'rgba(126,172,98,.96)':'rgba(58,98,64,.96)';
    c.lineWidth=k===0?2.2:3;
    c.beginPath();
    for(i=0;i<frontB.length;i++){
      g=frontB[i];if(g.k!==k)continue;
      var d=(wind(g.x,t)*1.2+g.lean)*g.h*.5+Math.sin(t*2.1+g.ph)*g.h*.04+push(g.x,by-g.h*.5)*g.h*.9;
      var ty=by-g.h*(1-Math.min(.4,Math.abs(d)/g.h*.25));
      g.tx=g.x+d;g.ty=ty;
      c.moveTo(g.x,by);c.quadraticCurveTo(g.x+d*.2,by-g.h*.65,g.x+d,ty);
    }
    c.stroke();
  }
  for(i=0;i<frontB.length;i++){
    g=frontB[i];
    if(g.seed){c.fillStyle='rgba(240,138,60,.95)';c.beginPath();c.arc(g.tx,g.ty,2.6,0,6.283);c.fill()}
    else if(g.fl){
      c.fillStyle='rgba(176,170,222,.95)';c.beginPath();c.arc(g.tx,g.ty,3.4,0,6.283);c.fill();
      c.fillStyle='rgba(236,238,222,.95)';c.beginPath();c.arc(g.tx,g.ty,1.1,0,6.283);c.fill();
    }
  }
}

var last=performance.now(),raf=0;
function frame(now){
  var dt=Math.min(.05,(now-last)/1000);last=now;T+=dt;
  var e=Math.min(1,dt*8);
  P.x+=(M.x-P.x)*e;P.y+=(M.y-P.y)*e;
  var nx=((P.x<-900?W/2:P.x)/W-.5)*2;
  cFar.style.transform='translate3d('+(-nx*14).toFixed(2)+'px,0,0)';
  cStars.style.transform='translate3d('+(-nx*4).toFixed(2)+'px,0,0)';
  drawStars(T);drawLife(T,dt,true);drawFront(T);
  raf=requestAnimationFrame(frame);
}
window.addEventListener('pointermove',function(e){M.x=e.clientX;M.y=e.clientY},{passive:true});
window.addEventListener('pointerleave',function(){M.x=-999;M.y=-999});
var rt=0;
window.addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(build,150)});
document.addEventListener('visibilitychange',function(){
  if(reduce)return;
  if(document.hidden){cancelAnimationFrame(raf)}else{last=performance.now();raf=requestAnimationFrame(frame)}
});

/* anillo del visor */
(function(){
  var s='',i;
  s+='<circle r="470" fill="none" stroke="rgba(228,232,218,.22)"/>';
  s+='<circle r="446" fill="none" stroke="rgba(228,232,218,.16)" stroke-dasharray="2 9"/>';
  s+='<g class="spin">';
  for(i=0;i<72;i++){
    var big=i%6===0;
    s+='<line x1="0" y1="-470" x2="0" y2="'+(-(470-(big?20:(i%2?6:10))))+'" transform="rotate('+(i*5)+')" stroke="rgba(228,232,218,'+(big?.5:.28)+')"/>';
  }
  var lab=['N','30','60','E','120','150','S','210','240','O','300','330'];
  for(i=0;i<12;i++){s+='<text transform="rotate('+(i*30)+') translate(0,-424)" text-anchor="middle">'+lab[i]+'</text>'}
  s+='</g><g class="spin2"><circle r="300" fill="none" stroke="rgba(228,232,218,.12)"/>';
  for(i=0;i<24;i++){s+='<circle cx="0" cy="-300" r="1.8" transform="rotate('+(i*15)+')" fill="rgba(228,232,218,.4)"/>'}
  s+='</g><path d="M-8 -498 L8 -498 L0 -482 Z" fill="#f08a3c"/>';
  $('#ring').innerHTML=s;
})();

build();
if(!reduce){raf=requestAnimationFrame(frame)}

V.scene={rebuild:build};
})(window.Valle=window.Valle||{});
