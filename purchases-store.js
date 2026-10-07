// Pedidos de reposición.
//
// Esto NO es inventario de herramientas: son cosas que hay que comprar
// (discos, guantes, papel, etc.) que el pañol detectó que se están terminando.
// Vive aparte a propósito. Un disco de corte que falta no es una herramienta rota,
// y meterlo en el inventario hacía que el panel lo mostrara como si fuera una
// máquina del taller.
//
// Igual que repairs-store, degrada de API a localStorage si el servidor de
// inventario no está: el site tiene que poder anotar un pedido aunque el
// backend todavía no exista.
import { adminToken } from "./repairs-store.js";
import { semillaConsumibles } from "./seed-consumibles.js";

const LS_KEY = "lotus.purchases.v1";
const MAX_NAME = 120;
const MAX_NOTE = 300;
const MAX_QUANTITY = 999;
const STATUSES = new Set(["pending", "ordered", "received"]);

const config = {
  mode: location.protocol === "file:" ? "local" : "api",
  apiBase: "/api/purchases",
};

/** Sobrescribe el modo si una instalación necesita otra configuración. */
export function configurePurchases(options = {}) {
  Object.assign(config, options);
}

const clean = (value, max) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const newId = () =>
  `LOTUS-P${String(Date.now()).slice(-6)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

// Pedir dos veces lo mismo no sirve de nada: se suman las cantidades en el
// pedido abierto. La comparación es sin tildes ni mayúsculas porque el modelo
// escribe "Disco de corte" y "disco corte" para lo mismo.
const key = (name) =>
  clean(name, MAX_NAME)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function validate(input = {}) {
  const name = clean(input.name, MAX_NAME);
  if (!name) throw new Error("El pedido necesita un nombre.");

  const rawQty = Number(input.quantity);
  const quantity = Number.isFinite(rawQty) ? Math.round(rawQty) : 1;
  if (quantity < 1) throw new Error("La cantidad tiene que ser al menos 1.");
  if (quantity > MAX_QUANTITY) throw new Error(`La cantidad no puede superar ${MAX_QUANTITY}.`);

  const status = STATUSES.has(input.status) ? input.status : "pending";
  return {
    name,
    category: clean(input.category, 80) || "Consumibles",
    quantity,
    note: clean(input.note, MAX_NOTE),
    status,
  };
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
  // Primera vez que se abre Compras sin nada guardado: se siembran consumibles
  // típicos del taller (tarugos, tornillos, discos de corte) con cantidades
  // al azar y algunos faltantes, así la pestaña no arranca en blanco y se
  // entiende qué es "para comprar". Una vez escrito (aunque quede como []),
  // no vuelve a sembrar: la decisión de borrarlos es del usuario.
  const semilla = semillaConsumibles();
  writeLocal(semilla);
  return semilla;
}

function writeLocal(purchases) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(purchases));
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
    // 400/409/422 son errores de negocio (pedido repetido, cantidad inválida,
    // registro inexistente): el servidor está vivo y contestó, así que esos
    // errores tienen que llegar a la pantalla y no silenciarse cambiando al
    // navegador.
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
      console.warn(`Pedidos de compra: ${config.apiBase} pidió token y no hay. Hago esta operación en el navegador.`);
      return local();
    }
    config.mode = "local";
    console.warn(`Pedidos de compra: ${config.apiBase} no respondió (${error.message}). Sigo con el del navegador.`);
    return local();
  }
}

// ---------- API pública ----------
export async function listPurchases() {
  return apiOrLocal(() => api(""), readLocal);
}

export async function addPurchase(input) {
  const pedido = validate(input);
  return apiOrLocal(
    () => api("", { method: "POST", body: JSON.stringify(pedido) }),
    () => {
      const purchases = readLocal();
      const existing = purchases.find((p) => p.status !== "received" && key(p.name) === key(pedido.name));
      if (existing) {
        existing.quantity = Math.min(existing.quantity + pedido.quantity, MAX_QUANTITY);
        existing.updatedAt = Date.now();
        writeLocal(purchases);
        return existing;
      }
      const nuevo = { id: newId(), ...pedido, createdAt: Date.now(), updatedAt: Date.now() };
      purchases.push(nuevo);
      writeLocal(purchases);
      return nuevo;
    }
  );
}

export async function setPurchaseStatus(id, status) {
  if (!STATUSES.has(status)) throw new Error("El estado del pedido no es válido.");
  return apiOrLocal(
    () => api(`/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    () => {
      const purchases = readLocal();
      const found = purchases.find((p) => p.id === id);
      if (!found) throw new Error("El pedido no existe.");
      found.status = status;
      found.updatedAt = Date.now();
      writeLocal(purchases);
      return found;
    }
  );
}

export async function deletePurchase(id) {
  return apiOrLocal(
    () => api(`/${encodeURIComponent(id)}`, { method: "DELETE" }),
    () => {
      const purchases = readLocal();
      const index = purchases.findIndex((p) => p.id === id);
      if (index === -1) throw new Error("El pedido no existe.");
      const [deleted] = purchases.splice(index, 1);
      writeLocal(purchases);
      return deleted;
    }
  );
}

/** Sólo los que todavía hay que resolver, que es lo que se mira en pantalla. */
export function openPurchases(purchases) {
  return purchases.filter((p) => p.status !== "received");
}