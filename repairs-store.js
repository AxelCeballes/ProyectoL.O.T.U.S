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
//   "local" (por defecto): localStorage del navegador. Sirve para la demo.
//   "api": usa el router de Express (server/repairs-router.js).

const LS_KEY = "lotus.tools.v1";
const config = { mode: "local", apiBase: "/api/tools" };

/** Cambiá el modo desde tu código: configureStore({ mode: "api" }) */
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
function adminToken() {
  let token = sessionStorage.getItem("lotus.adminToken");
  if (!token) {
    token = window.prompt("Token de administrador:") ?? "";
    if (token) sessionStorage.setItem("lotus.adminToken", token);
  }
  return token;
}

async function api(path, options = {}) {
  const res = await fetch(`${config.apiBase}${path}`, {
    ...options,
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
  if (!res.ok) throw new Error(data.error || `Error del servidor (${res.status}).`);
  return data;
}

// ---------- API pública del store ----------
export async function listTools() {
  if (config.mode === "api") return api("");
  return readLocal();
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
  if (config.mode === "api") {
    return api("", { method: "POST", body: JSON.stringify(input) });
  }

  const tools = readLocal();
  const tool = validateTool(input, tools);
  tools.push(tool);
  writeLocal(tools);
  return tool;
}

export async function deleteTool(toolId) {
  if (config.mode === "api") {
    return api(`/${encodeURIComponent(toolId)}`, { method: "DELETE" });
  }

  const tools = readLocal();
  const index = tools.findIndex((tool) => tool.id === toolId);
  if (index === -1) throw new Error("La herramienta no existe.");
  const [deleted] = tools.splice(index, 1);
  writeLocal(tools);
  return deleted;
}

/**
 * Registra una reparación y suma 1 al contador (por derivación).
 * Si la herramienta estaba "En mantenimiento" y markAvailable es true,
 * pasa a "Disponible" (la reparación quedó terminada).
 */
export async function registerRepair(toolId, input, { markAvailable = true } = {}) {
  const data = validateRepair(input);

  if (config.mode === "api") {
    return api(`/${encodeURIComponent(toolId)}/repairs`, {
      method: "POST",
      body: JSON.stringify({ ...data, markAvailable }),
    });
  }

  const tools = readLocal();
  const tool = tools.find((t) => t.id === toolId);
  if (!tool) throw new Error("La herramienta no existe.");

  tool.repairs = tool.repairs ?? [];
  tool.repairs.push({ id: newId(), ...data, createdAt: Date.now() });
  if (markAvailable && tool.status === "maintenance") tool.status = "available";

  writeLocal(tools);
  return tool;
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
  }));
  writeLocal(merged);
  return merged;
}
