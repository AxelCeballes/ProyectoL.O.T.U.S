// admin/admin-panel.js
// Panel Admin de L.O.T.U.S (JavaScript puro, sin dependencias).
// Uso:  import { mountAdminPanel } from "./admin/admin-panel.js";  mountAdminPanel();

import {
  configureStore,
  listTools,
  addTool,
  deleteTool,
  markToolOut,
  markToolIn,
  toolMovement,
  registerRepair,
  repairCount,
  sortedRepairs,
  lastRepairDate,
  allRepairs,
  downloadExcel,
  requestAdminToken,
} from "./repairs-store.js";
import {
  listShifts,
  startShift,
  endShift,
  deleteShift,
  insideNow,
  knownPeople,
  shiftDuration,
} from "./people-store.js";
import {
  listPurchases,
  setPurchaseStatus,
  deletePurchase,
  openPurchases,
} from "./purchases-store.js";

const STATUS = {
  available: { label: "estadoDisponible", cls: "ok" },
  in_use: { label: "estadoEnUso", cls: "use" },
  maintenance: { label: "estadoEnMantenimiento", cls: "warn" },
};

// Los pedidos de compra tienen sus propios estados: un consumible que hay que
// comprar no está ni disponible ni en mantenimiento.
const PURCHASE_STATUS = {
  pending: { label: "pedidoEstado", cls: "warn" },
  ordered: { label: "compradoEstado", cls: "use" },
  received: { label: "recibidoEstado", cls: "ok" },
};

// Traducciones: el panel corre como módulo y i18n.js ya cargó en el <head>.
// Las claves del label quedan guardadas en los maps de arriba y se resuelven
// recién al dibujar, así el cambio de idioma repinta todo con render().
// Se llama `tr` (no `t`) para no pisar la variable de herramienta en los map.
const tr = (...args) => (window.LOTUS_I18N ? window.LOTUS_I18N.t(...args) : args[0]);
const loc = () => (window.LOTUS_I18N ? window.LOTUS_I18N.locale() : "es-AR");

const ADMIN_PASSWORD = "falmet";

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// "2026-10-04" -> "04 oct 2026" (sin pasar por UTC, para que no se corra un día)
function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(loc(), { day: "2-digit", month: "short", year: "numeric" });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- Hora y duración ----------
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

function fmtTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString(loc(), { hour: "2-digit", minute: "2-digit" });
}

/** "04/10 14:20", con el día solo si no es hoy: hoy ya lo dice el reloj. */
function fmtWhen(ms) {
  if (!ms) return "—";
  const fecha = new Date(ms);
  const hora = fmtTime(ms);
  return sameDay(ms, Date.now()) ? hora : `${fecha.getDate()}/${fecha.getMonth() + 1} ${hora}`;
}

/** "3 h 12 m" o "45 m". Para los registros abiertos corre con `now`. */
function fmtDuration(ms) {
  if (ms < 0) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 1) return tr("menosDe1m");
  const h = Math.floor(min / 60);
  return h ? `${h} h ${min % 60} m` : `${min} m`;
}

const badge = (status) => {
  const s = STATUS[status] ?? { label: null, cls: "use" };
  return `<span class="lap-badge lap-badge--${s.cls}">${esc(s.label ? tr(s.label) : status)}</span>`;
};

const purchaseBadge = (status) => {
  const s = PURCHASE_STATUS[status] ?? { label: null, cls: "use" };
  return `<span class="lap-badge lap-badge--${s.cls}">${esc(s.label ? tr(s.label) : status)}</span>`;
};

export function mountAdminPanel({ store } = {}) {
  if (store) configureStore(store);

  const state = {
    view: "tools",
    tools: [],
    purchases: [],
    shifts: [],
    query: "",
    selectedId: null,
    loading: false,
    error: "",
    flashId: null,
  };
  let isAuthenticated = false;

  // ---------- DOM base ----------
  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "lap-launcher";
  launcher.setAttribute("aria-label", "Abrir panel de administración");
  launcher.title = "Panel de administración";
  launcher.setAttribute("data-i18n-aria", "adminAbrir");
  launcher.setAttribute("data-i18n-title", "panelAdmin");
  launcher.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 3l8 4v5c0 4.5-3.1 7.7-8 9-4.9-1.3-8-4.5-8-9V7l8-4z"/>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 12l2 2 4-4"/>
    </svg>
    <span>Admin</span>`;

  const authDialog = document.createElement("dialog");
  authDialog.className = "lap-auth";
  authDialog.setAttribute("aria-labelledby", "lap-auth-title");
  authDialog.innerHTML = `
    <form class="lap-auth__form">
      <h2 id="lap-auth-title" data-i18n="authTitulo">Acceso de administrador</h2>
      <p data-i18n="authDesc">Ingresá la contraseña para abrir el panel.</p>
      <label for="lap-auth-password" data-i18n="authPassword">Contraseña</label>
      <input id="lap-auth-password" name="password" type="password" autocomplete="current-password" required>
      <p class="lap-auth__error" role="alert" hidden data-i18n="authIncorrecta">La contraseña es incorrecta.</p>
      <div class="lap-auth__actions">
        <button type="button" class="lap-auth__cancel" data-i18n="authCancelar">Cancelar</button>
        <button type="submit" class="lap-auth__submit" data-i18n="authIngresar">Ingresar</button>
      </div>
    </form>`;

  const root = document.createElement("div");
  root.className = "lap";
  root.hidden = true;
  root.innerHTML = `
    <div class="lap__shell" role="dialog" aria-modal="true" aria-labelledby="lap-title">
      <nav class="lap__sidebar" aria-label="Administración">
        <div class="lap__brand">L.O.T.U.S<span>Panel Admin</span></div>
        <button type="button" class="lap__nav" data-action="nav" data-view="tools" data-i18n="navHerramientas">Herramientas</button>
        <button type="button" class="lap__nav" data-action="nav" data-view="history" data-i18n="navReparaciones">Reparaciones</button>
        <button type="button" class="lap__nav" data-action="nav" data-view="purchases" data-i18n="navCompras">Compras</button>
        <button type="button" class="lap__nav" data-action="nav" data-view="shifts" data-i18n="navPersonal">Personal</button>
        <button type="button" class="lap__nav lap__nav--exit" data-action="close" data-i18n="navVolver">Volver al terminal</button>
      </nav>
      <main class="lap__main">
        <header class="lap__head">
          <h2 id="lap-title" class="lap__title"></h2>
          <button type="button" class="lap__x" data-action="close" aria-label="Cerrar panel" data-i18n-aria="cerrarPanelAria">✕</button>
        </header>
        <div class="lap__content"></div>
      </main>
      <aside class="lap__drawer" hidden aria-label="Historial de reparaciones" data-i18n-aria="drawerAria"></aside>
    </div>`;

  const headerControls = document.querySelector("header > div:last-child");
  if (!headerControls) throw new Error("No se encontró el encabezado para ubicar el acceso de administración.");
  headerControls.append(launcher);
  document.body.append(authDialog);
  document.body.append(root);

  const authForm = authDialog.querySelector(".lap-auth__form");
  const authPassword = authDialog.querySelector("#lap-auth-password");
  const authError = authDialog.querySelector(".lap-auth__error");
  const titleEl = root.querySelector(".lap__title");
  const contentEl = root.querySelector(".lap__content");
  const drawerEl = root.querySelector(".lap__drawer");

  // ---------- Vistas ----------
  function tableHTML() {
    if (!state.tools.length) {
      return `<p class="lap__state">${tr("emptyTools")}</p>`;
    }
    const q = state.query.trim().toLowerCase();
    const rows = state.tools.filter((t) =>
      !q || [t.id, t.name, t.category].some((v) => String(v ?? "").toLowerCase().includes(q))
    );
    if (!rows.length) return `<p class="lap__state">${tr("sinCoincidencia")}</p>`;

    return `
      <table class="lap-table">
        <thead>
          <tr>
            <th>ID</th><th>${tr("herramienta")}</th><th>${tr("thCategoria")}</th><th>${tr("estado")}</th>
            <th>${tr("thHorario")}</th><th>${tr("thReparaciones")}</th><th>${tr("thUltReparacion")}</th><th>${tr("thAcciones")}</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((t) => {
              const n = repairCount(t);
              const { outAt, inAt, fuera } = toolMovement(t);
              return `
              <tr data-action="open-tool" data-id="${esc(t.id)}" class="${t.id === state.selectedId ? "is-selected" : ""}">
                <td class="lap-mono">${esc(t.id)}</td>
                <td>${esc(t.name)}</td>
                <td>${esc(t.category)}</td>
                <td>${badge(t.status)}</td>
                <td class="lap-mono lap-dim lap-hours">
                  <span>${tr("sal")} ${esc(fmtWhen(outAt))}</span>
                  <span>${tr("ent")} ${esc(fmtWhen(inAt))}</span>
                </td>
                <td>
                  <button type="button" class="lap-count${n === 0 ? " lap-count--zero" : ""}" data-action="open-tool" data-id="${esc(t.id)}"
                    aria-label="${esc(tr("verHistorialAria", { name: t.name, n }))}">${n}</button>
                </td>
                <td>${fmtDate(lastRepairDate(t))}</td>
                <td class="lap__rowactions">
                  ${
                    fuera
                      ? `<button type="button" class="lap-btn lap-btn--ghost" data-action="tool-in" data-id="${esc(t.id)}"
                          aria-label="${esc(tr("marcarEntradaAria", { name: t.name }))}">${tr("marcarEntrada")}</button>`
                      : `<button type="button" class="lap-btn lap-btn--ghost" data-action="tool-out" data-id="${esc(t.id)}"
                          aria-label="${esc(tr("marcarSalidaAria", { name: t.name }))}">${tr("marcarSalida")}</button>`
                  }
                  <button type="button" class="lap-delete-btn" data-action="delete-tool" data-id="${esc(t.id)}"
                    aria-label="${esc(tr("eliminarAria", { name: t.name }))}">${tr("eliminar")}</button>
                </td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;
  }

  function toolsView() {
    const total = state.tools.reduce((sum, t) => sum + repairCount(t), 0);
    return `
      <div class="lap__toolbar">
        <input type="search" id="lap-search" class="lap__search" placeholder="${tr("buscarPanelPlaceholder")}"
          value="${esc(state.query)}" aria-label="${tr("buscarAria")}" />
        <span class="lap__meta">${tr("metaHerramientas", { tools: state.tools.length, repairs: total })}</span>
        <button type="button" class="lap-btn" data-action="download-excel">${tr("descargarExcel")}</button>
      </div>
      <details class="lap-add">
        <summary>${tr("agregarHerramienta")}</summary>
        <form data-form="tool" novalidate>
          <label>${tr("labelId")}
            <input type="text" name="id" maxlength="64" required placeholder="${tr("phId")}" />
          </label>
          <label>${tr("labelNombre")}
            <input type="text" name="name" maxlength="120" required placeholder="${tr("phNombre")}" />
          </label>
          <label>${tr("labelCategoria")}
            <input type="text" name="category" maxlength="80" placeholder="${tr("phCategoria")}" />
          </label>
          <label>${tr("labelEstadoInicial")}
            <select name="status">
              <option value="available">${tr("estadoDisponible")}</option>
              <option value="in_use">${tr("estadoEnUso")}</option>
              <option value="maintenance">${tr("estadoEnMantenimiento")}</option>
            </select>
          </label>
          <p class="lap-add__error" role="alert" hidden></p>
          <button type="submit" class="lap-btn">${tr("guardarHerramienta")}</button>
        </form>
      </details>
      <div class="lap__tablewrap" id="lap-table">${tableHTML()}</div>`;
  }

  // ---------- Compras ----------
  // Es lo que el bot genera cuando el operario dice que falta algo consumible.
  // Avisa con un resaltado qué falta comprar: son los pedidos que el chat anotó
  // ("faltan tornillos", "faltan discos de corte") y todavía no cerraron.
  function faltanteBanner() {
    const pendientes = state.purchases.filter((p) => p.status === "pending");
    const enCamino = state.purchases.filter((p) => p.status === "ordered");
    const total = pendientes.length + enCamino.length;

    if (total === 0) {
      return `<div class="mb-4 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        <svg class="h-5 w-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>
        <span>${tr("todoAlDia")}</span>
      </div>`;
    }

    const listar = (items) =>
      items
        .slice(0, 8)
        .map((p) => `${esc(p.name)} (x${Number(p.quantity)})`)
        .join(", ") + (items.length > 8 ? tr("yMas", { extra: items.length - 8 }) : "");

    const partes = [];
    if (pendientes.length) partes.push(tr("faltan", { items: listar(pendientes) }));
    if (enCamino.length) partes.push(tr("yaEnCamino", { items: listar(enCamino) }));

    return `<div class="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
      <div class="flex items-center gap-3">
        <svg class="h-5 w-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg>
        <span>${tr(total > 1 ? "sinCerrarPlural" : "sinCerrarSing", { total, partes: partes.join(" ") })}</span>
      </div>
    </div>`;
  }

  function purchasesView() {
    const abiertas = openPurchases(state.purchases);
    const cerradas = state.purchases.filter((p) => p.status === "received");
    const banner = faltanteBanner();

    if (!state.purchases.length) {
      return `${banner}<p class="lap__state">${tr("pedidosVacio")}</p>`;
    }

    const tabla = (filas, vacio) => `
      <div class="lap__tablewrap">
        <table class="lap-table">
          <thead><tr><th>${tr("thArticulo")}</th><th>${tr("thCantidad")}</th><th>${tr("estado")}</th><th></th></tr></thead>
          <tbody>
            ${
              filas.length
                ? filas
                    .map(
                      (p) => `
              <tr>
                <td>${esc(p.name)}${p.note ? `<br><span class="lap-dim">${esc(p.note)}</span>` : ""}</td>
                <td>${Number(p.quantity)}</td>
                <td>${purchaseBadge(p.status)}</td>
                <td class="lap__rowactions">
                  ${
                    p.status === "pending"
                      ? `<button type="button" class="lap-btn lap-btn--ghost" data-action="purchase-status" data-id="${esc(p.id)}" data-status="ordered">${tr("marcarComprado")}</button>`
                      : ""
                  }
                  ${
                    p.status !== "received"
                      ? `<button type="button" class="lap-btn lap-btn--ghost" data-action="purchase-status" data-id="${esc(p.id)}" data-status="received">${tr("marcarRecibido")}</button>`
                      : ""
                  }
                  <button type="button" class="lap-btn lap-btn--ghost" data-action="purchase-delete" data-id="${esc(p.id)}">${tr("borrar")}</button>
                </td>
              </tr>`
                    )
                    .join("")
                : `<tr><td colspan="4" class="lap-dim">${vacio}</td></tr>`
            }
          </tbody>
        </table>
      </div>`;

    return `
      ${banner}
      <h3 class="lap__sub">${tr("paraComprar", { n: abiertas.length })}</h3>
      ${tabla(abiertas, tr("nadaPendiente"))}
      ${cerradas.length ? `<h3 class="lap__sub">${tr("recibidos", { n: cerradas.length })}</h3>${tabla(cerradas, "")}` : ""}`;
  }

  // ---------- Personal ----------
  // Fichaje simple: cuándo entró cada persona, cuándo salió y cuánto duró.
  function shiftsView() {
    const ahora = Date.now();
    const adentro = insideNow(state.shifts, ahora);
    // Primero los que están adentro, y después lo más reciente arriba.
    const orden = [...state.shifts].sort(
      (a, b) => (a.exitAt === null ? 0 : 1) - (b.exitAt === null ? 0 : 1) || b.entryAt - a.entryAt
    );
    const personas = knownPeople(state.shifts);

    const filas = orden.length
      ? orden
          .map((s) => {
            const abierto = s.exitAt === null;
            return `
              <tr>
                <td>${esc(s.name)}</td>
                <td class="lap-mono">${esc(fmtWhen(s.entryAt))}</td>
                <td class="lap-mono">${abierto ? `<span class="lap-badge lap-badge--warn">${tr("adentroBadge")}</span>` : esc(fmtWhen(s.exitAt))}</td>
                <td class="lap-mono"${abierto ? ` data-live-duration="${esc(s.entryAt)}"` : ""}>${esc(fmtDuration(shiftDuration(s, ahora)))}</td>
                <td class="lap__rowactions">
                  ${
                    abierto
                      ? `<button type="button" class="lap-btn lap-btn--ghost" data-action="shift-out" data-id="${esc(s.id)}"
                          aria-label="${esc(tr("marcarSalidaAria", { name: s.name }))}">${tr("marcarSalidaFrame")}</button>`
                      : ""
                  }
                  <button type="button" class="lap-btn lap-btn--ghost" data-action="shift-delete" data-id="${esc(s.id)}"
                    aria-label="${esc(tr("borrarRegistroAria", { name: s.name }))}">${tr("borrar")}</button>
                </td>
              </tr>`;
          })
          .join("")
      : `<tr><td colspan="5" class="lap-dim">${tr("sinEntradas")}</td></tr>`;

    return `
      <div class="lap__toolbar">
        <span class="lap__meta">${tr("metaPersonal", { adentro: adentro.length, total: state.shifts.length })}</span>
      </div>
      <details class="lap-add" open>
        <summary>${tr("marcarEntradaFrame")}</summary>
        <form data-form="shift" novalidate>
          <label>${tr("labelPersona")}
            <input type="text" name="name" list="lap-people" maxlength="80" required
              placeholder="${tr("phNombreApellido")}" autocomplete="off" />
            <datalist id="lap-people">
              ${personas.map((p) => `<option value="${esc(p)}"></option>`).join("")}
            </datalist>
          </label>
          <p class="lap-add__error" role="alert" hidden></p>
          <button type="submit" class="lap-btn">${tr("marcarEntradaFrame")}</button>
        </form>
      </details>
      <div class="lap__tablewrap">
        <table class="lap-table">
          <thead><tr><th>${tr("thPersona")}</th><th>${tr("thEntrada")}</th><th>${tr("thSalida")}</th><th>${tr("thDuracion")}</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`;
  }

  function historyView() {
    const repairs = allRepairs(state.tools);
    if (!repairs.length) return `<p class="lap__state">${tr("sinReparaciones")}</p>`;
    return `
      <div class="lap__tablewrap">
        <table class="lap-table">
          <thead><tr><th>${tr("fecha")}</th><th>${tr("herramienta")}</th><th>${tr("motivo")}</th><th>${tr("thTecnico")}</th></tr></thead>
          <tbody>
            ${repairs
              .map(
                (r) => `
              <tr data-action="open-tool" data-id="${esc(r.toolId)}">
                <td>${fmtDate(r.date)}</td>
                <td>${esc(r.toolName)} <span class="lap-mono lap-dim">${esc(r.toolId)}</span></td>
                <td>${esc(r.reason)}</td>
                <td>${esc(r.technician) || "—"}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
  }

  function drawerHTML(tool, flashId) {
    const repairs = sortedRepairs(tool);
    return `
      <header class="lap-drawer__head">
        <div>
          <h3 class="lap-drawer__name">${esc(tool.name)}</h3>
          <p class="lap-mono lap-dim">${esc(tool.id)} · ${badge(tool.status)}</p>
        </div>
        <button type="button" class="lap__x" data-action="close-drawer" aria-label="Cerrar historial" data-i18n-aria="cerrarHistorialAria">✕</button>
      </header>

      <div class="lap-drawer__stats">
        <div><strong class="lap-bignum">${repairs.length}</strong><span>${tr("reparacionesEst")}</span></div>
        <div><strong>${fmtDate(lastRepairDate(tool))}</strong><span>${tr("ultimaReparacion")}</span></div>
      </div>

      <div class="lap-drawer__stats">
        <div><strong>${esc(fmtWhen(toolMovement(tool).outAt))}</strong><span>${tr("ultimaSalida")}</span></div>
        <div><strong>${esc(fmtWhen(toolMovement(tool).inAt))}</strong><span>${tr("ultimaEntrada")}</span></div>
      </div>
      <div class="lap-drawer__actions">
        ${
          toolMovement(tool).fuera
            ? `<button type="button" class="lap-btn" data-action="tool-in" data-id="${esc(tool.id)}">${tr("marcarEntradaFrame")}</button>`
            : `<button type="button" class="lap-btn" data-action="tool-out" data-id="${esc(tool.id)}">${tr("marcarSalidaFrame")}</button>`
        }
      </div>

      <h4 class="lap-drawer__sub">${tr("historialTitulo")}</h4>
      ${
        repairs.length
          ? `<ol class="lap-timeline">
              ${repairs
                .map(
                  (r) => `
                <li class="${r.id === flashId ? "is-new" : ""}">
                  <time>${fmtDate(r.date)}</time>
                  <p class="lap-reason">${esc(r.reason)}</p>
                  ${r.technician ? `<p class="lap-dim">${tr("tecnicoLabel", { technician: esc(r.technician) })}</p>` : ""}
                  ${r.notes ? `<p class="lap-notes">${esc(r.notes)}</p>` : ""}
                </li>`
                )
                .join("")}
            </ol>`
          : `<p class="lap__state">${tr("sinReparacionesTool")}</p>`
      }

      <details class="lap-form">
        <summary>${tr("registrarReparacion")}</summary>
        <form data-form="repair" novalidate>
          <label>${tr("fecha")}
            <input type="date" name="date" value="${todayISO()}" max="${todayISO()}" required />
          </label>
          <label>${tr("motivo")}
            <input type="text" name="reason" maxlength="300" required placeholder="${tr("phMotivo")}" />
          </label>
          <label>${tr("tecnico")}
            <input type="text" name="technician" maxlength="80" placeholder="${tr("phOpcional")}" />
          </label>
          <label>${tr("notas")}
            <textarea name="notes" rows="3" maxlength="500" placeholder="${tr("phOpcional")}"></textarea>
          </label>
          <p class="lap-form__error" role="alert" hidden></p>
          <button type="submit" class="lap-btn">${tr("guardarReparacion")}</button>
        </form>
      </details>`;
  }

  // ---------- Render ----------
  function render() {
    titleEl.textContent =
      state.view === "tools"
        ? tr("tituloInventario")
        : state.view === "history"
          ? tr("tituloReparaciones")
          : state.view === "purchases"
            ? tr("tituloCompras")
            : tr("tituloPersonal");
    root.querySelectorAll("[data-view]").forEach((b) => {
      const active = b.dataset.view === state.view;
      b.classList.toggle("is-active", active);
      b.toggleAttribute("aria-current", active);
    });

    // El menú avisa cuánto falta cerrar en Compras sin entrar a la pestaña.
    const navCompras = root.querySelector('.lap__nav[data-view="purchases"]');
    const porCerrar = openPurchases(state.purchases).length;
    navCompras.textContent = porCerrar ? `${tr("navCompras")} (${porCerrar})` : tr("navCompras");

    // El error no se queda como única pantalla: se muestra arriba y la vista
    // igual se dibuja debajo, así compras y personal siguen siendo usables
    // aunque el inventario no pueda cargarse.
    const bloqueError = state.error
      ? `<p class="lap__state lap__state--error" role="alert">${esc(state.error)}</p>
         <button type="button" class="lap-btn" data-action="retry">${tr("retry")}</button>`
      : "";

    if (state.loading && !state.tools.length) {
      contentEl.innerHTML = `${bloqueError}<p class="lap__state">${tr("cargando")}</p>`;
    } else {
      const vista =
        state.view === "tools"
          ? toolsView()
          : state.view === "history"
            ? historyView()
            : state.view === "purchases"
              ? purchasesView()
              : shiftsView();
      contentEl.innerHTML = bloqueError ? bloqueError + vista : vista;
    }

    const tool = state.tools.find((t) => t.id === state.selectedId);
    const flash = state.flashId;
    state.flashId = null;
    drawerEl.hidden = !tool;
    if (tool) drawerEl.innerHTML = drawerHTML(tool, flash);
  }

  async function refresh() {
    state.loading = true;
    state.error = "";
    render();

    // El token ya quedó guardado al entrar (requestAdminToken en open), así que
    // las lecturas traen datos del servidor. El inventario va primero y compras
    // y personal se cargan aparte: si uno falla, no arrastra al resto.
    try {
      state.tools = await listTools();
    } catch (err) {
      state.error = err.message || tr("errCargarInventario");
    }

    // Se cargan aparte del inventario: si compras o personal fallan, el panel
    // igual tiene que mostrar sus datos y no arrastrar el error al resto.
    const [purchases, shifts] = await Promise.all([
      listPurchases().catch(() => []),
      listShifts().catch(() => []),
    ]);
    state.purchases = purchases;
    state.shifts = shifts;

    state.loading = false;
    render();
  }

  // ---------- Abrir / cerrar ----------
  function open() {
    if (!isAuthenticated) {
      authError.hidden = true;
      authPassword.value = "";
      authDialog.showModal();
      authPassword.focus();
      return;
    }
    root.hidden = false;
    document.body.style.overflow = "hidden";
    refresh().then(() => root.querySelector(".lap__nav.is-active")?.focus());
  }

  function close() {
    root.hidden = true;
    state.selectedId = null;
    isAuthenticated = false;
    document.body.style.overflow = "";
    launcher.focus();
  }

  async function removeTool(toolId) {
    if (!window.confirm(tr("confirmEliminarTool", { id: toolId }))) return;
    try {
      await deleteTool(toolId);
      if (state.selectedId === toolId) state.selectedId = null;
      await refresh();
    } catch (err) {
      state.error = err.message || tr("errEliminarHerramienta");
      render();
    }
  }

  async function changePurchaseStatus(id, status) {
    try {
      await setPurchaseStatus(id, status);
      await refresh();
    } catch (err) {
      state.error = err.message || tr("errCambiarEstado");
      render();
    }
  }

  async function removePurchase(id) {
    const pedido = state.purchases.find((p) => p.id === id);
    if (!window.confirm(tr("confirmBorrarPedido", { name: pedido?.name ?? tr("thArticulo") }))) return;
    try {
      await deletePurchase(id);
      await refresh();
    } catch (err) {
      state.error = err.message || tr("errBorrarPedido");
      render();
    }
  }

  // ---------- Horarios ----------
  // Salida y entrada de una herramienta del pañol. El store valida que no se
  // pueda marcar dos veces la misma dirección.
  async function moveTool(id, kind) {
    try {
      if (kind === "out") await markToolOut(id);
      else await markToolIn(id);
      await refresh();
    } catch (err) {
      state.error = err.message || tr("errMovimiento");
      render();
    }
  }

  async function closeShift(id) {
    try {
      await endShift(id);
      await refresh();
    } catch (err) {
      state.error = err.message || tr("errMarcarSalida");
      render();
    }
  }

  async function removeShift(id) {
    const registro = state.shifts.find((s) => s.id === id);
    if (!window.confirm(tr("confirmBorrarRegistro", { name: registro?.name ?? tr("labelPersona") }))) return;
    try {
      await deleteShift(id);
      await refresh();
    } catch (err) {
      state.error = err.message || tr("errBorrarRegistro");
      render();
    }
  }

  launcher.addEventListener("click", open);
  authDialog.querySelector(".lap-auth__cancel").addEventListener("click", () => authDialog.close());
  authDialog.addEventListener("close", () => {
    authPassword.value = "";
    authError.hidden = true;
    if (root.hidden) launcher.focus();
  });
  authForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (authPassword.value !== ADMIN_PASSWORD) {
      authPassword.value = "";
      authError.hidden = false;
      authPassword.focus();
      return;
    }
    isAuthenticated = true;
    authDialog.close();
    // El token de servidor se pide acá, al entrar al panel, y solo si todavía
    // no quedó guardado en la sesión. El kiosco y el chat no lo piden nunca.
    requestAdminToken();
    open();
  });

  // ---------- Eventos ----------
  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    switch (el.dataset.action) {
      case "nav":
        state.view = el.dataset.view;
        state.selectedId = null;
        render();
        break;
      case "open-tool":
        state.view = "tools";
        state.selectedId = el.dataset.id;
        render();
        drawerEl.querySelector("[data-action=close-drawer]")?.focus();
        break;
      case "delete-tool":
        removeTool(el.dataset.id);
        break;
      case "purchase-status":
        changePurchaseStatus(el.dataset.id, el.dataset.status);
        break;
      case "purchase-delete":
        removePurchase(el.dataset.id);
        break;
      case "tool-out":
        moveTool(el.dataset.id, "out");
        break;
      case "tool-in":
        moveTool(el.dataset.id, "in");
        break;
      case "shift-out":
        closeShift(el.dataset.id);
        break;
      case "shift-delete":
        removeShift(el.dataset.id);
        break;
      case "close-drawer":
        state.selectedId = null;
        render();
        break;
      case "retry":
        refresh();
        break;
      case "download-excel":
        downloadExcel().catch((err) => {
          state.error = err.message || tr("errExcel");
          render();
        });
        break;
      case "close":
        close();
        break;
    }
  });

  // Búsqueda: solo se redibuja la tabla para no perder el foco del input
  root.addEventListener("input", (e) => {
    if (e.target.id !== "lap-search") return;
    state.query = e.target.value;
    root.querySelector("#lap-table").innerHTML = tableHTML();
  });

  root.addEventListener("submit", async (e) => {
    const toolForm = e.target.closest("[data-form=tool]");
    if (toolForm) {
      e.preventDefault();
      const errorEl = toolForm.querySelector(".lap-add__error");
      const submitBtn = toolForm.querySelector("button[type=submit]");
      errorEl.hidden = true;
      submitBtn.disabled = true;

      const formData = new FormData(toolForm);
      try {
        await addTool({
          id: formData.get("id"),
          name: formData.get("name"),
          category: formData.get("category"),
          status: formData.get("status"),
        });
        state.query = "";
        await refresh();
        root.querySelector(".lap-add").open = false;
      } catch (err) {
        errorEl.textContent = err.message || tr("errGuardarHerramienta");
        errorEl.hidden = false;
        submitBtn.disabled = false;
      }
      return;
    }

    const shiftForm = e.target.closest("[data-form=shift]");
    if (shiftForm) {
      e.preventDefault();
      const errorEl = shiftForm.querySelector(".lap-add__error");
      const submitBtn = shiftForm.querySelector("button[type=submit]");
      errorEl.hidden = true;
      submitBtn.disabled = true;

      try {
        await startShift({ name: new FormData(shiftForm).get("name") });
        await refresh();
        // render() reemplaza el form, así que hay que volver a buscarlo en el
        // DOM: el nodo viejo quedó suelto y el foco no llegaría a ningún lado.
        root.querySelector("[data-form=shift] input[name=name]")?.focus();
      } catch (err) {
        errorEl.textContent = err.message || tr("errMarcarEntrada");
        errorEl.hidden = false;
        submitBtn.disabled = false;
        shiftForm.querySelector("input[name=name]")?.focus();
      }
      return;
    }

    const form = e.target.closest("[data-form=repair]");
    if (!form) return;
    e.preventDefault();

    const errorEl = form.querySelector(".lap-form__error");
    const submitBtn = form.querySelector("button[type=submit]");
    errorEl.hidden = true;
    submitBtn.disabled = true;

    const fd = new FormData(form);
    try {
      const before = state.tools.find((t) => t.id === state.selectedId);
      const knownIds = new Set((before?.repairs ?? []).map((r) => r.id));

      const updated = await registerRepair(state.selectedId, {
        date: fd.get("date"),
        reason: fd.get("reason"),
        technician: fd.get("technician"),
        notes: fd.get("notes"),
      });

      state.tools = state.tools.map((t) => (t.id === updated.id ? updated : t));
      state.flashId = (updated.repairs ?? []).find((r) => !knownIds.has(r.id))?.id ?? null;
      render();
    } catch (err) {
      errorEl.textContent = err.message || tr("errGuardarReparacion");
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });

  // Mientras alguien está adentro, la duración tiene que moverse sola. Se
  // actualizan solo esas celdas y no el panel entero, para no sacarle el foco
  // a quien esté tipeando un nombre.
  setInterval(() => {
    if (root.hidden || state.view !== "shifts") return;
    const ahora = Date.now();
    root.querySelectorAll("[data-live-duration]").forEach((cell) => {
      cell.textContent = fmtDuration(ahora - Number(cell.dataset.liveDuration));
    });
  }, 30000);

  // Esc cierra el cajón y después el panel; Tab queda dentro del panel
  document.addEventListener("keydown", (e) => {
    if (root.hidden) return;
    if (e.key === "Escape") {
      if (!drawerEl.hidden) {
        state.selectedId = null;
        render();
      } else {
        close();
      }
      return;
    }
    if (e.key === "Tab") {
      const focusables = [...root.querySelectorAll("button, input, textarea, summary, [href]")].filter(
        (el) => !el.disabled && el.offsetParent !== null
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // Cambio de idioma mientras el panel está montado: se repintan los textos
  // estáticos ([data-i18n*] del chrome y del diálogo de acceso) y, si el panel
  // está abierto, la vista viva vuelve a dibujarse con el nuevo idioma.
  window.addEventListener("lotus:lang", () => {
    if (window.LOTUS_I18N) window.LOTUS_I18N.applyToDom(document);
    if (!root.hidden) render();
  });

  return { open, close, refresh };
}
