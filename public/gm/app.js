var socket = io();
var state = null;
var map = null;
var gpsMarker = null;
var gameCode = "";
var objMarkers = {};
var playerMarkers = {};

function $(id) {
  return document.getElementById(id);
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function objectIcon(o) {
  var anyCaptured = !!(o.captured && (o.captured.RED || o.captured.BLUE));
  var cls = anyCaptured ? "map-object captured" : "map-object";
  var symbol = anyCaptured ? "✓" : "🎯";
  return L.divIcon({className:"aq-marker-wrap",html:'<div class="'+cls+'">'+symbol+'</div>',iconSize:[34,34],iconAnchor:[17,17],popupAnchor:[0,-17]});
}

function playerIcon(p) {
  var initial = (String(p.name || "J").trim().charAt(0) || "J").toUpperCase();
  var cls = p.team === "RED" ? "map-player red-player" : "map-player blue-player";
  return L.divIcon({className:"aq-marker-wrap",html:'<div class="'+cls+'">'+esc(initial)+'</div>',iconSize:[32,32],iconAnchor:[16,16],popupAnchor:[0,-16]});
}

function enter(code) {
  gameCode = code;
  $("login").classList.add("hidden");
  $("main").classList.remove("hidden");
  $("top").classList.remove("hidden");
  $("codeLabel").textContent = "Partida " + code;

  if (!map) {
    map = L.map("map").setView([39.5, -8], 7);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 20, attribution: "Tiles © Esri" }
    ).addTo(map);
  }
}

function send(name, data, cb) {
  data = data || {};
  data.gameCode = gameCode;
  socket.emit(name, data, cb);
}

function render() {
  var i, o, p, ps, html, pop, m;
  if (!state) return;

  $("rscore").textContent = state.scores.RED;
  $("bscore").textContent = state.scores.BLUE;
  if (state.teamCodes) {
    $("redCodeEdit").value = state.teamCodes.RED || "";
    $("blueCodeEdit").value = state.teamCodes.BLUE || "";
  }

  var objects = state.objects.slice().sort(function(a, b) {
    return a.order - b.order;
  });

  html = "";
  for (i = 0; i < objects.length; i++) {
    o = objects[i];
    html += '<div class="card">';
    html += '<b>' + o.order + '. ' + esc(o.name) + '</b> ';
    html += '<span class="tag">' + esc(o.team) + '</span><br>';
    html += esc(o.desc) + '<br>';
    html += '<span class="small">QR: ' + esc(o.qr) + ' · ' + o.points + ' pts · raio ' + o.radius + ' m</span><br>';
    html += '<img class="objphoto" src="/qr?data=' + encodeURIComponent(o.qr) + '">';
    html += '<div class="row">';
    html += '<a href="/qr?data=' + encodeURIComponent(o.qr) + '" download="' + esc(o.name) + '_QR.png"><button>⬇ Guardar QR</button></a>';
    html += '<button class="danger" onclick="delObj(\'' + esc(o.id) + '\')">APAGAR</button>';
    html += '</div></div>';
  }
  if (!html) html = "<div class='small'>Sem objetivos.</div>";
  $("objects").innerHTML = html;

  ps = [];
  for (var pid in state.players) {
    if (Object.prototype.hasOwnProperty.call(state.players, pid)) ps.push(state.players[pid]);
  }

  html = "";
  for (i = 0; i < ps.length; i++) {
    p = ps[i];
    html += '<div><b>' + esc(p.name) + '</b> ';
    html += '<span class="tag ' + (p.team === "RED" ? "red" : "blue") + '">' + esc(p.team) + '</span> ';
    if (p.lat != null && p.lon != null) {
      html += Number(p.lat).toFixed(5) + ', ' + Number(p.lon).toFixed(5);
    } else {
      html += 'GPS sem posição';
    }
    html += '</div>';
  }
  $("players").innerHTML = html || "Sem jogadores.";

  if (map) {
    for (i in objMarkers) {
      if (Object.prototype.hasOwnProperty.call(objMarkers, i)) {
        var found = false;
        for (var j = 0; j < state.objects.length; j++) {
          if (state.objects[j].id === i) { found = true; break; }
        }
        if (!found) {
          map.removeLayer(objMarkers[i]);
          delete objMarkers[i];
        }
      }
    }

    for (i = 0; i < state.objects.length; i++) {
      o = state.objects[i];
      pop = '<b>' + esc(o.name) + '</b><br>' + esc(o.desc) + '<br>' + o.points + ' pts · ' + o.radius + ' m<br>';
      pop += '<img class="objphoto" src="/qr?data=' + encodeURIComponent(o.qr) + '">';
      if (objMarkers[o.id]) {
        objMarkers[o.id].setLatLng([o.lat, o.lon]);
        objMarkers[o.id].setPopupContent(pop).setIcon(objectIcon(o));
      } else {
        objMarkers[o.id] = L.marker([o.lat, o.lon], {icon:objectIcon(o)}).addTo(map).bindPopup(pop);
      }
    }

    for (i in playerMarkers) {
      if (Object.prototype.hasOwnProperty.call(playerMarkers, i) && !state.players[i]) {
        map.removeLayer(playerMarkers[i]);
        delete playerMarkers[i];
      }
    }

    for (i = 0; i < ps.length; i++) {
      p = ps[i];
      if (p.lat == null || p.lon == null) continue;
      pop = esc(p.name) + ' · ' + esc(p.team);
      if (playerMarkers[p.id]) {
        playerMarkers[p.id].setLatLng([p.lat, p.lon]);
        playerMarkers[p.id].setPopupContent(pop).setIcon(playerIcon(p));
      } else {
        playerMarkers[p.id] = L.marker([p.lat, p.lon], {icon:playerIcon(p), zIndexOffset:300}).addTo(map).bindPopup(pop);
      }
    }
  }
}

function compress(file, done) {
  if (!file) { done(null); return; }
  var r = new FileReader();
  r.onload = function() {
    var im = new Image();
    im.onload = function() {
      var c = document.createElement("canvas");
      var max = 1200;
      var s = Math.min(1, max / Math.max(im.width, im.height));
      c.width = Math.round(im.width * s);
      c.height = Math.round(im.height * s);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      done(c.toDataURL("image/jpeg", 0.78));
    };
    im.onerror = function() { done(null); };
    im.src = r.result;
  };
  r.onerror = function() { done(null); };
  r.readAsDataURL(file);
}

$("create").onclick = function() {
  gameCode = $("game").value.trim().toUpperCase();
  var gmCode = $("gm").value.trim();
  var redCode = $("redCode").value.trim();
  var blueCode = $("blueCode").value.trim();
  if (!gameCode) { $("err").textContent = "Introduz o código da partida."; return; }
  if (!gmCode) { $("err").textContent = "Introduz o código GM."; return; }
  if (!redCode || !blueCode) { $("err").textContent = "Define os códigos RED e BLUE."; return; }
  if (redCode === blueCode) { $("err").textContent = "Os códigos RED e BLUE têm de ser diferentes."; return; }
  send("create_game", { gmCode: gmCode, redCode: redCode, blueCode: blueCode }, function(r) {
    if (!r || !r.ok) { $("err").textContent = r && r.error ? r.error : "Erro ao criar a partida."; return; }
    enter(gameCode);
  });
};

$("enter").onclick = function() {
  gameCode = $("game").value.trim().toUpperCase();
  var gmCode = $("gm").value.trim();
  if (!gameCode) { $("err").textContent = "Introduz o código da partida."; return; }
  if (!gmCode) { $("err").textContent = "Introduz o código GM."; return; }
  send("gm_login", { gmCode: gmCode }, function(r) {
    if (!r || !r.ok) { $("err").textContent = r && r.error ? r.error : "Erro ao entrar na partida."; return; }
    enter(gameCode);
  });
};

$("start").onclick = function() { socket.emit("set_started", true); };
$("stop").onclick = function() { socket.emit("set_started", false); };
$("reset").onclick = function() {
  if (confirm("Reiniciar jogo e pontuações?")) socket.emit("reset");
};
$("visibility").onchange = function(e) { socket.emit("set_visibility", e.target.value); };

$("saveTeamCodes").onclick = function() {
  var redCode = $("redCodeEdit").value.trim();
  var blueCode = $("blueCodeEdit").value.trim();
  if (!redCode || !blueCode) { $("teamCodeMsg").textContent = "Os dois códigos são obrigatórios."; return; }
  if (redCode === blueCode) { $("teamCodeMsg").textContent = "Os códigos têm de ser diferentes."; return; }
  socket.emit("set_team_codes", { redCode: redCode, blueCode: blueCode }, function(r) {
    if (!r || !r.ok) { $("teamCodeMsg").textContent = r && r.error ? r.error : "Erro ao guardar os códigos."; return; }
    $("teamCodeMsg").textContent = "Códigos guardados.";
  });
};

$("mygps").onclick = function() {
  if (!navigator.geolocation) { alert("Este dispositivo não suporta GPS no navegador."); return; }
  navigator.geolocation.getCurrentPosition(function(pos) {
    $("lat").value = pos.coords.latitude.toFixed(6);
    $("lon").value = pos.coords.longitude.toFixed(6);
    enter(gameCode);
    map.setView([pos.coords.latitude, pos.coords.longitude], 18);
    if (gpsMarker) gpsMarker.setLatLng([pos.coords.latitude, pos.coords.longitude]);
    else gpsMarker = L.marker([pos.coords.latitude, pos.coords.longitude]).addTo(map).bindPopup("GPS do Game Master");
  }, function(e) { alert("GPS: " + e.message); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
};

$("add").onclick = function() {
  var name = $("name").value.trim();
  var qr = $("qr").value.trim();
  var lat = Number($("lat").value);
  var lon = Number($("lon").value);
  if (!name || !qr || !isFinite(lat) || !isFinite(lon)) {
    alert("Preenche nome, QR e coordenadas."); return;
  }
  compress($("photo").files[0], function(photo) {
    send("add_object", {
      name: name,
      desc: $("desc").value,
      team: $("team").value,
      points: $("points").value,
      radius: $("radius").value,
      qr: qr,
      lat: lat,
      lon: lon,
      photo: photo
    }, function(r) {
      if (!r || !r.ok) { alert(r && r.error ? r.error : "Erro ao criar objetivo."); }
      else {
        $("name").value = "";
        $("desc").value = "";
        $("qr").value = "";
        $("photo").value = "";
      }
    });
  });
};

window.delObj = function(id) {
  socket.emit("delete_object", id, function(r) {
    if (r && !r.ok) alert(r.error);
  });
};

socket.on("state", function(s) {
  state = s;
  render();
});
