const socket=io();let state=null,team=null,gameCode="",scanner=null,map=null,myMarker=null,markers=new Map(),myPos=null;
const $=id=>document.getElementById(id);
function allowed(o){return o.team===team||o.team==="BOTH"}
function visible(){
 const a=state.objects.filter(allowed).sort((x,y)=>x.order-y.order);
 if(state.visibility==="all")return a;
 const done=a.filter(o=>o.captured?.[team]||o.discovered?.[team]);
 const next=a.find(o=>!o.captured?.[team]&&!o.discovered?.[team]);
 return next?[...done,next]:done;
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function render(){
 if(!state)return;
 $("score").textContent=`${team}: ${state.scores[team]} pts`;
 $("status").textContent=state.started?"🟢 JOGO EM CURSO":"🟠 JOGO PARADO";
 const a=visible(); $("objects").innerHTML=a.map(o=>{
   const done=o.captured?.[team]; return `<div class="card"><b>${esc(o.name)}</b> <span class="tag">${esc(o.team)}</span><br>${esc(o.desc)}<br><span class="small">${done?"✓ CAPTURADO":"🎯 OBJETIVO ATIVO"} · ${o.points} pts · raio ${o.radius} m</span>${o.photo?`<br><img class="objphoto" src="${o.photo}">`:""}</div>`;
 }).join("")||"<div class='small'>Nenhum objetivo disponível.</div>";
 for(const [id,m] of markers)if(!a.some(o=>o.id===id)){map.removeLayer(m);markers.delete(id)}
 a.forEach(o=>{
   const pos=[o.lat,o.lon],html=`<b>${esc(o.name)}</b><br>${esc(o.desc)}<br>${o.captured?.[team]?"✓ CAPTURADO":"🎯 ATIVO"} · ${o.points} pts${o.photo?`<br><img class="objphoto" src="${o.photo}">`:""}`;
   if(markers.has(o.id))markers.get(o.id).setLatLng(pos).setPopupContent(html);else markers.set(o.id,L.marker(pos).addTo(map).bindPopup(html));
 });
}
function startGPS(){
 if(!navigator.geolocation)return;
 navigator.geolocation.watchPosition(p=>{myPos={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy};if(!myMarker)myMarker=L.marker([myPos.lat,myPos.lon]).addTo(map).bindPopup("A minha posição");else myMarker.setLatLng([myPos.lat,myPos.lon]);socket.emit("gps",myPos)},e=>$("status").textContent="GPS: "+e.message,{enableHighAccuracy:true,maximumAge:2000,timeout:15000});
}
$("join").onclick=()=>{gameCode=$("game").value.trim().toUpperCase();team=$("team").value;socket.emit("player_join",{gameCode,name:$("name").value,team},r=>{if(!r.ok)return $("err").textContent=r.error;$("login").classList.add("hidden");$("main").classList.remove("hidden");$("top").classList.remove("hidden");$("who").textContent=$("name").value+" · "+team;map=L.map("map").setView([39.5,-8],7);L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:20,attribution:"Tiles © Esri"}).addTo(map);startGPS()})};
$("gps").onclick=()=>{if(myPos)map.setView([myPos.lat,myPos.lon],18)};
$("scan").onclick=async()=>{if(!state?.started)return alert("O jogo ainda não começou.");$("qrbox").classList.remove("hidden");scanner=new Html5Qrcode("reader");try{await scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:260,height:260}},txt=>{const o=visible().find(x=>String(x.qr)===String(txt).trim());if(!o)return alert("QR não corresponde ao objetivo ativo.");scanner.stop().then(()=>{$("qrbox").classList.add("hidden");socket.emit("capture",{objectId:o.id,qr:txt},r=>{if(!r.ok)alert(r.error)})})},()=>{})}catch(e){alert("Não foi possível abrir a câmara: "+e)}};
$("closeScan").onclick=()=>{if(scanner)scanner.stop().catch(()=>{});$("qrbox").classList.add("hidden")};
socket.on("state",s=>{state=s;render()});