const express=require("express");
const path=require("path");
const http=require("http");
const crypto=require("crypto");
const QRCode=require("qrcode");
const {Server}=require("socket.io");

const app=express();
const server=http.createServer(app);
const io=new Server(server,{maxHttpBufferSize:8e6});
app.use(express.json({limit:"8mb"}));

const PUBLIC=path.join(__dirname,"public");
const PLAYER_DIR=path.join(PUBLIC,"player");
const GM_DIR=path.join(PUBLIC,"gm");
const PLAYER_INDEX=path.join(PLAYER_DIR,"index.html");
const GM_INDEX=path.join(GM_DIR,"index.html");

const GM_CODE=process.env.GM_CODE || "AQ-GM-2026";
const games=new Map();

const txt=(v,n)=>String(v??"").slice(0,n);
const okTeam=t=>["RED","BLUE","BOTH"].includes(t);
const allowed=(o,t)=>o.team===t||o.team==="BOTH";
function dist(a,b,c,d){
 const R=6371000,r=Math.PI/180;
 const x=Math.sin((c-a)*r/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin((d-b)*r/2)**2;
 return 2*R*Math.asin(Math.sqrt(x));
}
function newGame(redCode,blueCode){
 return {
   started:false,
   visibility:"discovery",
   teamCodes:{RED:redCode,BLUE:blueCode},
   objects:[],
   scores:{RED:0,BLUE:0},
   players:{}
 };
}
function visibleObjectsFor(g,role,team){
 if(role==="GM")return g.objects;
 if(team==="BLUE")return g.objects;
 return g.objects.filter(o=>allowed(o,"RED"));
}
function cleanGame(g,role,team){
 const players={};
 for(const p of Object.values(g.players)){
   if(role==="GM" || p.team===team) players[p.id]={...p};
 }
 return {
   started:g.started,
   visibility:g.visibility,
   objects:visibleObjectsFor(g,role,team),
   scores:g.scores,
   players,
  teamCodes:role==="GM" ? {...g.teamCodes} : null
 };
}
function emitState(gid){
 const g=games.get(gid); if(!g)return;
 for(const s of io.sockets.sockets.values()){
   if(s.data.gid!==gid)continue;
   s.emit("state",cleanGame(g,s.data.role,s.data.team));
 }
}
function nextOrder(g,team){
 const a=g.objects.filter(o=>allowed(o,team));
 return a.length?Math.max(...a.map(o=>o.order))+1:1;
}
function validTeamCode(v){
 return txt(v||"",60).trim();
}

app.get("/health",(_,res)=>res.json({ok:true,games:games.size}));
app.get("/debug",(_,res)=>res.json({
  cwd:process.cwd(),
  dirname:__dirname,
  publicExists:require("fs").existsSync(PUBLIC),
  playerExists:require("fs").existsSync(PLAYER_INDEX),
  gmExists:require("fs").existsSync(GM_INDEX)
}));
app.get("/qr",async(req,res)=>{
 try{
   const data=String(req.query.data||"").slice(0,500);
   if(!data)return res.status(400).send("missing data");
   const png=await QRCode.toBuffer(data,{type:"png",width:1000,margin:2,errorCorrectionLevel:"M"});
   res.set("Content-Type","image/png").set("Cache-Control","no-store").send(png);
 }catch(e){res.status(500).send("QR error");}
});

io.on("connection",s=>{
 s.on("create_game",(d,cb)=>{
   const code=txt(d?.gameCode||"",30).trim().toUpperCase();
   const gm=txt(d?.gmCode||"",80);
   const redCode=validTeamCode(d?.redCode);
   const blueCode=validTeamCode(d?.blueCode);
   if(!code||gm!==GM_CODE)return cb?.({ok:false,error:"Código GM inválido."});
   if(!redCode||!blueCode)return cb?.({ok:false,error:"É obrigatório definir os códigos das equipas RED e BLUE."});
   if(redCode===blueCode)return cb?.({ok:false,error:"Os códigos RED e BLUE têm de ser diferentes."});
   const g=newGame(redCode,blueCode);
   games.set(code,g);
   s.data={gid:code,role:"GM",team:"GM"};
   cb?.({ok:true,gameCode:code});
   emitState(code);
 });

 s.on("gm_login",(d,cb)=>{
   const code=txt(d?.gameCode||"",30).trim().toUpperCase();
   const gm=txt(d?.gmCode||"",80);
   if(gm!==GM_CODE||!games.has(code))return cb?.({ok:false,error:"Código da partida ou GM inválido."});
   s.data={gid:code,role:"GM",team:"GM"};
   cb?.({ok:true});
   emitState(code);
 });

 s.on("set_team_codes",(d,cb)=>{
   const {gid,role}=s.data,g=games.get(gid);
   if(!g||role!=="GM")return cb?.({ok:false,error:"Não autorizado."});
   const redCode=validTeamCode(d?.redCode);
   const blueCode=validTeamCode(d?.blueCode);
   if(!redCode||!blueCode)return cb?.({ok:false,error:"Os dois códigos são obrigatórios."});
   if(redCode===blueCode)return cb?.({ok:false,error:"Os códigos RED e BLUE têm de ser diferentes."});
   g.teamCodes={RED:redCode,BLUE:blueCode};
   cb?.({ok:true});
 });

 s.on("player_join",(d,cb)=>{
   const code=txt(d?.gameCode||"",30).trim().toUpperCase();
   const team=["RED","BLUE"].includes(d?.team)?d.team:null;
   const password=txt(d?.password||"",60).trim();
   if(!games.has(code)||!team)return cb?.({ok:false,error:"Partida/equipa inválida."});
   const g=games.get(code);
   if(!password || password!==g.teamCodes[team])return cb?.({ok:false,error:"Código da equipa inválido."});
   const name=txt(d?.name||"Jogador",40).trim()||"Jogador";
   g.players[s.id]={id:s.id,name,team,lat:null,lon:null,accuracy:null};
   s.data={gid:code,role:"PLAYER",team};
   cb?.({ok:true});
   emitState(code);
 });

 s.on("gps",d=>{
   const {gid,role}=s.data,g=games.get(gid),p=g?.players[s.id];
   const lat=Number(d?.lat),lon=Number(d?.lon);
   if(!g||!p||role!=="PLAYER"||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return;
   p.lat=lat;p.lon=lon;p.accuracy=Number(d?.accuracy)||null;
   emitState(gid);
 });

 s.on("add_object",(d,cb)=>{
   const {gid,role}=s.data,g=games.get(gid);
   if(!g||role!=="GM")return cb?.({ok:false,error:"Não autorizado."});
   const t=okTeam(d?.team)?d.team:"RED",lat=Number(d?.lat),lon=Number(d?.lon);
   if(!Number.isFinite(lat)||!Number.isFinite(lon))return cb?.({ok:false,error:"Coordenadas inválidas."});
   const o={
     id:crypto.randomUUID(),
     name:txt(d?.name||"Objetivo",80),
     desc:txt(d?.desc||"",1000),
     team:t,
     points:Math.max(0,Number(d?.points)||0),
     radius:Math.max(1,Number(d?.radius)||30),
     qr:txt(d?.qr||"",200),
     lat,lon,
     photo:typeof d?.photo==="string"?d.photo:null,
     captured:{RED:false,BLUE:false},
     discovered:{RED:false,BLUE:false},
     order:t==="BOTH"?Math.max(nextOrder(g,"RED"),nextOrder(g,"BLUE")):nextOrder(g,t)
   };
   g.objects.push(o);cb?.({ok:true});emitState(gid);
 });

 s.on("delete_object",(id,cb)=>{
   const {gid,role}=s.data,g=games.get(gid);
   if(!g||role!=="GM")return cb?.({ok:false,error:"Não autorizado."});
   g.objects=g.objects.filter(o=>o.id!==id);cb?.({ok:true});emitState(gid);
 });

 s.on("set_visibility",v=>{
   const {gid,role}=s.data,g=games.get(gid);
   if(g&&role==="GM"&&["all","discovery"].includes(v)){g.visibility=v;emitState(gid);}
 });

 s.on("set_started",v=>{
   const {gid,role}=s.data,g=games.get(gid);
   if(g&&role==="GM"){g.started=!!v;emitState(gid);}
 });

 s.on("reset",()=>{
   const {gid,role}=s.data,g=games.get(gid);
   if(g&&role==="GM"){
     for(const o of g.objects){
       o.captured={RED:false,BLUE:false};
       o.discovered={RED:false,BLUE:false};
     }
     g.scores={RED:0,BLUE:0};
     g.started=false;
     emitState(gid);
   }
 });

 s.on("capture",(d,cb)=>{
   const {gid,role,team}=s.data,g=games.get(gid),p=g?.players[s.id];
   if(!g||role!=="PLAYER"||!g.started)return cb?.({ok:false,error:"Jogo não iniciado."});
   const o=g.objects.find(x=>x.id===d?.objectId);
   if(!o||!allowed(o,team)||o.captured[team]||String(o.qr)!==String(d?.qr||"").trim())return cb?.({ok:false,error:"QR/objetivo inválido."});
   if(p.lat==null||p.lon==null)return cb?.({ok:false,error:"GPS ainda não disponível."});
   const meters=dist(p.lat,p.lon,o.lat,o.lon);
   if(meters>o.radius)return cb?.({ok:false,error:`Estás a ${Math.round(meters)} m. Aproxima-te até ${o.radius} m.`});
   if(g.visibility==="discovery"){
     const pending=g.objects.filter(x=>allowed(x,team)&&!x.captured[team]).sort((a,b)=>a.order-b.order)[0];
     if(pending&&pending.id!==o.id)return cb?.({ok:false,error:"Ainda tens de descobrir o objetivo anterior."});
   }
   o.discovered[team]=true;o.captured[team]=true;g.scores[team]+=o.points;
   cb?.({ok:true});emitState(gid);
 });

 s.on("disconnect",()=>{
   const {gid}=s.data||{},g=games.get(gid);
   if(g?.players[s.id]){delete g.players[s.id];emitState(gid);}
 });
});

app.get("/player",(_,res)=>res.sendFile(PLAYER_INDEX));
app.get("/player/",(_,res)=>res.sendFile(PLAYER_INDEX));
app.get("/player/index.html",(_,res)=>res.sendFile(PLAYER_INDEX));
app.get("/gm",(_,res)=>res.sendFile(GM_INDEX));
app.get("/gm/",(_,res)=>res.sendFile(GM_INDEX));
app.get("/gm/index.html",(_,res)=>res.sendFile(GM_INDEX));
app.use("/player",express.static(PLAYER_DIR));
app.use("/gm",express.static(GM_DIR));
app.use(express.static(PUBLIC));
app.use((req,res)=>res.status(404).send(`Airsoft Quest: rota não encontrada (${req.method} ${req.path})`));
server.listen(Number(process.env.PORT)||10000,"0.0.0.0",()=>console.log("Airsoft Quest online"));
