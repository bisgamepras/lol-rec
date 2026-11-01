
const socket = io();

const $ = (id) => document.getElementById(id);
const entry = $("entry");
const roomView = $("room-view");
const remoteVideo = $("remote-screen");

let roomId = "";
let myId = "";
let myName = "";
let localStream = null;
let micStream = null;
let myAvatar = localStorage.getItem("lolrec-avatar") || "";

const peers = new Map();
const pendingIce = new Map();
const voicePeers = new Map();
const pendingVoiceIce = new Map();
const people = new Map();

let toastTimer;

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function validImage(value) {
  return typeof value === "string" &&
    /^data:image\/(jpeg|png|webp);base64,/.test(value);
}

async function compressImage(file, size = 640) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Escolha um arquivo de imagem.");
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Use uma imagem JPG, PNG ou WEBP.");
  }

  const image = new Image();
  const url = URL.createObjectURL(file);

  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });

    const scale = Math.min(1, size / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");

    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));

    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/jpeg", 0.72);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderPeople() {
  $("people-count").textContent = people.size;

  $("people-list").innerHTML = [...people].map(([id, person]) => {
    const avatar = validImage(person.avatar)
      ? `<img class="avatar-img" src="${person.avatar}" alt="">`
      : `<span class="avatar">${escapeHtml(person.name.slice(0, 1).toUpperCase())}</span>`;

    return `
      <li class="person">
        ${avatar}
        <span>${escapeHtml(person.name)}</span>
        ${id === myId ? '<span class="you-tag">VOCÊ</span>' : ""}
      </li>
    `;
  }).join("");
}

function addSystem(text) {
  const div = document.createElement("div");
  div.className = "system-message";
  div.textContent = text;
  $("messages").appendChild(div);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function addMessage(data) {
  const div = document.createElement("div");
  div.className = "message";

  const time = data.time
    ? new Date(data.time).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit"
      })
    : "";

  const body = data.type === "image" && validImage(data.image)
    ? `<img class="chat-image" src="${data.image}" alt="Imagem enviada no chat">`
    : `<div class="message-body">${escapeHtml(data.message || "")}</div>`;

  div.innerHTML = `
    <div class="message-head">
      <span class="message-name">${escapeHtml(data.name)}</span>
      <span class="message-time">${time}</span>
    </div>
    ${body}
  `;

  $("messages").appendChild(div);
  $("messages").scrollTop = $("messages").scrollHeight;
}

// COMPARTILHAMENTO DE TELA

function createPeer(peerId) {
  if (peers.has(peerId)) return peers.get(peerId);

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  peers.set(peerId, pc);

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("webrtc-ice", {
        to: peerId,
        candidate: e.candidate
      });
    }
  };

  pc.ontrack = e => {
    if (e.track.kind === "video") {
      remoteVideo.srcObject = e.streams[0];
      remoteVideo.classList.add("active");
      document.querySelector(".empty-screen").classList.add("hidden");
    }
  };

  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
      if (peers.get(peerId) === pc) {
        pc.close();
        peers.delete(peerId);
      }
    }
  };

  return pc;
}

async function sendScreenTo(peerId) {
  if (!localStream || peerId === myId) return;

  const pc = createPeer(peerId);

  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("webrtc-offer", {
    to: peerId,
    description: pc.localDescription
  });
}

async function startSharing() {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });

    socket.emit("screen-start");

    $("share-btn").classList.add("hidden");
    $("stop-btn").classList.remove("hidden");
    $("screen-label").textContent = "Você está compartilhando sua tela";

    localStream.getVideoTracks()[0].addEventListener("ended", stopSharing);

    for (const peerId of people.keys()) {
      await sendScreenTo(peerId);
    }
  } catch (err) {
    if (localStream) stopSharing();

    if (err.name !== "NotAllowedError") {
      toast("Não foi possível compartilhar: " + err.message);
    }
  }
}

function stopSharing() {
  if (!localStream) return;

  localStream.getTracks().forEach(track => track.stop());
  localStream = null;

  for (const pc of peers.values()) pc.close();

  peers.clear();
  pendingIce.clear();

  socket.emit("screen-stop");

  $("share-btn").classList.remove("hidden");
  $("stop-btn").classList.add("hidden");
  $("screen-label").textContent = "Nenhuma tela compartilhada";
}

async function handleOffer({ from, description }) {
  const pc = createPeer(from);

  await pc.setRemoteDescription(description);

  for (const candidate of pendingIce.get(from) || []) {
    await pc.addIceCandidate(candidate);
  }

  pendingIce.delete(from);

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("webrtc-answer", {
    to: from,
    description: pc.localDescription
  });
}

async function handleAnswer({ from, description }) {
  const pc = peers.get(from);
  if (!pc) return;

  await pc.setRemoteDescription(description);

  for (const candidate of pendingIce.get(from) || []) {
    await pc.addIceCandidate(candidate);
  }

  pendingIce.delete(from);
}

async function handleIce({ from, candidate }) {
  const pc = peers.get(from);

  if (pc && pc.remoteDescription) {
    await pc.addIceCandidate(candidate);
  } else {
    const list = pendingIce.get(from) || [];
    list.push(candidate);
    pendingIce.set(from, list);
  }
}

// MICROFONE E CONVERSA POR VOZ

function createVoicePeer(peerId) {
  if (voicePeers.has(peerId)) return voicePeers.get(peerId);

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  voicePeers.set(peerId, pc);

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("voice-ice", {
        to: peerId,
        candidate: e.candidate
      });
    }
  };

  pc.ontrack = e => {
    let audio = document.getElementById("audio-" + peerId);

    if (!audio) {
      audio = document.createElement("audio");
      audio.id = "audio-" + peerId;
      audio.autoplay = true;
      audio.playsInline = true;
      document.body.appendChild(audio);
    }

    audio.srcObject = e.streams[0];
    audio.play().catch(() => {
      toast("Clique na página para liberar o áudio.");
    });
  };

  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
      if (voicePeers.get(peerId) === pc) {
        pc.close();
        voicePeers.delete(peerId);
      }
      document.getElementById("audio-" + peerId)?.remove();
    }
  };

  return pc;
}

async function sendVoiceTo(peerId) {
  if (!micStream || peerId === myId) return;

  const pc = createVoicePeer(peerId);

  if (pc.getSenders().length === 0) {
    micStream.getAudioTracks().forEach(track => {
      pc.addTrack(track, micStream);
    });
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("voice-offer", {
    to: peerId,
    description: pc.localDescription
  });
}

async function startMic() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    $("mic-btn").classList.add("hidden");
    $("stop-mic-btn").classList.remove("hidden");

    for (const peerId of people.keys()) {
      await sendVoiceTo(peerId);
    }

    toast("Microfone ligado!");
  } catch (err) {
    toast("Não foi possível acessar o microfone. Confira a permissão.");
  }
}

function stopMic() {
  if (!micStream) return;

  micStream.getTracks().forEach(track => track.stop());
  micStream = null;

  for (const pc of voicePeers.values()) pc.close();

  voicePeers.clear();
  pendingVoiceIce.clear();

  document.querySelectorAll("audio[id^='audio-']").forEach(el => el.remove());

  $("mic-btn").classList.remove("hidden");
  $("stop-mic-btn").classList.add("hidden");

  toast("Microfone desligado.");
}

async function handleVoiceOffer({ from, description }) {
  const pc = createVoicePeer(from);

  await pc.setRemoteDescription(description);

  for (const candidate of pendingVoiceIce.get(from) || []) {
    await pc.addIceCandidate(candidate);
  }

  pendingVoiceIce.delete(from);

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("voice-answer", {
    to: from,
    description: pc.localDescription
  });
}

async function handleVoiceAnswer({ from, description }) {
  const pc = voicePeers.get(from);
  if (!pc) return;

  await pc.setRemoteDescription(description);

  for (const candidate of pendingVoiceIce.get(from) || []) {
    await pc.addIceCandidate(candidate);
  }

  pendingVoiceIce.delete(from);
}

async function handleVoiceIce({ from, candidate }) {
  const pc = voicePeers.get(from);

  if (pc && pc.remoteDescription) {
    await pc.addIceCandidate(candidate);
  } else {
    const list = pendingVoiceIce.get(from) || [];
    list.push(candidate);
    pendingVoiceIce.set(from, list);
  }
}

// ENTRAR NA SALA

$("join-form").addEventListener("submit", e => {
  e.preventDefault();

  myName = $("name").value.trim();
  roomId = $("room").value.trim().toUpperCase();

  if (!myName || !roomId) return;

  socket.emit("join-room", {
    name: myName,
    roomId,
    avatar: myAvatar
  });
});

$("avatar-file").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    myAvatar = await compressImage(file, 128);
    localStorage.setItem("lolrec-avatar", myAvatar);
    toast("Foto de perfil escolhida!");
  } catch (err) {
    toast(err.message || "Erro ao carregar a foto.");
  }
});

$("change-avatar").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    myAvatar = await compressImage(file, 128);
    localStorage.setItem("lolrec-avatar", myAvatar);
    socket.emit("avatar-update", myAvatar);
    renderPeople();
    toast("Foto de perfil atualizada!");
  } catch (err) {
    toast(err.message || "Erro ao atualizar a foto.");
  }
});

socket.on("room-joined", data => {
  myId = data.selfId;
  roomId = data.roomId;

  people.clear();

  data.users.forEach(user => {
    people.set(user.id, {
      name: user.name,
      avatar: user.avatar || ""
    });
  });

  entry.classList.add("hidden");
  roomView.classList.remove("hidden");

  $("room-title").textContent = roomId;

  renderPeople();
  addSystem("Você entrou na sala.");

  if (data.sharerId) {
    $("screen-label").textContent = "Alguém já está compartilhando";
  }
});

socket.on("join-error", toast);

socket.on("user-joined", user => {
  people.set(user.id, {
    name: user.name,
    avatar: user.avatar || ""
  });

  renderPeople();

  if (localStream) {
    sendScreenTo(user.id).catch(() => {
      toast("Não foi possível conectar a tela ao novo participante.");
    });
  }

  if (micStream) {
    sendVoiceTo(user.id).catch(() => {
      toast("Não foi possível conectar o microfone ao novo participante.");
    });
  }
});

socket.on("avatar-updated", data => {
  const person = people.get(data.id);
  if (!person) return;

  person.avatar = data.avatar;
  renderPeople();
});

socket.on("user-left", user => {
  people.delete(user.id);
  renderPeople();

  const pc = peers.get(user.id);
  if (pc) pc.close();

  peers.delete(user.id);
  pendingIce.delete(user.id);

  const voicePc = voicePeers.get(user.id);
  if (voicePc) voicePc.close();

  voicePeers.delete(user.id);
  pendingVoiceIce.delete(user.id);

  document.getElementById("audio-" + user.id)?.remove();
});

socket.on("system-message", addSystem);
socket.on("chat-message", addMessage);

socket.on("screen-started", ({ id, name }) => {
  $("screen-label").textContent = id === myId
    ? "Você está compartilhando sua tela"
    : `${name} está compartilhando a tela`;
});

socket.on("screen-stopped", ({ id }) => {
  if (id !== myId) {
    remoteVideo.srcObject = null;
    remoteVideo.classList.remove("active");
    document.querySelector(".empty-screen").classList.remove("hidden");
    $("screen-label").textContent = "Nenhuma tela compartilhada";
  }
});

socket.on("screen-error", message => {
  toast(message);
  stopSharing();
});

socket.on("webrtc-offer", data => {
  handleOffer(data).catch(() => toast("Falha ao receber o compartilhamento."));
});

socket.on("webrtc-answer", data => {
  handleAnswer(data).catch(() => {});
});

socket.on("webrtc-ice", data => {
  handleIce(data).catch(() => {});
});

socket.on("voice-offer", data => {
  handleVoiceOffer(data).catch(() => toast("Falha ao conectar o áudio."));
});

socket.on("voice-answer", data => {
  handleVoiceAnswer(data).catch(() => {});
});

socket.on("voice-ice", data => {
  handleVoiceIce(data).catch(() => {});
});

// CHAT DE TEXTO

$("chat-form").addEventListener("submit", e => {
  e.preventDefault();

  const input = $("chat-input");

  if (input.value.trim()) {
    socket.emit("chat-message", input.value.trim());
  }

  input.value = "";
  input.focus();
});

// ENVIO DE IMAGENS

$("image-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const image = await compressImage(file, 700);

    if (image.length > 650000) {
      toast("Imagem muito grande. Escolha outra.");
      return;
    }

    socket.emit("chat-message", {
      type: "image",
      image
    });

    toast("Imagem enviada!");
  } catch (err) {
    toast(err.message || "Não foi possível enviar a imagem.");
  }

  e.target.value = "";
});

// BOTÕES

$("share-btn").addEventListener("click", startSharing);
$("stop-btn").addEventListener("click", stopSharing);
$("mic-btn").addEventListener("click", startMic);
$("stop-mic-btn").addEventListener("click", stopMic);

$("leave-btn").addEventListener("click", () => {
  stopSharing();
  stopMic();
  socket.disconnect();
  location.reload();
});

$("copy-invite").addEventListener("click", async () => {
  const invite = `${location.origin} — Sala: ${roomId}`;

  try {
    await navigator.clipboard.writeText(invite);
    toast("Convite copiado!");
  } catch {
    toast(invite);
  }
});

socket.on("connect", () => {});

socket.on("disconnect", () => {
  toast("Conexão perdida. Atualize a página para voltar.");
});
