
import { supabase } from "./supabase-config.js";

const socket = io({ autoConnect: false });
const $ = (id) => document.getElementById(id);

const authView = $("auth-view");
const appView = $("app-view");
const roomView = $("room-view");

let currentUser = null;
let toastTimer;

function toast(message) {
  const el = $("toast");
  if (!el) return;

  el.textContent = message;
  el.classList.remove("hidden");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add("hidden");
  }, 3000);
}

function showStatus(message) {
  $("auth-status").textContent = message;
}

function showApp(user) {
  currentUser = user;

  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  roomView.classList.add("hidden");

  $("profile-name").textContent =
    user.user_metadata?.username || user.email || "Jogador";

  loadServers();
}

function showAuth() {
  currentUser = null;
  appView.classList.add("hidden");
  roomView.classList.add("hidden");
  authView.classList.remove("hidden");
}

$("show-login").addEventListener("click", () => {
  $("login-form").classList.remove("hidden");
  $("signup-form").classList.add("hidden");
  showStatus("");
});

$("show-signup").addEventListener("click", () => {
  $("signup-form").classList.remove("hidden");
  $("login-form").classList.add("hidden");
  showStatus("");
});

// CADASTRO

$("signup-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = $("signup-name").value.trim();
  const email = $("signup-email").value.trim();
  const password = $("signup-password").value;

  if (!username || !email || password.length < 8) {
    showStatus("Confira os dados. A senha precisa ter pelo menos 8 caracteres.");
    return;
  }

  showStatus("Criando sua conta...");

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username }
    }
  });

  if (error) {
    showStatus(error.message);
    return;
  }

  if (data.session) {
    showApp(data.user);
    toast("Conta criada com sucesso!");
  } else {
    showStatus("Conta criada! Confira seu e-mail para confirmar o cadastro.");
  }
});

// LOGIN

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("login-email").value.trim();
  const password = $("login-password").value;

  showStatus("Entrando...");

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    showStatus("Não foi possível entrar. Confira seus dados.");
    return;
  }

  showApp(data.user);
  toast("Login realizado!");
});

// LOGOUT

$("logout-btn").addEventListener("click", async () => {
  socket.disconnect();

  const { error } = await supabase.auth.signOut();

  if (error) {
    toast("Não foi possível sair da conta.");
    return;
  }

  showAuth();
  toast("Você saiu da conta.");
});

// VERIFICAR SESSÃO SALVA

async function checkSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    showAuth();
    showStatus("Erro ao verificar sua sessão.");
    return;
  }

  if (data.session) {
    showApp(data.session.user);
  } else {
    showAuth();
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT") {
    showAuth();
  }
});

// SERVIDORES

async function loadServers() {
  if (!currentUser) return;

  const list = $("server-list");

  list.innerHTML = "<p>Carregando servidores...</p>";

  const { data, error } = await supabase
    .from("servers")
    .select("id, name, invite_code")
    .order("created_at", { ascending: false });

  if (error) {
    list.textContent = "Não foi possível carregar os servidores.";
    return;
  }

  list.innerHTML = "";

  if (!data || data.length === 0) {
    list.textContent = "Você ainda não participa de nenhum servidor.";
    return;
  }

  data.forEach((server) => {
    const card = document.createElement("div");
    card.className = "server-card";

    const title = document.createElement("h3");
    title.textContent = server.name;

    const invite = document.createElement("p");
    invite.textContent = "Convite: " + server.invite_code;

    const copyButton = document.createElement("button");
    copyButton.className = "secondary";
    copyButton.textContent = "Copiar convite";

    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(server.invite_code);
        toast("Código copiado!");
      } catch {
        toast("Não foi possível copiar o código.");
      }
    });

    card.append(title, invite, copyButton);
    list.appendChild(card);
  });
}

// CRIAR SERVIDOR

$("create-server-btn").addEventListener("click", async () => {
  if (!currentUser) return;

  const name = prompt("Qual será o nome do seu servidor?");

  if (!name || !name.trim()) return;

  const serverName = name.trim().slice(0, 40);

  toast("Criando servidor...");

  const { data: server, error } = await supabase
    .from("servers")
    .insert({
      name: serverName,
      owner_id: currentUser.id
    })
    .select()
    .single();

  if (error) {
    toast("Erro ao criar servidor: " + error.message);
    return;
  }

  const { error: channelError } = await supabase
    .from("channels")
    .insert({
      server_id: server.id,
      name: "geral",
      type: "text"
    });

  if (channelError) {
    toast("Servidor criado, mas não foi possível criar o canal.");
    await loadServers();
    return;
  }

  toast("Servidor criado com sucesso!");
  await loadServers();
});

// INICIALIZAÇÃO

checkSession();
