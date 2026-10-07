// Registro de entrada y salida de las personas.
//
// Es un fichaje simple: cada persona marca cuándo entra y cuándo sale, y de
// eso queda un registro con fecha y hora. No hay turnos fijos ni calendario:
// lo que importa es saber quién está adentro ahora y cuánto tiempo estuvo.
//
// Igual que los demás stores, si la API no responde sigue con localStorage:
// el panel tiene que poder marcar una entrada aunque el servidor esté caído.
import { adminToken } from "./repairs-store.js";

const LS_KEY = "lotus.shifts.v1";
const MAX_NAME = 80;

const config = {
  mode: location.protocol === "file:" ? "local" : "api",
  apiBase: "/api/shifts",
};

/** Sobrescribe el modo si una instalación necesita otra configuración. */
export function configureShifts(options = {}) {
  Object.assign(config, options);
}

const clean = (value) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME);

// Dos nombres que solo cambian en mayúsculas o tildes son la misma persona:
// si no, "Juan Pérez" y "JUAN PEREZ" quedarían como dos adentros distintos.
const personKey = (name) =>
  clean(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const newId = () =>
  `LOTUS-E${String(Date.now()).slice(-6)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

function validateName(input) {
  const name = clean(input?.name);
  if (!name) throw new Error("Falta el nombre de la persona.");
  return name;
}

function validateShift(input = {}) {
  const name = validateName(input);
  const entryAt = Number(input.entryAt);
  const exitAt = input.exitAt === null || input.exitAt === undefined ? null : Number(input.exitAt);
  if (!Number.isFinite(entryAt) || entryAt <= 0) throw new Error("La hora de entrada no es válida.");
  if (exitAt !== null && (!Number.isFinite(exitAt) || exitAt < entryAt)) {
    throw new Error("La hora de salida tiene que ser posterior a la de entrada.");
  }
  return { name, entryAt, exitAt };
}

// ---------- Local ----------
function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data;
    }
  } catch {
    /* si está corrupto, se empieza de cero */
  }
  return [];
}

function writeLocal(shifts) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(shifts));
  } catch {
    throw new Error("No se pudo guardar en este navegador (almacenamiento lleno o bloqueado).");
  }
}

// ---------- API ----------
async function api(path, options = {}) {
  const token = adminToken();
  const res = await fetch(`${config.apiBase}${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", ...(token ? { "x-admin-token": token } : {}), ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Error del servidor (${res.status}).`);
    // 400/409/422 son errores de negocio (persona repetida, registro
    // inexistente): el servidor está vivo y contestó, así que esos errores
    // tienen que llegar a la pantalla y no silenciarse cambiando al navegador.
    error.status = res.status;
    throw error;
  }
  return data;
}

async function apiOrLocal(remote, local) {
  if (config.mode !== "api") return local();
  try {
    return await remote();
  } catch (error) {
    // Un rechazo del servidor no es una caída de la API: se muestra y el panel
    // sigue conectado. Solo un fallo de red o un endpoint inexistente degrada.
    if (error?.status === 400 || error?.status === 409 || error?.status === 422) {
      throw error;
    }
    // 401 sin token: esta operación cae al navegador pero el modo NO queda
    // fijo en "local". Si después se entra al panel y se guarda el token, las
    // próximas escrituras vuelven a ir al servidor.
    if (error?.status === 401) {
      console.warn(`Entradas y salidas: ${config.apiBase} pidió token y no hay. Hago esta operación en el navegador.`);
      return local();
    }
    config.mode = "local";
    console.warn(`Entradas y salidas: ${config.apiBase} no respondió (${error.message}). Sigo con el del navegador.`);
    return local();
  }
}

// ---------- API pública ----------
export async function listShifts() {
  return apiOrLocal(() => api(""), readLocal);
}

/**
 * Marca la entrada. Si esa persona ya tiene una entrada abierta, no crea otra:
 * duplicar el registro haría que cuente dos veces la misma jornada.
 */
export async function startShift(input) {
  const name = validateName(input);
  return apiOrLocal(
    () => api("", { method: "POST", body: JSON.stringify({ name }) }),
    () => {
      const shifts = readLocal();
      const abierta = shifts.find((s) => s.exitAt === null && personKey(s.name) === personKey(name));
      if (abierta) {
        throw new Error(`${abierta.name} ya está adentro desde ${new Date(abierta.entryAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}.`);
      }
      const shift = { id: newId(), name, entryAt: Date.now(), exitAt: null, updatedAt: Date.now() };
      shifts.push(shift);
      writeLocal(shifts);
      return shift;
    }
  );
}

/** Marca la salida. Requiere el id para no cerrarle la jornada a otro. */
export async function endShift(id) {
  if (!id) throw new Error("Falta el registro de entrada.");
  return apiOrLocal(
    () => api(`/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ kind: "out" }) }),
    () => {
      const shifts = readLocal();
      const shift = shifts.find((s) => s.id === id);
      if (!shift) throw new Error("Ese registro de entrada no existe.");
      if (shift.exitAt !== null) throw new Error(`${shift.name} ya había salido.`);
      shift.exitAt = Date.now();
      shift.updatedAt = Date.now();
      writeLocal(shifts);
      return shift;
    }
  );
}

export async function deleteShift(id) {
  if (!id) throw new Error("Falta el registro de entrada.");
  return apiOrLocal(
    () => api(`/${encodeURIComponent(id)}`, { method: "DELETE" }),
    () => {
      const shifts = readLocal();
      const index = shifts.findIndex((s) => s.id === id);
      if (index === -1) throw new Error("Ese registro de entrada no existe.");
      const [deleted] = shifts.splice(index, 1);
      writeLocal(shifts);
      return deleted;
    }
  );
}

/** Quiénes están adentro ahora. */
export function insideNow(shifts, now = Date.now()) {
  return shifts.filter((s) => s.exitAt === null && s.entryAt <= now);
}

/**
 * Duración del registro en milisegundos. Para una entrada abierta usa `now`,
 * así el panel puede mostrar el tiempo corriendo sin tener que guardar nada.
 */
export function shiftDuration(shift, now = Date.now()) {
  const fin = shift.exitAt ?? now;
  return Math.max(0, fin - shift.entryAt);
}

/** Nombres ya registrados, para autocompletar la próxima entrada. */
export function knownPeople(shifts) {
  const vistos = new Map();
  for (const s of shifts) vistos.set(personKey(s.name), s.name);
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, "es"));
}
