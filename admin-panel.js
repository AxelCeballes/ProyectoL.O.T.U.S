// admin/admin-panel.js
// Panel Admin de L.O.T.U.S (JavaScript puro, sin dependencias).
// Uso:  import { mountAdminPanel } from "./admin/admin-panel.js";  mountAdminPanel();

import {
  configureStore,
  listTools,
  addTool,
  deleteTool,
  registerRepair,
  repairCount,
  sortedRepairs,
  lastRepairDate,
  allRepairs,
} from "./repairs-store.js";

const STATUS = {
  available: { label: "Disponible", cls: "ok" },
  in_use: { label: "En uso", cls: "use" },
  maintenance: { label: "En mantenimiento", cls: "warn" },
};

const ADMIN_PASSWORD = "falmet";

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// "2026-10-04" -> "04 oct 2026" (sin pasar por UTC, para que no se corra un día)
function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const badge = (status) => {
  const s = STATUS[status] ?? { label: status, cls: "use" };
  return `<span class="lap-badge lap-badge--${s.cls}">${esc(s.label)}</span>`;
};

export function mountAdminPanel({ store } = {}) {
  if (store) configureStore(store);

  const state = {
    view: "tools",
    tools: [],
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
      <h2 id="lap-auth-title">Acceso de administrador</h2>
      <p>Ingresá la contraseña para abrir el panel.</p>
      <label for="lap-auth-password">Contraseña</label>
      <input id="lap-auth-password" name="password" type="password" autocomplete="current-password" required>
      <p class="lap-auth__error" role="alert" hidden>La contraseña es incorrecta.</p>
      <div class="lap-auth__actions">
        <button type="button" class="lap-auth__cancel">Cancelar</button>
        <button type="submit" class="lap-auth__submit">Ingresar</button>
      </div>
    </form>`;

  const root = document.createElement("div");
  root.className = "lap";
  root.hidden = true;
  root.innerHTML = `
    <div class="lap__shell" role="dialog" aria-modal="true" aria-labelledby="lap-title">
      <nav class="lap__sidebar" aria-label="Administración">
        <div class="lap__brand">L.O.T.U.S<span>Panel Admin</span></div>
        <button type="button" class="lap__nav" data-action="nav" data-view="tools">Herramientas</button>
        <button type="button" class="lap__nav" data-action="nav" data-view="history">Reparaciones</button>
        <button type="button" class="lap__nav lap__nav--exit" data-action="close">Volver al terminal</button>
      </nav>
      <main class="lap__main">
        <header class="lap__head">
          <h2 id="lap-title" class="lap__title"></h2>
          <button type="button" class="lap__x" data-action="close" aria-label="Cerrar panel">✕</button>
        </header>
        <div class="lap__content"></div>
      </main>
      <aside class="lap__drawer" hidden aria-label="Historial de reparaciones"></aside>
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
      return `<p class="lap__state">Todavía no hay herramientas cargadas.</p>`;
    }
    const q = state.query.trim().toLowerCase();
    const rows = state.tools.filter((t) =>
      !q || [t.id, t.name, t.category].some((v) => String(v ?? "").toLowerCase().includes(q))
    );
    if (!rows.length) return `<p class="lap__state">Ninguna herramienta coincide con la búsqueda.</p>`;

    return `
      <table class="lap-table">
        <thead>
          <tr><th>ID</th><th>Herramienta</th><th>Categoría</th><th>Estado</th><th>Reparaciones</th><th>Última</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          ${rows
            .map((t) => {
              const n = repairCount(t);
              return `
              <tr data-action="open-tool" data-id="${esc(t.id)}" class="${t.id === state.selectedId ? "is-selected" : ""}">
                <td class="lap-mono">${esc(t.id)}</td>
                <td>${esc(t.name)}</td>
                <td>${esc(t.category)}</td>
                <td>${badge(t.status)}</td>
                <td>
                  <button type="button" class="lap-count${n === 0 ? " lap-count--zero" : ""}" data-action="open-tool" data-id="${esc(t.id)}"
                    aria-label="Ver historial de ${esc(t.name)}: ${n} reparaciones">${n}</button>
                </td>
                <td>${fmtDate(lastRepairDate(t))}</td>
                <td>
                  <button type="button" class="lap-delete-btn" data-action="delete-tool" data-id="${esc(t.id)}"
                    aria-label="Eliminar ${esc(t.name)}">Eliminar</button>
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
        <input type="search" id="lap-search" class="lap__search" placeholder="Buscar por nombre, ID o categoría"
          value="${esc(state.query)}" aria-label="Buscar herramienta" />
        <span class="lap__meta">${state.tools.length} herramientas · ${total} reparaciones</span>
      </div>
      <details class="lap-add">
        <summary>Agregar herramienta</summary>
        <form data-form="tool" novalidate>
          <label>ID
            <input type="text" name="id" maxlength="64" required placeholder="Ej: LOTUS-12345" />
          </label>
          <label>Nombre
            <input type="text" name="name" maxlength="120" required placeholder="Nombre de la herramienta" />
          </label>
          <label>Categoría
            <input type="text" name="category" maxlength="80" placeholder="Ej: Eléctricas" />
          </label>
          <label>Estado inicial
            <select name="status">
              <option value="available">Disponible</option>
              <option value="in_use">En uso</option>
              <option value="maintenance">En mantenimiento</option>
            </select>
          </label>
          <p class="lap-add__error" role="alert" hidden></p>
          <button type="submit" class="lap-btn">Guardar herramienta</button>
        </form>
      </details>
      <div class="lap__tablewrap" id="lap-table">${tableHTML()}</div>`;
  }

  function historyView() {
    const repairs = allRepairs(state.tools);
    if (!repairs.length) return `<p class="lap__state">Todavía no se registró ninguna reparación.</p>`;
    return `
      <div class="lap__tablewrap">
        <table class="lap-table">
          <thead><tr><th>Fecha</th><th>Herramienta</th><th>Motivo</th><th>Técnico</th></tr></thead>
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
        <button type="button" class="lap__x" data-action="close-drawer" aria-label="Cerrar historial">✕</button>
      </header>

      <div class="lap-drawer__stats">
        <div><strong class="lap-bignum">${repairs.length}</strong><span>reparaciones</span></div>
        <div><strong>${fmtDate(lastRepairDate(tool))}</strong><span>última reparación</span></div>
      </div>

      <h4 class="lap-drawer__sub">Historial</h4>
      ${
        repairs.length
          ? `<ol class="lap-timeline">
              ${repairs
                .map(
                  (r) => `
                <li class="${r.id === flashId ? "is-new" : ""}">
                  <time>${fmtDate(r.date)}</time>
                  <p class="lap-reason">${esc(r.reason)}</p>
                  ${r.technician ? `<p class="lap-dim">Técnico: ${esc(r.technician)}</p>` : ""}
                  ${r.notes ? `<p class="lap-notes">${esc(r.notes)}</p>` : ""}
                </li>`
                )
                .join("")}
            </ol>`
          : `<p class="lap__state">Esta herramienta no tiene reparaciones registradas.</p>`
      }

      <details class="lap-form">
        <summary>Registrar reparación</summary>
        <form data-form="repair" novalidate>
          <label>Fecha
            <input type="date" name="date" value="${todayISO()}" max="${todayISO()}" required />
          </label>
          <label>Motivo
            <input type="text" name="reason" maxlength="300" required placeholder="Ej: Reemplazo de carbones" />
          </label>
          <label>Técnico
            <input type="text" name="technician" maxlength="80" placeholder="Opcional" />
          </label>
          <label>Notas
            <textarea name="notes" rows="3" maxlength="500" placeholder="Opcional"></textarea>
          </label>
          <p class="lap-form__error" role="alert" hidden></p>
          <button type="submit" class="lap-btn">Guardar reparación</button>
        </form>
      </details>`;
  }

  // ---------- Render ----------
  function render() {
    titleEl.textContent = state.view === "tools" ? "Inventario de herramientas" : "Historial de reparaciones";
    root.querySelectorAll("[data-view]").forEach((b) => {
      const active = b.dataset.view === state.view;
      b.classList.toggle("is-active", active);
      b.toggleAttribute("aria-current", active);
    });

    if (state.error) {
      contentEl.innerHTML = `<p class="lap__state lap__state--error" role="alert">${esc(state.error)}</p>
        <button type="button" class="lap-btn" data-action="retry">Reintentar</button>`;
    } else if (state.loading && !state.tools.length) {
      contentEl.innerHTML = `<p class="lap__state">Cargando…</p>`;
    } else {
      contentEl.innerHTML = state.view === "tools" ? toolsView() : historyView();
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
    try {
      state.tools = await listTools();
    } catch (err) {
      state.error = err.message || "No se pudo cargar el inventario.";
    } finally {
      state.loading = false;
      render();
    }
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
    if (!window.confirm(`¿Eliminar la herramienta ${toolId} y todo su historial de reparaciones?`)) return;
    try {
      await deleteTool(toolId);
      if (state.selectedId === toolId) state.selectedId = null;
      await refresh();
    } catch (err) {
      state.error = err.message || "No se pudo eliminar la herramienta.";
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
      case "close-drawer":
        state.selectedId = null;
        render();
        break;
      case "retry":
        refresh();
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
        errorEl.textContent = err.message || "No se pudo guardar la herramienta.";
        errorEl.hidden = false;
        submitBtn.disabled = false;
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
      errorEl.textContent = err.message || "No se pudo guardar la reparación.";
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });

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

  return { open, close, refresh };
}
