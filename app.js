(function(){
"use strict";
/* ---------- settings: change these for your project ---------- */
var CFG={
  API_URL:"",            // optional: your server URL returning [{id,crowd,supply}]. Empty = simulated data.
  BOT_URL:"",            // optional: your server that talks to a real LLM. POST {message,context} -> {reply}. Empty = built-in assistant.
  REFRESH_MS:3000, OCC:.85, SHARE:.07,
  HIST_MIN:60,           // minutes of history shown on the chart
  CYCLE_MIN:60           // trains and flights repeat about every hour (used by the forecast)
};
var ZONES=[
 {id:"ndls",name:"New Delhi Railway Station",kind:"Railway",x:300,y:190,lat:28.6430,lng:77.2197,sup:90,dir:"bottom",
  arr:[["12301 Rajdhani",1100,12],["12002 Shatabdi",1000,25],["12559 Garib Rath",1400,38],["12137 Punjab Mail",1300,51]]},
 {id:"odls",name:"Old Delhi Railway Station",kind:"Railway",x:380,y:70,lat:28.6616,lng:77.2273,sup:70,dir:"top",
  arr:[["12951 Mumbai Rajdhani",1000,18],["12311 Kalka Mail",1100,44]]},
 {id:"igi",name:"IGI Airport Terminal 3",kind:"Airport",x:95,y:300,lat:28.5562,lng:77.1000,sup:80,dir:"top",
  arr:[["Flight wave A (3 flights)",780,15],["Flight wave B (4 flights)",1040,40]]},
 {id:"jln",name:"Jawaharlal Nehru Stadium",kind:"Stadium",x:480,y:320,lat:28.5828,lng:77.2339,sup:45,dir:"bottom",
  arr:[["Event exit (venue capacity)",3600,30]]}
];
/* ---------- helpers ---------- */
var $=function(i){return document.getElementById(i)};
var store={
  get:function(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},
  set:function(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},
  del:function(k){try{localStorage.removeItem(k)}catch(e){}}
};
var RANK={low:0,green:1,orange:2,red:3},COL={red:"var(--red)",orange:"var(--orange)",green:"var(--green)",low:"var(--low)"};
var HEX={red:"#ff4d3d",orange:"#ff9f1c",green:"#2ecc71",low:"#5b8def"};
var LABEL={red:"High demand",orange:"Medium",green:"Balanced",low:"Low"};
function lv(r){return r>=1.5?"red":r>=1?"orange":r>=.6?"green":"low"}
function level(r,prev){ /* hysteresis so colours do not flicker */
  var up=lv(r); if(!prev||RANK[up]>=RANK[prev])return up;
  var dn=lv(r+.08); return RANK[dn]<RANK[prev]?dn:prev;
}
/* ---------- app state ---------- */
var T0=Date.now();
var S={sel:"ndls",pcab:2,online:store.get("online")!==false,mode:"sim",t:0,timer:null,pos:null,user:null,hz:60,hover:null};
ZONES.forEach(function(z){z.lvl=null;z.ratio=0;z.crowd=0;z.need=0;z.supply=z.sup;z.wob=1});
function byId(id){return ZONES.filter(function(x){return x.id===id})[0]}
function sel(){return byId(S.sel)}
function seats(z){return z.arr.reduce(function(a,x){return a+x[1]},0)}
function dist(z){
  if(!S.pos)return null;var R=6371,r=Math.PI/180,dl=(z.lat-S.pos.lat)*r,dn=(z.lng-S.pos.lng)*r;
  var a=Math.sin(dl/2)*Math.sin(dl/2)+Math.cos(S.pos.lat*r)*Math.cos(z.lat*r)*Math.sin(dn/2)*Math.sin(dn/2);
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function pull(){
  if(!CFG.API_URL)return Promise.resolve(null);
  var c=typeof AbortController!=="undefined"?new AbortController():null,t=setTimeout(function(){c&&c.abort()},4000);
  return fetch(CFG.API_URL,{signal:c?c.signal:undefined}).then(function(r){clearTimeout(t);if(!r.ok)throw 0;return r.json()}).catch(function(){clearTimeout(t);return null});
}

/* ---------- history and forecast ---------- */
var HIST={};   // zone id -> [{t,crowd,supply}]
/* Demand "shape": a baseline plus a bump after each arrival (trains/flights repeat every CYCLE_MIN, events do not). */
function waves(z,m){
  var elapsed=(Date.now()-T0)/60000,n=z.arr.length,tot=seats(z),s=.4,ks=z.kind==="Stadium"?[0]:[-3,-2,-1,0,1,2];
  z.arr.forEach(function(a){
    var amp=a[1]/tot*n,base=a[2]-elapsed+6;
    ks.forEach(function(k){var d=(m-(base+k*CFG.CYCLE_MIN))/7;s+=.6*amp*Math.exp(-d*d/2)});
  });
  return s;
}
function band(m){return .08+.004*m}
/* predicted people and cabs needed for the next 60 minutes, every 2 minutes, scaled to the current live reading */
function forecast(z){
  var s0=waves(z,0),out=[];
  for(var m=0;m<=60;m+=2){var c=Math.max(0,Math.round(z.crowd*waves(z,m)/s0));out.push({m:m,crowd:c,need:Math.ceil(c/S.pcab)})}
  return out;
}
function peak(f){var b=f[0];f.forEach(function(p){if(p.need>b.need)b=p});return b}
function seed(z){ /* simulated past hour so the chart is not empty on first open */
  var now=Date.now(),c0=seats(z)*CFG.OCC*CFG.SHARE,s0=waves(z,0),arr=[];
  for(var m=-CFG.HIST_MIN;m<0;m++){
    var noise=1+Math.sin(m*1.7+z.x)*.05+Math.sin(m*.6)*.03;
    arr.push({t:now+m*60000,crowd:Math.round(c0*waves(z,m)/s0*noise),supply:Math.max(10,Math.round(z.sup*(1+Math.sin(m/9+z.y)*.12)))});
  }
  HIST[z.id]=arr;
}
function record(z){
  var a=HIST[z.id],cut=Date.now()-CFG.HIST_MIN*60000;a.push({t:Date.now(),crowd:z.crowd,supply:z.supply});
  while(a.length&&a[0].t<cut)a.shift();
}
function etaTxt(z,a){
  var e=a[2]-(Date.now()-T0)/60000;if(z.kind!=="Stadium")e=((e%60)+60)%60;
  return e<0?"Done":e<1?"Now":Math.round(e)+" min";
}
function summary(z){
  var f=forecast(z).filter(function(p){return p.m<=S.hz}),pk=peak(f),gap=pk.need-z.supply,when=pk.m<=0?"right now":"in "+pk.m+" min";
  if(gap>0)return z.name+": demand peaks "+when+" at about "+pk.need+" cabs needed vs "+z.supply+" nearby. Expect a shortfall of about "+gap+" cabs.";
  return z.name+": demand peaks "+when+" at about "+pk.need+" cabs needed. The "+z.supply+" cabs nearby should cover it.";
}

/* ---------- satellite map (Leaflet + Esri World Imagery) ---------- */
var MAP={m:null,zones:{},me:null};
function initMap(){
  if(typeof L==="undefined"){
    $("map").innerHTML='<p class="note" style="padding:24px">The satellite map needs an internet connection to load. The rest of the dashboard still works.</p>';return;
  }
  var ESRI="https://server.arcgisonline.com/ArcGIS/rest/services/";
  var m=L.map("map",{minZoom:8,maxZoom:19});
  var sat=L.tileLayer(ESRI+"World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:19,attribution:"Imagery &copy; Esri, Maxar, Earthstar Geographics"});
  var street=L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap contributors"});
  var names=L.tileLayer(ESRI+"Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",{maxZoom:19});
  sat.addTo(m);names.addTo(m);
  L.control.layers({"Satellite":sat,"Street":street},{"Place names":names},{position:"topright"}).addTo(m);
  var pts=[];
  ZONES.forEach(function(z){
    var c=L.circle([z.lat,z.lng],{radius:600,color:HEX.low,weight:3,fillColor:HEX.low,fillOpacity:.3}).addTo(m);
    var d=L.circleMarker([z.lat,z.lng],{radius:6,color:"#0d1015",weight:2,fillColor:"#fff",fillOpacity:1}).addTo(m);
    d.bindTooltip(z.name,{permanent:true,direction:z.dir,offset:[0,z.dir==="top"?-8:8],className:"zlabel"});
    [c,d].forEach(function(l){l.on("click",function(){S.sel=z.id;render()})});
    MAP.zones[z.id]={c:c,d:d};pts.push([z.lat,z.lng]);
  });
  var Ctl=L.Control.extend({options:{position:"topleft"},onAdd:function(){
    var d=L.DomUtil.create("div","leaflet-bar mapctl");
    d.innerHTML='<button type="button" data-a="me" title="Go to my location" aria-label="Go to my location">&#9678;</button><button type="button" data-a="fit" title="Show all zones" aria-label="Show all zones">&#10530;</button>';
    L.DomEvent.disableClickPropagation(d);
    d.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;
      if(b.dataset.a==="fit")m.fitBounds(pts,{padding:[50,50]});
      else if(S.pos)m.flyTo([S.pos.lat,S.pos.lng],14);else toast("Waiting for your location. Please allow location access.");});
    return d}});
  new Ctl().addTo(m);
  m.fitBounds(pts,{padding:[50,50]});
  MAP.m=m;
}
function updateMap(){
  if(!MAP.m)return;
  ZONES.forEach(function(z){
    var o=MAP.zones[z.id],k=z.lvl||"low",on=z.id===S.sel;
    o.c.setRadius(400+Math.min(z.ratio,2)*350);
    o.c.setStyle({color:HEX[k],fillColor:HEX[k],weight:on?5:3,fillOpacity:on?.42:.3});
    o.d.setTooltipContent(z.name+" \u00b7 "+LABEL[k]);
    o.d.bringToFront();
  });
}
function setMe(){
  if(!MAP.m||!S.pos)return;var ll=[S.pos.lat,S.pos.lng];
  if(!MAP.me)MAP.me=L.circleMarker(ll,{radius:8,color:"#fff",weight:3,fillColor:"#2b7fff",fillOpacity:1}).addTo(MAP.m).bindTooltip("You",{direction:"top"});
  else MAP.me.setLatLng(ll);
}

/* ---------- data update ---------- */
function update(data,quiet){
  S.t++;var live=Array.isArray(data);S.mode=!navigator.onLine?"off":live?"live":"sim";
  ZONES.forEach(function(z){
    var d=live?data.filter(function(x){return x.id===z.id})[0]:null,prev=z.lvl;
    if(d){z.crowd=Math.round(d.crowd);z.supply=Math.max(1,Math.round(d.supply))}
    else if(S.mode!=="off"){z.wob=1+Math.sin(S.t/3+z.x)*.07;z.crowd=Math.round(seats(z)*CFG.OCC*CFG.SHARE*z.wob);
      if(z.id!==S.sel||S.t%1===0)z.supply=Math.max(10,Math.min(300,z.supply+Math.round((Math.random()-.5)*6)))}
    z.need=Math.ceil(z.crowd/S.pcab);z.ratio=z.need/z.supply;z.lvl=level(z.ratio,prev);
    if(!quiet&&S.mode!=="off")record(z);
    if(S.online&&prev&&prev!=="red"&&z.lvl==="red")toast("Red zone: "+z.name+" needs more cabs");
  });
  render();
}
function loop(){pull().then(function(d){update(d)})}

/* ---------- render ---------- */
function render(){
  var m=S.mode,c=$("conn");
  c.style.setProperty("--c",m==="live"?"var(--green)":m==="sim"?"var(--y)":"var(--red)");
  c.textContent=m==="live"?"Live data":m==="sim"?"Demo data":"No internet";
  $("onTxt").textContent=S.online?"Online":"Offline";$("online").setAttribute("aria-checked",S.online);
  $("app").classList.toggle("off",!S.online);
  updateMap();
  /* list */
  var sorted=ZONES.slice().sort(function(a,b){return b.ratio-a.ratio});
  $("list").innerHTML=sorted.map(function(z){var k=z.lvl||"low",d=dist(z);
    return '<button class="zc" data-id="'+z.id+'" aria-pressed="'+(z.id===S.sel)+'"><span class="bar" style="background:'+COL[k]+'"></span>'+
      '<span><b>'+z.name+'</b><small>'+z.need+' cabs needed · '+z.supply+' nearby'+(d!==null?' · '+d.toFixed(1)+' km away':'')+'</small>'+
      '<a class="go" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination='+z.lat+','+z.lng+'">Navigate</a></span>'+
      '<span class="badge '+k+'">'+LABEL[k]+'</span></button>'}).join("");
  /* detail */
  var z=sel(),k=z.lvl||"low";
  var h='<div class="row" style="margin-top:0"><h3 style="margin:0">'+z.name+'</h3><span class="badge '+k+'">'+LABEL[k]+'</span></div>'+
   '<div class="kpis"><div class="kpi"><b>'+z.crowd+'</b><span>people expected</span></div><div class="kpi"><b>'+z.need+'</b><span>cabs needed</span></div><div class="kpi"><b>'+z.supply+'</b><span>cabs nearby</span></div></div>'+
   '<div class="row"><span>People sharing one cab</span><div class="seg" id="split">'+[1,2,3].map(function(n){return '<button data-n="'+n+'" aria-pressed="'+(S.pcab===n)+'">'+n+'</button>'}).join("")+'</div></div>';
  if(S.mode!=="live")h+='<label for="sup" class="note" style="display:block;margin:0">Cabs nearby (demo control): <b>'+z.supply+'</b></label><input type="range" id="sup" min="10" max="300" value="'+z.supply+'">';
  h+='<table style="margin-top:12px"><thead><tr><th>Arrivals and events</th><th>People</th><th>In</th></tr></thead><tbody>'+
   z.arr.map(function(x){return '<tr><td>'+x[0]+'</td><td>'+x[1]+'</td><td>'+etaTxt(z,x)+'</td></tr>'}).join("")+'</tbody></table>';
  var a=document.activeElement&&document.activeElement.id==="sup";
  if(!a){$("detail").innerHTML=h}else{ /* keep slider drag smooth */
    var q=$("detail").querySelectorAll(".kpi b");q[0].textContent=z.crowd;q[1].textContent=z.need;q[2].textContent=z.supply}
  /* forecast */
  var sm=summary(z);
  $("fctitle").textContent="History vs prediction: "+z.name;$("fsum").textContent=sm;$("chart").setAttribute("aria-label",sm);
  [].forEach.call($("hz").querySelectorAll("button"),function(b){b.setAttribute("aria-pressed",+b.dataset.h===S.hz)});
  drawChart();
}

/* ---------- history vs prediction chart (canvas) ---------- */
var PAD={l:40,r:14,t:12,b:26};
function niceMax(v){var p=Math.pow(10,Math.floor(Math.log(v)/Math.LN10)),f=v/p;return(f<=1?1:f<=2?2:f<=5?5:10)*p}
function drawChart(){
  var cv=$("chart");if(!cv||!cv.clientWidth)return;
  var z=sel(),dpr=window.devicePixelRatio||1,w=cv.clientWidth,h=cv.clientHeight,now=Date.now();
  if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr)}
  var x=cv.getContext("2d");x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,w,h);
  var cs=getComputedStyle(document.documentElement),mute=cs.getPropertyValue("--mute").trim()||"#98a2b0",grid=cs.getPropertyValue("--line").trim()||"#2a323d",ink=cs.getPropertyValue("--ink").trim()||"#f4f1e8";
  var W0=CFG.HIST_MIN,H=S.hz,iw=w-PAD.l-PAD.r,ih=h-PAD.t-PAD.b;
  var hist=(HIST[z.id]||[]).map(function(p){return{m:(p.t-now)/60000,v:Math.ceil(p.crowd/S.pcab),s:p.supply}});
  var fc=forecast(z).filter(function(p){return p.m<=H});
  var ymax=z.supply;
  hist.forEach(function(p){ymax=Math.max(ymax,p.v,p.s)});
  fc.forEach(function(p){ymax=Math.max(ymax,p.need*(1+band(p.m)))});
  ymax=niceMax(ymax*1.1);
  function X(m){return PAD.l+(m+W0)/(W0+H)*iw}
  function Y(v){return PAD.t+ih-v/ymax*ih}
  /* grid + axes */
  x.font="12px system-ui,sans-serif";x.textBaseline="middle";x.lineWidth=1;
  for(var i=0;i<=4;i++){var v=ymax*i/4,yy=Math.round(Y(v))+.5;
    x.strokeStyle=grid;x.beginPath();x.moveTo(PAD.l,yy);x.lineTo(w-PAD.r,yy);x.stroke();
    x.fillStyle=mute;x.textAlign="right";x.fillText(Math.round(v),PAD.l-6,yy)}
  x.textAlign="center";x.textBaseline="top";
  for(var m=-W0;m<=H;m+=15){x.fillStyle=m===0?ink:mute;x.textAlign=m===H?"right":m===-W0?"left":"center";x.fillText(m===0?"Now":(m>0?"+":"")+m+"m",X(m),h-PAD.b+7)}
  /* future shading + now line */
  x.fillStyle="rgba(91,141,239,.07)";x.fillRect(X(0),PAD.t,w-PAD.r-X(0),ih);
  x.strokeStyle=mute;x.setLineDash([4,4]);x.beginPath();x.moveTo(X(0)+.5,PAD.t);x.lineTo(X(0)+.5,PAD.t+ih);x.stroke();x.setLineDash([]);
  /* confidence band */
  x.fillStyle="rgba(91,141,239,.2)";x.beginPath();
  fc.forEach(function(p,j){var px=X(p.m),py=Y(p.need*(1+band(p.m)));j?x.lineTo(px,py):x.moveTo(px,py)});
  for(var j=fc.length-1;j>=0;j--)x.lineTo(X(fc[j].m),Y(fc[j].need*(1-band(fc[j].m))));
  x.closePath();x.fill();
  /* cabs nearby */
  x.strokeStyle="#2ecc71";x.lineWidth=2;x.beginPath();
  hist.forEach(function(p,j){j?x.lineTo(X(p.m),Y(p.s)):x.moveTo(X(p.m),Y(p.s))});
  x.lineTo(X(0),Y(z.supply));x.lineTo(X(H),Y(z.supply));x.stroke();
  /* history */
  x.strokeStyle="#ffc933";x.lineWidth=2.6;x.lineJoin="round";x.beginPath();
  hist.forEach(function(p,j){j?x.lineTo(X(p.m),Y(p.v)):x.moveTo(X(p.m),Y(p.v))});
  x.lineTo(X(0),Y(z.need));x.stroke();
  /* prediction (red where it goes above cabs nearby) */
  x.lineWidth=2.6;x.setLineDash([7,5]);
  for(var n=1;n<fc.length;n++){var a=fc[n-1],b=fc[n];
    x.strokeStyle=(a.need>z.supply||b.need>z.supply)?"#ff4d3d":"#5b8def";
    x.beginPath();x.moveTo(X(a.m),Y(a.need));x.lineTo(X(b.m),Y(b.need));x.stroke()}
  x.setLineDash([]);
  x.fillStyle="#fff";x.beginPath();x.arc(X(0),Y(z.need),4.5,0,7);x.fill();
  /* hover readout */
  if(S.hover!==null){
    var m0=S.hover,txt,px,py;
    if(m0<=0&&hist.length){var bp=hist[0];hist.forEach(function(p){if(Math.abs(p.m-m0)<Math.abs(bp.m-m0))bp=p});
      txt=Math.round(-bp.m)+" min ago: "+bp.v+" needed, "+bp.s+" nearby";px=X(bp.m);py=Y(bp.v)}
    else{var fp=fc[0];fc.forEach(function(p){if(Math.abs(p.m-m0)<Math.abs(fp.m-m0))fp=p});
      txt=(fp.m?"In "+fp.m+" min: predicted ":"Now: ")+fp.need+" needed, "+z.supply+" nearby";px=X(fp.m);py=Y(fp.need)}
    x.strokeStyle=mute;x.lineWidth=1;x.beginPath();x.moveTo(px+.5,PAD.t);x.lineTo(px+.5,PAD.t+ih);x.stroke();
    x.fillStyle="#fff";x.beginPath();x.arc(px,py,4,0,7);x.fill();
    x.font="bold 12.5px system-ui,sans-serif";var tw=x.measureText(txt).width+16,tx=Math.min(Math.max(px-tw/2,PAD.l),w-PAD.r-tw);
    x.fillStyle="rgba(13,16,21,.92)";x.strokeStyle=grid;x.beginPath();
    if(x.roundRect)x.roundRect(tx,PAD.t+4,tw,24,8);else x.rect(tx,PAD.t+4,tw,24);x.fill();x.stroke();
    x.fillStyle=ink;x.textAlign="left";x.textBaseline="middle";x.fillText(txt,tx+8,PAD.t+16);
  }
}
(function(){
  var cv=$("chart");
  function m2(e){var r=cv.getBoundingClientRect(),iw=r.width-PAD.l-PAD.r,m=(e.clientX-r.left-PAD.l)/iw*(CFG.HIST_MIN+S.hz)-CFG.HIST_MIN;return Math.max(-CFG.HIST_MIN,Math.min(S.hz,m))}
  cv.addEventListener("pointermove",function(e){S.hover=m2(e);drawChart()});
  cv.addEventListener("pointerdown",function(e){S.hover=m2(e);drawChart()});
  cv.addEventListener("pointerleave",function(){S.hover=null;drawChart()});
  window.addEventListener("resize",drawChart);
})();

/* ---------- events ---------- */
function pick(e){var t=e.target.closest("[data-id]");if(t&&!e.target.closest(".go")){S.sel=t.dataset.id;render()}}
$("list").addEventListener("click",pick);
$("detail").addEventListener("click",function(e){var b=e.target.closest("#split button");if(b){S.pcab=+b.dataset.n;update(null,true)}});
$("detail").addEventListener("input",function(e){if(e.target.id==="sup"){var z=sel();z.supply=+e.target.value;
  z.need=Math.ceil(z.crowd/S.pcab);z.ratio=z.need/z.supply;z.lvl=level(z.ratio,z.lvl);render()}});
$("hz").addEventListener("click",function(e){var b=e.target.closest("button");if(b){S.hz=+b.dataset.h;render()}});
$("online").onclick=function(){S.online=!S.online;store.set("online",S.online);render()};
function toast(m){var t=$("toast");t.textContent=m;t.classList.add("on");clearTimeout(toast.h);toast.h=setTimeout(function(){t.classList.remove("on")},4200)}
window.addEventListener("online",loop);window.addEventListener("offline",function(){S.mode="off";render()});

/* ---------- ZoneBot: AI assistant ---------- */
function snapshot(){
  return{selected:S.sel,mode:S.mode,peoplePerCab:S.pcab,online:S.online,zones:ZONES.map(function(z){
    var pk=peak(forecast(z)),d=dist(z);
    return{id:z.id,name:z.name,kind:z.kind,level:LABEL[z.lvl||"low"],peopleExpected:z.crowd,cabsNeeded:z.need,cabsNearby:z.supply,
      distanceKm:d===null?null:+d.toFixed(1),peakNeededNext60:pk.need,peakInMinutes:pk.m}})};
}
function zoneBy(q){
  var R=[["odls",/old delhi|odls|purani/],["ndls",/new delhi|ndls/],["igi",/airport|igi|terminal|flight/],["jln",/stadium|nehru|jln|event|match|concert/]];
  for(var i=0;i<R.length;i++)if(R[i][1].test(q))return byId(R[i][0]);return null;
}
function when(m){return m<=0?"right now":"in "+m+" min"}
function statusReply(z){
  var k=z.lvl||"low",pk=peak(forecast(z));
  return{text:"**"+z.name+"** is **"+LABEL[k]+"**: about "+z.crowd+" people expected, so "+z.need+" cabs needed vs "+z.supply+" nearby.\nPeak demand in the next hour: ~"+pk.need+" cabs "+when(pk.m)+".",nav:z};
}
function forecastReply(z){
  var f=forecast(z),pk=peak(f),p30=f.filter(function(p){return p.m===30})[0];
  var gap=pk.need-z.supply;
  return{text:"**"+z.name+"** forecast: about "+p30.need+" cabs needed in 30 min, peaking at ~"+pk.need+" "+when(pk.m)+".\n"+
    (gap>0?"That is "+gap+" more than the "+z.supply+" cabs nearby, so a shortfall is likely.":"The "+z.supply+" cabs nearby should cover it."),nav:z};
}
function recReply(){
  var best=null,bs=-1e9;
  ZONES.forEach(function(z){var d=dist(z),sc=z.ratio-(d===null?0:.04*Math.min(d,25));if(sc>bs){bs=sc;best=z}});
  var pk=peak(forecast(best)),pre=S.online?"":"You are set to Offline, so switch Online to receive requests.\n";
  return{text:pre+"Head to **"+best.name+"**: "+best.need+" cabs needed vs "+best.supply+" nearby ("+LABEL[best.lvl||"low"]+")"+
    (dist(best)!==null?", "+dist(best).toFixed(1)+" km away":"")+".\nDemand there peaks "+when(pk.m)+" at ~"+pk.need+" cabs.",nav:best};
}
function busyReply(){
  var s=ZONES.slice().sort(function(a,b){return b.ratio-a.ratio}).slice(0,3);
  return{text:"Busiest zones now:\n"+s.map(function(z,i){return(i+1)+". **"+z.name+"**: "+LABEL[z.lvl||"low"]+", "+z.need+" needed vs "+z.supply+" nearby"}).join("\n")};
}
function nearReply(){
  if(!S.pos)return{text:"I can't see your location yet. Allow location access in your browser and I can rank zones by distance."};
  var s=ZONES.slice().sort(function(a,b){return dist(a)-dist(b)}),z=s[0];
  return{text:"Nearest zone is **"+z.name+"**, "+dist(z).toFixed(1)+" km away ("+LABEL[z.lvl||"low"]+", "+z.need+" needed vs "+z.supply+" nearby).",nav:z};
}
function local(q){
  var l=q.toLowerCase(),z=zoneBy(l),zz=z||sel();
  if(/navigate|direction|route|take me|go to/.test(l)&&z)return{text:"Opening directions to **"+z.name+"**.",nav:z};
  if(/predict|forecast|peak|later|next hour|next|expect|trend|soon|will/.test(l))return forecastReply(zz);
  if(/nearest|closest|near me|how far|distance/.test(l))return nearReply();
  if(/busiest|most demand|hotspot|hot spot|top zone|red/.test(l))return busyReply();
  if(/where|best|recommend|suggest|earn|should i|head|move|\bgo\b/.test(l))return recReply();
  if(z||/status|cabs|supply|how many|demand|need/.test(l))return statusReply(zz);
  if(/^(hi|hello|hey)\b/.test(l))return{text:"Hi! I can tell you where demand is highest, forecast the next hour for any zone, or find the nearest one. What would you like?"};
  return{text:"I can help with:\n- **Where should I go?**\n- **Busiest zone**\n- **Forecast** for a zone (e.g. \"forecast for the airport\")\n- **Nearest zone**\n- **Status** of a zone (e.g. \"how many cabs at the stadium\")"};
}
function ask(q){
  if(!CFG.BOT_URL)return Promise.resolve(local(q));
  var c=typeof AbortController!=="undefined"?new AbortController():null,t=setTimeout(function(){c&&c.abort()},9000);
  return fetch(CFG.BOT_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:q,context:snapshot()}),signal:c?c.signal:undefined})
    .then(function(r){clearTimeout(t);if(!r.ok)throw 0;return r.json()})
    .then(function(d){return d&&d.reply?{text:String(d.reply)}:local(q)})
    .catch(function(){clearTimeout(t);return local(q)});
}
function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function fmt(s){return esc(s).replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/\n/g,"<br>")}
function addMsg(who,text,nav){
  var d=document.createElement("div");d.className="msg from-"+who;
  if(who==="me")d.textContent=text;else d.innerHTML=fmt(text);
  if(nav){var a=document.createElement("a");a.className="go";a.target="_blank";a.rel="noopener";a.textContent="Navigate";
    a.href="https://www.google.com/maps/dir/?api=1&destination="+nav.lat+","+nav.lng;d.appendChild(document.createElement("br"));d.appendChild(a)}
  var log=$("botLog");log.appendChild(d);log.scrollTop=log.scrollHeight;return d;
}
function say(q){
  q=q.trim();if(!q)return;addMsg("me",q);var w=addMsg("bot","...");
  ask(q).then(function(r){w.remove();addMsg("bot",r.text,r.nav)});
}
var CHIPS=["Where should I go?","Busiest zone","Forecast next hour","Nearest zone"];
$("chips").innerHTML=CHIPS.map(function(c){return '<button type="button">'+c+'</button>'}).join("");
$("chips").addEventListener("click",function(e){var b=e.target.closest("button");if(b)say(b.textContent)});
$("botForm").addEventListener("submit",function(e){e.preventDefault();var i=$("botIn");say(i.value);i.value=""});
function botOpen(o){
  $("bot").hidden=!o;$("botBtn").setAttribute("aria-expanded",o);
  if(o){if(!$("botLog").children.length)addMsg("bot","Hi, I'm **ZoneBot**. Ask me where demand is high, what the next hour looks like, or which zone is closest.");$("botIn").focus()}
  else $("botBtn").focus();
}
$("botBtn").onclick=function(){botOpen($("bot").hidden)};
$("botX").onclick=function(){botOpen(false)};
$("bot").addEventListener("keydown",function(e){if(e.key==="Escape")botOpen(false)});

/* ---------- start / stop ---------- */
function start(s){
  S.user=s;$("who").textContent=s.name;
  if(navigator.geolocation)navigator.geolocation.watchPosition(function(p){S.pos={lat:p.coords.latitude,lng:p.coords.longitude};setMe();render()},function(){},{timeout:10000,maximumAge:30000,enableHighAccuracy:true});
  update(null);loop();clearInterval(S.timer);S.timer=setInterval(function(){if(!document.hidden)loop()},CFG.REFRESH_MS);
}
initMap();
ZONES.forEach(seed);
start({name:"Driver"});
})();
