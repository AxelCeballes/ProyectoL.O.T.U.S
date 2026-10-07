// Chequeo de cableado del panel admin.
//
// No hay librería de DOM en el proyecto, así que en vez de renderizar el panel
// se verifica lo que de verdad se rompe en silencio:
//
//   1. que cada `import { x } from "./modulo.js"` tenga un `export` de ese nombre
//      (si no, el navegador falla al cargar el módulo y la pantalla queda rota);
//   2. que cada `data-action="x"` de los templates tenga su `case "x":` en el
//      switch de click (si no, el botón se dibuja y no hace nada);
//   3. que cada `data-form="x"` tenga su rama en el submit.
//
// Los errores salen con número de línea para poder ir directo al archivo.
import { readFileSync } from 'node:fs';

const ARCHIVOS = ['admin-panel.js', 'index.html', 'purchases-store.js', 'people-store.js'];
const fuentes = new Map(ARCHIVOS.map((f) => [f, readFileSync(f, 'utf8')]));
const problemas = [];

const lineasDe = (texto, indice) => texto.slice(0, indice).split('\n').length;
const nota = (archivo, texto, indice, mensaje) =>
  problemas.push(`${archivo}:${lineasDe(texto, indice)} -> ${mensaje}`);

// ---------- 1. Imports contra exports ----------
const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*["']\.{1,2}\/([^"']+)["']/g;

for (const [archivo, texto] of fuentes) {
  for (const m of texto.matchAll(IMPORT_RE)) {
    const modulo = m[2];
    // El encabezado de admin-panel.js explica cómo se usa con un ejemplo en un
    // comentario: no hay que tomarlo como un import de verdad.
    const inicioLinea = m.input.lastIndexOf('\n', m.index) + 1;
    if (m.input.slice(inicioLinea, m.index).includes('//')) continue;

    const fuente = fuentes.get(modulo) ?? leerModulo(modulo, archivo, texto, m.index);
    if (!fuente) continue;

    for (const nombre of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      const expresa = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var|class)\\s+${nombre}\\b`);
      const listado = new RegExp(`export\\s*\\{[^}]*\\b${nombre}\\b[^}]*\\}`);
      if (!expresa.test(fuente) && !listado.test(fuente)) {
        nota(archivo, texto, m.index, `${modulo} no exporta "${nombre}"`);
      }
    }
  }
}

function leerModulo(ruta, archivo, texto, indice) {
  try {
    return readFileSync(ruta, 'utf8');
  } catch {
    nota(archivo, texto, indice, `no se pudo leer el módulo ${ruta}`);
    return null;
  }
}

// ---------- 2. data-action contra los case del switch ----------
const panel = fuentes.get('admin-panel.js');

const accionesUsadas = new Map();
for (const m of panel.matchAll(/data-action="([a-z-]+)"/g)) {
  if (!accionesUsadas.has(m[1])) accionesUsadas.set(m[1], m.index);
}

// El switch es el único de archivo y sus cases están todos indentados. Se lee
// el archivo entero porque cortar por el cierre del listener se come los
// últimos cases: adentro hay un .catch((err) => {...}); que cierra antes.
const manejadas = new Set(
  [...panel.matchAll(/^\s*case\s+"([a-z-]+)":/gm)].map((m) => m[1])
);

for (const [accion, indice] of accionesUsadas) {
  if (!manejadas.has(accion)) nota('admin-panel.js', panel, indice, `data-action="${accion}" no tiene case en el switch`);
}

// Un case sin botón que lo dispire también es un problema: código muerto.
const inicioSwitch = panel.indexOf('root.addEventListener("click"');
for (const accion of manejadas) {
  if (!accionesUsadas.has(accion)) {
    nota('admin-panel.js', panel, inicioSwitch, `case "${accion}" no lo usa ningún data-action`);
  }
}

// ---------- 3. data-form contra las ramas del submit ----------
const formularios = new Set([...panel.matchAll(/data-form="([a-z]+)"/g)].map((m) => m[1]));
const ramas = new Set([...panel.matchAll(/closest\("\[data-form=([a-z]+)\]"\)/g)].map((m) => m[1]));

for (const form of formularios) {
  if (!ramas.has(form)) nota('admin-panel.js', panel, panel.indexOf(`data-form="${form}"`), `data-form="${form}" no se maneja en el submit`);
}

// ---------- 4. Puentes que usa el script clásico del chat ----------
const html = fuentes.get('index.html');
for (const puente of ['__LOTUS_INVENTARIO__', '__LOTUS_COMPRAS__']) {
  if (!html.includes(`window.${puente}`)) problemas.push(`index.html -> falta window.${puente}`);
}

if (problemas.length) {
  console.error('Cableado roto:');
  for (const p of problemas) console.error(`  ${p}`);
  console.error(`\n${problemas.length} PROBLEMA(S)`);
  process.exit(1);
}

console.log(`imports/exports, acciones y formularios ok (${accionesUsadas.size} acciones, ${formularios.size} formularios)`);
