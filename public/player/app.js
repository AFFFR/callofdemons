const socket=io();
let state=null,team=null,gameCode="",scanner=null,map=null,myMarker=null,markers=new Map(),teamMarkers=new Map(),myPos=null;
const $=id=>document.getElementById(id);
function allowed(o){return team==="BLUE"||o.team===team||o.team==="BOTH"}
function visible(){
 const a=state.objects.filter(allowed).sort((x,y)=>x.order-y.order);
 if(team==="BLUE")return a;
 if(state.visibility==="all")return a;
 const done=a.filter(o=>o.captured?.[team]||o.discovered?.[team]);
 const next=a.find(o=>!o.captured?.[team]&&!o.discovered?.[team]);
 return next?[...done,next]:done;
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function objectIcon(o){
 const ownCaptured=!!(o.captured&&o.captured[team]);
 const anyCaptured=!!(o.captured&&((o.captured.RED)||(o.captured.BLUE)));
 let cls="map-object";
 let symbol="🎯";
 if(ownCaptured){cls+=" captured";symbol="✓";}
 else if(anyCaptured){cls+=" captured-other";symbol="✓";}
 return L.divIcon({className:"aq-marker-wrap",html:'<div class="'+cls+'">'+symbol+'</div>',iconSize:[34,34],iconAnchor:[17,17],popupAnchor:[0,-17]});
}
function playerIcon(p,isMe){
 const cls=isMe?"map-player map-player-me":"map-player";
 const initial=(String(p.name||"J").trim().charAt(0)||"J").toUpperCase();
 return L.divIcon({className:"aq-marker-wrap",html:'<div class="'+cls+'">'+esc(initial)+'</div>',iconSize:[32,32],iconAnchor:[16,16],popupAnchor:[0,-16]});
}
function render(){
 if(!state)return;
 $("score").textContent=`${team}: ${state.scores[team]} pts`;
 $("status").textContent=state.started?"🟢 JOGO EM CURSO":"🟠 JOGO PARADO";
 const a=visible();
 $("objects").innerHTML=a.map(o=>{
   const capturable=o.team===team||o.team==="BOTH";
   const done=o.captured?.[team];
   const label=capturable?(done?"✓ CAPTURADO":"🎯 OBJETIVO ATIVO"):"👁 VISÍVEL — EQUIPA ADVERSÁRIA";
   return `<div class="card"><b>${esc(o.name)}</b> <span class="tag">${esc(o.team)}</span><br>${esc(o.desc)}<br><span class="small">${label} · ${o.points} pts · raio ${o.radius} m</span>${o.photo?`<br><img class="objphoto" src="${o.photo}">`:""}</div>`;
 }).join("")||"<div class='small'>Nenhum objetivo disponível.</div>";
 if(map){
   for(const [id,m] of markers)if(!a.some(o=>o.id===id)){map.removeLayer(m);markers.delete(id)}
   a.forEach(o=>{
     const pos=[o.lat,o.lon];
     const capturable=o.team===team||o.team==="BOTH";
     const ownCaptured=!!(o.captured&&o.captured[team]);
     const anyCaptured=!!(o.captured&&(o.captured.RED||o.captured.BLUE));
     const status=ownCaptured?"✓ CAPTURADO":(anyCaptured?"✓ CAPTURADO POR OUTRA EQUIPA":(capturable?"🎯 ATIVO":"👁 EQUIPA ADVERSÁRIA"));
     const html=`<b>${esc(o.name)}</b><br>${esc(o.desc)}<br>${status} · ${o.points} pts · raio ${o.radius} m${o.photo?`<br><img class="objphoto" src="${o.photo}">`:""}`;
     if(markers.has(o.id)){
       markers.get(o.id).setLatLng(pos).setPopupContent(html).setIcon(objectIcon(o));
     }else{
       markers.set(o.id,L.marker(pos,{icon:objectIcon(o)}).addTo(map).bindPopup(html));
     }
   });
   const teammateList=[];
   for(const id in state.players){if(Object.prototype.hasOwnProperty.call(state.players,id)){const p=state.players[id];if(p.team===team&&p.lat!=null&&p.lon!=null)teammateList.push(p)}}
   for(const [id,m] of teamMarkers){if(!teammateList.some(p=>p.id===id)){map.removeLayer(m);teamMarkers.delete(id)}}
   teammateList.forEach(p=>{
     const isMe=p.id===socket.id;
     const html=`<b>${esc(p.name)}</b><br>${esc(p.team)}${p.accuracy?`<br>Precisão GPS: ±${Math.round(p.accuracy)} m`:""}`;
     if(teamMarkers.has(p.id)){
       teamMarkers.get(p.id).setLatLng([p.lat,p.lon]).setPopupContent(html).setIcon(playerIcon(p,isMe));
     }else{
       teamMarkers.set(p.id,L.marker([p.lat,p.lon],{icon:playerIcon(p,isMe),zIndexOffset:isMe?500:400}).addTo(map).bindPopup(html));
     }
   });
 }
}
function startGPS(){
 if(!navigator.geolocation)return;
 navigator.geolocation.watchPosition(p=>{myPos={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy};if(!myMarker)myMarker=L.marker([myPos.lat,myPos.lon]).addTo(map).bindPopup("A minha posição");else myMarker.setLatLng([myPos.lat,myPos.lon]);socket.emit("gps",myPos)},e=>$("status").textContent="GPS: "+e.message,{enableHighAccuracy:true,maximumAge:2000,timeout:15000});
}
$("join").onclick=()=>{
 gameCode=$("game").value.trim().toUpperCase();team=$("team").value;
 socket.emit("player_join",{gameCode,name:$("name").value,team,password:$("password").value},r=>{
   if(!r||!r.ok){$("err").textContent=r&&r.error?r.error:"Erro ao entrar.";return;}
   $("login").classList.add("hidden");$("main").classList.remove("hidden");$("top").classList.remove("hidden");$("who").textContent=$("name").value+" · "+team;
   map=L.map("map").setView([39.5,-8],7);
   L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:20,attribution:"Tiles © Esri"}).addTo(map);
   startGPS();
 });
};
$("gps").onclick=()=>{if(myPos)map.setView([myPos.lat,myPos.lon],18)};
$("scan").onclick=async()=>{
 if(!state?.started)return alert("O jogo ainda não começou.");
 $("qrbox").classList.remove("hidden");scanner=new Html5Qrcode("reader");
 try{await scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:260,height:260}},txt=>{const o=visible().find(x=>String(x.qr)===String(txt).trim()&&(x.team===team||x.team==="BOTH"));if(!o)return alert("Este QR não corresponde a um objetivo que a tua equipa possa capturar.");scanner.stop().then(()=>{$("qrbox").classList.add("hidden");socket.emit("capture",{objectId:o.id,qr:txt},r=>{if(!r.ok)alert(r.error)})})},()=>{})}catch(e){alert("Não foi possível abrir a câmara: "+e)}
};
$("closeScan").onclick=()=>{if(scanner)scanner.stop().catch(()=>{});$("qrbox").classList.add("hidden")};
socket.on("state",s=>{state=s;render()});
