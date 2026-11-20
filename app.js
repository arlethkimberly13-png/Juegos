
// ==========================================
// 1. CONFIGURACIÓN DE SUPABASE
// ==========================================

const SUPABASE_URL = "https://doulusoiybiusnycdeyp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_xpT-SNGPnzy77VcycgTGEw_N5OqNmHP";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// ==========================================
// 2. ELEMENTOS GENERALES
// ==========================================

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const mesaId = Number(params.get("mesa"));
const juryMode = params.has("jurado");

let currentParticipant = null;
let currentJury = null;
let realtimeChannel = null;
let currentGameId = null;

function showMessage(elementId, message, type = "") {
  const element = $(elementId);
  element.textContent = message;
  element.className = `message ${type}`;
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function showGlobalError(message) {
  showMessage("globalMessage", message, "error");
}

// ==========================================
// 3. INICIO DE LA APLICACIÓN
// ==========================================

async function init() {
  if (!SUPABASE_URL.startsWith("https://") ||
      SUPABASE_ANON_KEY.startsWith("PEGA_")) {
    showGlobalError("Primero configura las credenciales de Supabase en app.js.");
    return;
  }

  if (juryMode) {
    $("juryView").classList.remove("hidden");
    await initJury();
  } else {
    $("participantView").classList.remove("hidden");

    if (!Number.isInteger(mesaId) || mesaId < 1 || mesaId > 20) {
      $("mesaTitle").textContent = "Mesa no válida";
      $("participantGreeting").textContent =
        "Escanea el QR correspondiente a tu mesa.";
      return;
    }

    await initParticipant();
  }
}

// ==========================================
// 4. PARTICIPANTES
// ==========================================

async function initParticipant() {
  $("mesaTitle").textContent = `Mesa ${mesaId}`;

  const { data: mesa, error } = await db
    .from("mesas")
    .select("id, nombre")
    .eq("id", mesaId)
    .maybeSingle();

  if (error || !mesa) {
    $("mesaTitle").textContent = "Mesa no encontrada";
    return;
  }

  $("mesaTitle").textContent = mesa.nombre;

  const savedToken = localStorage.getItem("mis15_registro_token");
  const savedName = localStorage.getItem("mis15_participant_name");

  if (savedToken && savedName) {
    await registerParticipant(savedName, savedToken, true);
  } else {
    $("registrationCard").classList.remove("hidden");
  }

  await refreshPublicData();
  subscribeToPublicChanges();

  $("registrationForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = $("participantName").value.trim();

    if (name.length < 2 || name.length > 60) {
      showMessage("registrationMessage",
        "El nombre debe tener entre 2 y 60 caracteres.", "error");
      return;
    }

    const token = savedToken || crypto.randomUUID();

    await registerParticipant(name, token, false);
  });
}

async function registerParticipant(name, token, restoring) {
  $("registrationCard").classList.add("hidden");

  const { data, error } = await db.rpc("registrar_participante", {
    p_mesa_id: mesaId,
    p_nombre: name,
    p_token: token
  });

  if (error) {
    $("registrationCard").classList.remove("hidden");
    showMessage("registrationMessage",
      "No se pudo completar el registro. Inténtalo nuevamente.", "error");
    console.error(error);
    return;
  }

  const participant = Array.isArray(data) ? data[0] : data;

  if (!participant) {
    $("registrationCard").classList.remove("hidden");
    showMessage("registrationMessage",
      "No recibimos una confirmación del registro.", "error");
    return;
  }

  if (Number(participant.mesa_id) !== mesaId) {
    $("registrationCard").classList.add("hidden");
    $("participantInfo").classList.remove("hidden");
    $("registeredName").textContent = participant.nombre;
    $("registeredMesa").textContent =
      `Este dispositivo ya está registrado en la Mesa ${participant.mesa_id}.`;
    return;
  }

  localStorage.setItem("mis15_registro_token", token);
  localStorage.setItem("mis15_participant_name", participant.nombre);

  currentParticipant = participant;

  $("participantInfo").classList.remove("hidden");
  $("registeredName").textContent = participant.nombre;
  $("registeredMesa").textContent = `Perteneces a la Mesa ${mesaId}`;
  $("participantGreeting").textContent = `¡Mucho éxito, ${participant.nombre}!`;

  if (!restoring) {
    showMessage("globalMessage", "¡Registro realizado correctamente!", "success");
  }

  await refreshPublicData();
}

// ==========================================
// 5. CLASIFICACIÓN PÚBLICA Y DATOS EN VIVO
// ==========================================

async function refreshPublicData() {
  const { data, error } = await db
    .from("estado_publico_mesas")
    .select("*")
    .gt("total_participantes", 0)
    .order("posicion", { ascending: true, nullsFirst: false });

  if (error) {
    console.error("Error al cargar clasificación:", error);
    return;
  }

  renderRanking(data || []);

  const ownMesa = (data || []).find(row => Number(row.mesa_id) === mesaId);

  if (ownMesa && currentParticipant) {
    $("participantSong").textContent =
      ownMesa.cancion || "Canción pendiente de asignación";

    $("participantScore").textContent =
      ownMesa.promedio === null ? "Sin notas" : `${ownMesa.promedio} pts`;

    $("participantPosition").textContent =
      ownMesa.posicion ? `Posición: ${ownMesa.posicion}° lugar` :
      "Aún sin posición";
  }
}

function renderRanking(rows) {
  const container = $("publicRanking");

  if (!rows.length) {
    container.innerHTML =
      '<p class="muted">Todavía no hay mesas participantes en la clasificación.</p>';
    return;
  }

  container.innerHTML = rows.map((row) => `
    <div class="ranking-item">
      <div class="rank-number">${row.posicion ?? "—"}</div>
      <div>
        <div class="rank-name">${escapeHTML(row.nombre)}</div>
        <div class="rank-detail">
          ${Number(row.total_participantes)} participante(s)
        </div>
      </div>
      <div class="rank-score">
        ${row.promedio === null ? "—" : `${row.promedio} pts`}
      </div>
    </div>
  `).join("");
}

function subscribeToPublicChanges() {
  if (realtimeChannel) {
    db.removeChannel(realtimeChannel);
  }

  realtimeChannel = db
    .channel("mis15-public-live")
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "estado_publico_mesas"
    }, () => {
      refreshPublicData();
    })
    .subscribe();
}

// ==========================================
// 6. PANEL DEL JURADO
// ==========================================

async function initJury() {
  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = $("juryEmail").value.trim();
    const password = $("juryPassword").value;

    const { error } = await db.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      showMessage("loginMessage",
        "Correo o contraseña incorrectos.", "error");
      return;
    }

    await loadJurySession();
  });

  $("logoutButton").addEventListener("click", async () => {
    await db.auth.signOut();
    currentJury = null;
    $("juryPanel").classList.add("hidden");
    $("loginCard").classList.remove("hidden");
  });

  const { data: sessionData } = await db.auth.getSession();

  if (sessionData.session) {
    await loadJurySession();
  }
}

async function loadJurySession() {
  const { data: userData } = await db.auth.getUser();

  if (!userData.user) return;

  const { data: jury, error } = await db
    .from("jurados")
    .select("id, nombre")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (error || !jury) {
    showMessage("loginMessage",
      "Este usuario no está habilitado como jurado.", "error");
    await db.auth.signOut();
    return;
  }

  currentJury = jury;

  $("loginCard").classList.add("hidden");
  $("juryPanel").classList.remove("hidden");
  $("juryName").textContent = jury.nombre;

  await loadJuryTables();
}

// ==========================================
// 7. MESAS Y CALIFICACIONES DEL JURADO
// ==========================================


async function loadJuryTables() {
  // Obtener juegos activos
  const { data: games, error: gameError } = await db
    .from("juegos")
    .select("id, nombre, orden")
    .eq("activo", true)
    .order("orden");

  if (gameError || !games || games.length === 0) {
    $("juryTables").innerHTML =
      '<p class="muted">No hay juegos disponibles. Agrega juegos en Supabase.</p>';
    console.error(gameError);
    return;
  }

  const gameSelect = $("gameSelect");

  // Conservar el juego seleccionado si sigue disponible
  if (!games.some(game => Number(game.id) === Number(currentGameId))) {
    currentGameId = Number(games[0].id);
  }

  gameSelect.innerHTML = games.map(game => `
    <option value="${game.id}" ${Number(game.id) === Number(currentGameId) ? "selected" : ""}>
      ${escapeHTML(game.nombre)}
    </option>
  `).join("");

  // Al cambiar de juego, cargar sus notas
  if (!gameSelect.dataset.listenerAttached) {
    gameSelect.addEventListener("change", async () => {
      currentGameId = Number(gameSelect.value);
      await loadJuryTables();
    });

    gameSelect.dataset.listenerAttached = "true";
  }

  // Obtener las 20 mesas
  const { data: mesas, error: mesaError } = await db
    .from("mesas")
    .select("id, nombre, cancion")
    .order("id");

  if (mesaError) {
    showGlobalError("No se pudieron cargar las mesas.");
    return;
  }

  // Obtener las calificaciones del jurado para ESTE juego
  const { data: scores, error: scoreError } = await db
    .from("calificaciones")
    .select("mesa_id, nota")
    .eq("jurado_id", currentJury.id)
    .eq("juego_id", currentGameId);

  if (scoreError) {
    showGlobalError("No se pudieron cargar las calificaciones.");
    return;
  }

  const scoreMap = new Map(
    (scores || []).map(score => [
      Number(score.mesa_id),
      score.nota
    ])
  );

  $("juryTables").innerHTML = mesas.map(mesa => `
    <div class="jury-table" data-mesa="${mesa.id}">
      <div class="jury-table-header">
        <strong>${escapeHTML(mesa.nombre)}</strong>
        <span class="live-tag">Mesa ${mesa.id}</span>
      </div>

      <label for="song-${mesa.id}">Canción asignada</label>
      <input id="song-${mesa.id}" type="text"
        value="${escapeHTML(mesa.cancion || "")}"
        placeholder="Nombre de la canción">

      <button class="button-secondary save-song"
        data-mesa="${mesa.id}">Guardar canción</button>

      <label for="score-${mesa.id}">Calificación de este juego (0 a 100)</label>
      <input id="score-${mesa.id}" type="number"
        min="0" max="100" step="0.01"
        value="${scoreMap.has(mesa.id) ? scoreMap.get(mesa.id) : ""}"
        placeholder="Ej. 95">

      <button class="save-score" data-mesa="${mesa.id}">
        Guardar calificación
      </button>

      <p class="message" id="message-${mesa.id}"></p>
    </div>
  `).join("");

  $("juryTables").querySelectorAll(".save-song").forEach(button => {
    button.addEventListener("click", () => {
      saveSong(Number(button.dataset.mesa));
    });
  });

  $("juryTables").querySelectorAll(".save-score").forEach(button => {
    button.addEventListener("click", () => {
      saveScore(Number(button.dataset.mesa));
    });
  });
}

async function saveSong(id) {
  const song = $(`song-${id}`).value.trim();

  const { error } = await db
    .from("mesas")
    .update({ cancion: song })
    .eq("id", id);

  if (error) {
    showMessage(`message-${id}`,
      "No se pudo guardar la canción.", "error");
    console.error(error);
    return;
  }

  showMessage(`message-${id}`, "Canción guardada correctamente.", "success");
}


async function saveScore(id) {
  const input = $(`score-${id}`);
  const value = input.value.trim();

  if (
    value === "" ||
    !Number.isFinite(Number(value)) ||
    Number(value) < 0 ||
    Number(value) > 100
  ) {
    showMessage(`message-${id}`,
      "Introduce una nota válida entre 0 y 100.", "error");
    return;
  }

  if (!currentGameId) {
    showMessage(`message-${id}`,
      "Primero selecciona un juego.", "error");
    return;
  }

  const { error } = await db
    .from("calificaciones")
    .upsert({
      mesa_id: id,
      jurado_id: currentJury.id,
      juego_id: currentGameId,
      nota: Number(value),
      updated_at: new Date().toISOString()
    }, {
      onConflict: "mesa_id,jurado_id,juego_id"
    });

  if (error) {
    showMessage(`message-${id}`,
      "No se pudo guardar la calificación.", "error");
    console.error(error);
    return;
  }

  showMessage(`message-${id}`,
    "¡Calificación guardada correctamente!", "success");
}

// ==========================================
// 8. EJECUTAR
// ==========================================

document.addEventListener("DOMContentLoaded", init);
