// admin/repairs-store.js
// Capa de datos del Panel Admin de L.O.T.U.S.
//
// Modelo:
//   Tool   = { id, name, category, status, repairs: Repair[] }
//   Repair = { id, date: "YYYY-MM-DD", reason, technician, notes, createdAt }
//   status = "available" | "in_use" | "maintenance"
//
// El contador de reparaciones NO se guarda aparte: es repairs.length.
// Así nunca puede quedar desincronizado del historial.
//
// Modos de persistencia:
//   "local": localStorage del navegador. Sirve para la demo abierta como archivo.
//   "api": inventario compartido y Excel en el servidor de Falmet.

const LS_KEY = "lotus.tools.v1";
// El sitio publicado usa el servidor persistente. Abrir el HTML como archivo
// conserva el modo demo del navegador.
const config = {
  mode: location.protocol === "file:" ? "local" : "api",
  apiBase: "/api/tools",
};

/** Sobrescribe el modo si una instalación necesita una configuración especial. */
export function configureStore(options = {}) {
  Object.assign(config, options);
}

// ---------- Datos de ejemplo (solo para la demo local) ----------
// Reemplazalos con tu inventario real usando importTools().
const SEED_TOOLS = [
  {
    id: "LOTUS-84920",
    name: "Taladro Percutor Inalámbrico Bosch 18V",
    category: "Eléctricas",
    status: "in_use",
    repairs: [
      { id: "seed-1", date: "2026-03-12", reason: "Reemplazo de carbones del motor", technician: "M. Díaz", notes: "" },
      { id: "seed-2", date: "2026-07-02", reason: "Mandril flojo", technician: "M. Díaz", notes: "Se ajustó y se cambió el seguro." },
    ],
  },
  {
    id: "LOTUS-55102",
    name: "Amoladora Angular 4 1/2\" DeWalt",
    category: "Eléctricas",
    status: "maintenance",
    repairs: [
      { id: "seed-3", date: "2026-05-20", reason: "Cable de alimentación dañado", technician: "R. Sosa", notes: "Cable reemplazado completo." },
    ],
  },
  { id: "LOTUS-31877", name: "Llave de Impacto Neumática 1/2\"", category: "Neumáticas", status: "available", repairs: [] },
  { id: "LOTUS-20463", name: "Sierra Circular Makita 7 1/4\"", category: "Eléctricas", status: "available", repairs: [] },
];

// ---------- Utilidades ----------
const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `r-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const repairCount = (tool) => (tool.repairs ?? []).length;

/** Reparaciones de una herramienta, de la más nueva a la más vieja. */
export function sortedRepairs(tool) {
  return [...(tool.repairs ?? [])].sort(
    (a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0)
  );
}

export function lastRepairDate(tool) {
  return sortedRepairs(tool)[0]?.date ?? null;
}

/** Todas las reparaciones de todas las herramientas, más nuevas primero. */
export function allRepairs(tools) {
  return tools
    .flatMap((t) => (t.repairs ?? []).map((r) => ({ ...r, toolId: t.id, toolName: t.name })))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

function validateRepair(input = {}) {
  const reason = String(input.reason ?? "").trim();
  if (!reason) throw new Error("Indicá el motivo de la reparación.");
  if (reason.length > 300) throw new Error("El motivo no puede superar los 300 caracteres.");

  const date = String(input.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new Error("La fecha no es válida.");
  }

  return {
    date,
    reason,
    technician: String(input.technician ?? "").trim().slice(0, 80),
    notes: String(input.notes ?? "").trim().slice(0, 500),
  };
}

// ---------- Modo local ----------
function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data;
    }
  } catch {
    /* si está corrupto, se reinicia con los datos de ejemplo */
  }
  const seed = structuredClone(SEED_TOOLS);
  writeLocal(seed);
  return seed;
}

function writeLocal(tools) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(tools));
  } catch {
    throw new Error("No se pudo guardar en este navegador (almacenamiento lleno o bloqueado).");
  }
}

// ---------- Modo API ----------
/**
 * Token de administrador para las APIs persistentes.
 *
 * Lo pide una sola vez y queda en la sesión; los otros stores (compras y
 * personal) lo importan desde acá para no repetir el prompt. Si no hay
 * navegador (tests en Node) devuelve vacío y el servidor responde 401, que es
 * el comportamiento correcto: sin token no hay datos.
 */
export function adminToken() {
  let token = "";
  try {
    token = sessionStorage.getItem("lotus.adminToken") ?? "";
  } catch {
    return "";
  }
  if (token) return token;
  if (typeof window === "undefined" || typeof window.prompt !== "function") return "";
  token = window.prompt("Token de administrador:") ?? "";
  if (token) sessionStorage.setItem("lotus.adminToken", token);
  return token;
}

async function api(path, options = {}) {
  const res = await fetch(`${config.apiBase}${path}`, {
    ...options,
    // Una API colgada (proxy sin respuesta) es indistinguible de una lenta si
    // no se corta: la pantalla queda cargando para siempre. 10s alcanza de sobra
    // para inventario y deja que apiOrLocal caiga al inventario del navegador.
    signal: options.signal ?? AbortSignal.timeout(10000),
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": adminToken(),
      ...options.headers,
    },
  });
  if (res.status === 401) {
    sessionStorage.removeItem("lotus.adminToken");
    throw new Error("Token de administrador inválido.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Error del servidor (${res.status}).`);
    // 400/409/422 son errores de negocio (herramienta ya prestada, ID
    // repetido): el servidor está vivo y contestó, así que esos errores tienen
    // que llegar a la pantalla y no silenciarse cambiando al navegador.
    error.status = res.status;
    throw error;
  }
  return data;
}

/** Descarga el Excel actualizado desde el servidor persistente. */
export async function downloadExcel() {
  if (config.mode !== "api") throw new Error("El Excel automático requiere abrir la web desde el servidor de Falmet.");
  const res = await fetch(`${config.apiBase}/excel`, { headers: { "x-admin-token": adminToken() } });
  if (res.status === 401) {
    sessionStorage.removeItem("lotus.adminToken");
    throw new Error("Token de administrador inválido.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `No se pudo descargar el Excel (${res.status}).`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "falmet-inventario.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

// El modo "api" es el del sitio publicado, pero hay despliegue donde ese
// endpoint no existe (la funcion /api/tools todavia no esta desplegada) o
// responde 401 (falta ADMIN_TOKEN). Antes, en esos casos el inventario llegaba
// vacio al chat y el modelo completaba de memoria: preguntaba "hola" y se
// inventaba una herramienta.
//
// Con este degradado, si la API no contesta se cae una sola vez al inventario
// del navegador y el sistema sigue funcionando. El aviso queda en consola
// porque si se depende del servidor es un problema de despliegue, no del sitio.
//
// El degradado es solo para caídas (red, endpoint inexistente, token inválido).
// Un rechazo con 400/409/422 es el servidor contestando un error de negocio:
// ese sí se muestra en la pantalla y el panel sigue conectado a la API.
async function apiOrLocal(remote, local) {
  if (config.mode !== "api") return local();
  try {
    return await remote();
  } catch (error) {
    if (error?.status === 400 || error?.status === 409 || error?.status === 422) {
      throw error;
    }
    config.mode = "local";
    console.warn(
      `Inventario: ${config.apiBase} no respondio (${error.message}). Sigo con el del navegador.`
    );
    return local();
  }
}

// ---------- API pública del store ----------
export async function listTools() {
  return apiOrLocal(() => api(""), readLocal);
}

function validateTool(input = {}, tools = []) {
  const id = String(input.id ?? "").trim();
  const name = String(input.name ?? "").trim();
  const category = String(input.category ?? "").trim();
  const status = String(input.status ?? "available");

  if (!id || id.length > 64) throw new Error("El ID es obligatorio y no puede superar los 64 caracteres.");
  if (tools.some((tool) => String(tool.id).toLowerCase() === id.toLowerCase())) {
    throw new Error("Ya existe una herramienta con ese ID.");
  }
  if (!name || name.length > 120) throw new Error("El nombre es obligatorio y no puede superar los 120 caracteres.");
  if (category.length > 80) throw new Error("La categoría no puede superar los 80 caracteres.");
  if (!["available", "in_use", "maintenance"].includes(status)) {
    throw new Error("El estado de la herramienta no es válido.");
  }

  return { id, name, category, status, repairs: [] };
}

export async function addTool(input) {
  const tools = readLocal();
  if (config.mode === "api") {
    return apiOrLocal(
      () => api("", { method: "POST", body: JSON.stringify(input) }),
      () => {
        const tool = validateTool(input, tools);
        tools.push(tool);
        writeLocal(tools);
        return tool;
      }
    );
  }

  const tool = validateTool(input, tools);
  tools.push(tool);
  writeLocal(tools);
  return tool;
}

export async function deleteTool(toolId) {
  return apiOrLocal(
    () => api(`/${encodeURIComponent(toolId)}`, { method: "DELETE" }),
    () => {
      const tools = readLocal();
      const index = tools.findIndex((tool) => tool.id === toolId);
      if (index === -1) throw new Error("La herramienta no existe.");
      const [deleted] = tools.splice(index, 1);
      writeLocal(tools);
      return deleted;
    }
  );
}

/**
 * Registra una reparación y suma 1 al contador (por derivación).
 * Si la herramienta estaba "En mantenimiento" y markAvailable es true,
 * pasa a "Disponible" (la reparación quedó terminada).
 */
export async function registerRepair(toolId, input, { markAvailable = true } = {}) {
  const data = validateRepair(input);

  return apiOrLocal(
    () =>
      api(`/${encodeURIComponent(toolId)}/repairs`, {
        method: "POST",
        body: JSON.stringify({ ...data, markAvailable }),
      }),
    () => {
      const tools = readLocal();
      const tool = tools.find((t) => t.id === toolId);
      if (!tool) throw new Error("La herramienta no existe.");

      tool.repairs = tool.repairs ?? [];
      tool.repairs.push({ id: newId(), ...data, createdAt: Date.now() });
      if (markAvailable && tool.status === "maintenance") tool.status = "available";

      writeLocal(tools);
      return tool;
    }
  );
}

/**
 * Horario de las herramientas: cuándo salió del pañol y cuándo entró.
 *
 * `lastOutAt` / `lastInAt` guardan el momento de cada movimiento y `status`
 * se mantiene a tono (prestada = en uso, vuelta = disponible), así la tabla
 * del panel puede mostrar el estado actual junto con las horas de la última
 * salida y de la última entrada.
 */
function lastOutAt(tool) {
  return Number(tool.lastOutAt) > 0 ? Number(tool.lastOutAt) : 0;
}

function lastInAt(tool) {
  return Number(tool.lastInAt) > 0 ? Number(tool.lastInAt) : 0;
}

/** True si la herramienta está afuera: nunca volvió, o volvió antes de salir. */
function estaFuera(tool) {
  // Un tool sin movimientos registrados está en el pañol, aunque su estado
  // diga otra cosa: sin lastOutAt no hubo salida que contar.
  if (tool.status === "in_use") return true;
  const out = lastOutAt(tool);
  return out > 0 && out >= lastInAt(tool);
}

async function markToolMovement(toolId, kind) {
  const yaSale = kind === "out";
  return apiOrLocal(
    () =>
      api(`/${encodeURIComponent(toolId)}/movement`, {
        method: "PATCH",
        body: JSON.stringify({ kind }),
      }),
    () => {
      const tools = readLocal();
      const tool = tools.find((t) => t.id === toolId);
      if (!tool) throw new Error("La herramienta no existe.");

      if (yaSale && estaFuera(tool)) {
        const cuando = lastOutAt(tool)
          ? new Date(lastOutAt(tool)).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
          : "hace un rato";
        throw new Error(`${tool.name} ya está prestada desde ${cuando}.`);
      }
      if (!yaSale && !estaFuera(tool)) {
        throw new Error(lastOutAt(tool) ? `${tool.name} ya está en el pañol.` : `${tool.name} nunca salió.`);
      }

      const ahora = Date.now();
      if (yaSale) {
        tool.lastOutAt = ahora;
        tool.status = "in_use";
      } else {
        tool.lastInAt = ahora;
        tool.status = "available";
      }
      writeLocal(tools);
      return tool;
    }
  );
}

/** Marca la salida: la herramienta pasa a estar prestada. */
export function markToolOut(toolId) {
  return markToolMovement(toolId, "out");
}

/** Marca la entrada: la herramienta vuelve al pañol. */
export function markToolIn(toolId) {
  return markToolMovement(toolId, "in");
}

/** Últimos movimientos de una herramienta, para mostrarlos en la tabla. */
export function toolMovement(tool) {
  return { outAt: lastOutAt(tool), inAt: lastInAt(tool), fuera: estaFuera(tool) };
}

/**
 * Carga tu inventario real (modo local). Conserva el historial de las
 * herramientas que ya existían con el mismo id.
 */
export async function importTools(list) {
  if (config.mode === "api") throw new Error("En modo API, cargá el inventario en el servidor.");
  const current = new Map(readLocal().map((t) => [t.id, t]));
  const merged = list.map((t) => ({
    id: String(t.id),
    name: String(t.name),
    category: String(t.category ?? ""),
    status: t.status ?? "available",
    repairs: current.get(String(t.id))?.repairs ?? t.repairs ?? [],
    lastOutAt: current.get(String(t.id))?.lastOutAt ?? t.lastOutAt ?? 0,
    lastInAt: current.get(String(t.id))?.lastInAt ?? t.lastInAt ?? 0,
  }));
  writeLocal(merged);
  return merged;
}
