const socket = io();
const $ = (id) => document.getElementById(id);
const entry = $("entry"), roomView = $("room-view");
const remoteVideo = $("remote-screen");
let roomId = "", myId = "", myName = "", localStream = null;
let peers = new Map();
let pendingIce = new Map();
let people = new Map();
let toastTimer;

function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.remove("hidden");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add("hidden"), 3000);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function renderPeople() {
  $("people-count").textContent = people.size;
  $("people-list").innerHTML = [...people].map(([id, name]) =>
    `<li class="person"><span class="avatar">${escapeHtml(name.slice(0,1).toUpperCase())}</span><span>${escapeHtml(name)}</span>${id===myId?'<span class="you-tag">VOCÊ</span>':''}</li>`
  ).join("");
}
function addSystem(text) {
  const div = document.createElement("div"); div.className = "system-message"; div.textContent = text;
  $("messages").appendChild(div); $("messages").scrollTop = $("messages").scrollHeight;
}
function addMessage(data) {
  const div = document.createElement("div"); div.className = "message";
  const time = data.time ? new Date(data.time).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : "";
  div.innerHTML = `<div class="message-head"><span class="message-name">${escapeHtml(data.name)}</span><span class="message-time">${time}</span></div><div class="message-body">${escapeHtml(data.message)}</div>`;
  $("messages").appendChild(div); $("messages").scrollTop = $("messages").scrollHeight;
}
function createPeer(peerId) {
  if (peers.has(peerId)) return peers.get(peerId);
  const pc = new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
  peers.set(peerId, pc);
  pc.onicecandidate = e => { if (e.candidate) socket.emit("webrtc-ice",{to:peerId,candidate:e.candidate}); };
  pc.ontrack = e => {
    remoteVideo.srcObject = e.streams[0]; remoteVideo.classList.add("active");
    document.querySelector(".empty-screen").classList.add("hidden");
  };
  pc.onconnectionstatechange = () => {
    if (["failed","closed","disconnected"].includes(pc.connectionState) && peers.get(peerId) === pc) {
      pc.close(); peers.delete(peerId);
    }
  };
  return pc;
}
async function sendScreenTo(peerId) {
  if (!localStream || peerId === myId) return;
  const pc = createPeer(peerId);
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("webrtc-offer",{to:peerId,description:pc.localDescription});
}
async function startSharing() {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
    socket.emit("screen-start");
    $("share-btn").classList.add("hidden"); $("stop-btn").classList.remove("hidden");
    $("screen-label").textContent = "Você está compartilhando sua tela";
    localStream.getVideoTracks()[0].addEventListener("ended", stopSharing);
    for (const peerId of people.keys()) await sendScreenTo(peerId);
  } catch (err) {
    if (localStream) stopSharing();
    if (err.name !== "NotAllowedError") toast("Não foi possível compartilhar: " + err.message);
  }
}
function stopSharing() {
  if (!localStream) return;
  localStream.getTracks().forEach(t => t.stop()); localStream = null;
  for (const pc of peers.values()) pc.close();
  peers.clear(); pendingIce.clear();
  socket.emit("screen-stop");
  $("share-btn").classList.remove("hidden"); $("stop-btn").classList.add("hidden");
  $("screen-label").textContent = "Nenhuma tela compartilhada";
}
async function handleOffer({from,description}) {
  const pc = createPeer(from);
  await pc.setRemoteDescription(description);
  for (const candidate of pendingIce.get(from) || []) await pc.addIceCandidate(candidate);
  pendingIce.delete(from);
  const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
  socket.emit("webrtc-answer",{to:from,description:pc.localDescription});
}
async function handleAnswer({from,description}) {
  const pc = peers.get(from); if (!pc) return;
  await pc.setRemoteDescription(description);
  for (const candidate of pendingIce.get(from) || []) await pc.addIceCandidate(candidate);
  pendingIce.delete(from);
}
async function handleIce({from,candidate}) {
  const pc = peers.get(from);
  if (pc && pc.remoteDescription) await pc.addIceCandidate(candidate);
  else { const list = pendingIce.get(from) || []; list.push(candidate); pendingIce.set(from,list); }
}

$("join-form").addEventListener("submit", e => {
  e.preventDefault();
  myName = $("name").value.trim(); roomId = $("room").value.trim().toUpperCase();
  if (!myName || !roomId) return;
  socket.emit("join-room",{name:myName,roomId});
});
socket.on("room-joined", data => {
  myId = data.selfId; roomId = data.roomId;
  people = new Map(data.users.map(u => [u.id,u.name]));
  entry.classList.add("hidden"); roomView.classList.remove("hidden");
  $("room-title").textContent = roomId; renderPeople();
  addSystem("Você entrou na sala.");
  if (data.sharerId) $("screen-label").textContent = "Alguém já está compartilhando";
});
socket.on("join-error", toast);
socket.on("user-joined", user => {
  people.set(user.id,user.name); renderPeople();
  if (localStream) sendScreenTo(user.id).catch(() => toast("Não foi possível conectar a tela ao novo participante."));
});
socket.on("user-left", user => {
  people.delete(user.id); renderPeople();
  const pc = peers.get(user.id); if (pc) pc.close();
  peers.delete(user.id); pendingIce.delete(user.id);
});
socket.on("system-message", addSystem);
socket.on("chat-message", addMessage);
socket.on("screen-started", ({id,name}) => {
  $("screen-label").textContent = id === myId ? "Você está compartilhando sua tela" : `${name} está compartilhando a tela`;
});
socket.on("screen-stopped", ({id}) => {
  if (id !== myId) {
    remoteVideo.srcObject = null; remoteVideo.classList.remove("active");
    document.querySelector(".empty-screen").classList.remove("hidden");
    $("screen-label").textContent = "Nenhuma tela compartilhada";
  }
});
socket.on("screen-error", message => { toast(message); stopSharing(); });
socket.on("webrtc-offer", data => handleOffer(data).catch(() => toast("Falha ao receber o compartilhamento.")));
socket.on("webrtc-answer", data => handleAnswer(data).catch(() => {}));
socket.on("webrtc-ice", data => handleIce(data).catch(() => {}));

$("chat-form").addEventListener("submit", e => {
  e.preventDefault(); const input = $("chat-input");
  if (input.value.trim()) socket.emit("chat-message",input.value.trim());
  input.value = ""; input.focus();
});
$("share-btn").addEventListener("click", startSharing);
$("stop-btn").addEventListener("click", stopSharing);
$("leave-btn").addEventListener("click", () => {
  stopSharing(); socket.disconnect(); location.reload();
});
$("copy-invite").addEventListener("click", async () => {
  const invite = `${location.origin} — Sala: ${roomId}`;
  try { await navigator.clipboard.writeText(invite); toast("Convite copiado!"); }
  catch { toast(invite); }
});
socket.on("connect", () => {});
socket.on("disconnect", () => toast("Conexão perdida. Atualize a página para voltar."));
