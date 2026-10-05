// El sitio se renderizaba con cdn.tailwindcss.com, que es Tailwind v3.4. El build
// local usa v4, y entre ambas versiones cambiaron defaults que se notan sin
// querer: en v4 el color de borde por defecto paso a currentColor, el ancho de
// ring a 1px y `shadow-sm` quedo mas marcado. Este script detecta esas regresiones
// para que el CDN se pueda quitar sin cambiar el aspecto del kiosco.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const css = readFileSync(join(ROOT, 'assets', 'lotus.css'), 'utf8');

const problems = [];

const attrs = [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1]);

// Border sin utility de color: en v3 era slate-200, en v4 es currentColor.
const BORDER_WIDTH = /^(border|border-[trblxy]?)(\s|$)|^border-[trblxy]?-?\d$/;
const BORDER_COLOR = /^border-(\[|[a-z])/;

for (const attr of attrs) {
  const tokens = attr.split(/\s+/).filter(Boolean);
  const hasWidth = tokens.some((t) => BORDER_WIDTH.test(t));
  const hasColor = tokens.some((t) => BORDER_COLOR.test(t));
  // Un ${...} significa que el color puede venir de JS en tiempo de ejecucion.
  const dynamic = tokens.some((t) => t.includes('${'));

  if (hasWidth && !hasColor && !dynamic) {
    problems.push(`border sin color (v4 lo pinta currentColor): ${attr.slice(0, 100)}`);
  }
}

// Ring sin ancho: en v3 el ring por defecto era 3px, en v4 es 1px.
const RING = /(^|\s)ring(\s|$)/;
for (const attr of attrs) {
  if (RING.test(attr) && !/ring-\d/.test(attr)) {
    problems.push(`ring sin ancho (v3=3px, v4=1px): ${attr.slice(0, 100)}`);
  }
}

// Escala de sombras de Tailwind v3.4, la que renderizaba el CDN.
const V3_SHADOWS = {
  'shadow-2xs': '0 1px 0 0 rgb(0 0 0 / 0.05)',
  'shadow-xs': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  'shadow-sm': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  'shadow-md': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  'shadow-lg': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  'shadow-xl': '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  'shadow-2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
};

const normalize = (value) =>
  value
    .replace(/var\(--tw-shadow-color,#0000001a\)/g, 'rgb(0 0 0 / 0.1)')
    .replace(/var\(--tw-shadow-color,#0000000d\)/g, 'rgb(0 0 0 / 0.05)')
    .replace(/var\(--tw-shadow-color,#00000040\)/g, 'rgb(0 0 0 / 0.25)')
    .replace(/,\s*$/, '')
    .trim();

const emitted = new Map();
for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  const match = body.match(/--tw-shadow:\s*([^;]+);/);
  if (match && selector.includes('shadow')) emitted.set(selector.trim(), match[1].trim());
}

for (const [selector, value] of emitted) {
  const utility = selector
    .replace(/^\./, '')
    .replace(/\\:/g, ':')
    .replace(/^hover:/, '')
    .replace(/:hover$/, '');

  const expected = V3_SHADOWS[utility];
  if (expected && normalize(value) !== normalize(expected)) {
    problems.push(`${utility} cambio respecto a v3.4\n    v3.4  : ${expected}\n    build : ${normalize(value)}`);
  }
}

const PINNED_COLORS = {
  'slate-300': '#cbd5e1',
  'slate-400': '#94a3b8',
  'slate-500': '#64748b',
  'slate-600': '#475569',
  'slate-700': '#334155',
  'slate-800': '#1e293b',
  'slate-900': '#0f172a',
  'emerald-100': '#d1fae5',
  'emerald-200': '#a7f3d0',
  'emerald-400': '#34d399',
  'emerald-500': '#10b981',
  'emerald-600': '#059669',
  'emerald-700': '#047857',
  'amber-600': '#d97706',
  'amber-700': '#b45309',
  'red-500': '#ef4444',
  'red-600': '#dc2626',
  'rose-500': '#e11d48',
  'rose-700': '#be123c',
  'blue-600': '#2563eb',
};

// Paleta que el sitio usaba con el CDN (Tailwind v3) y que v4 cambió al migrar
// la paleta a OKLCH. El README declara #10B981 como verde de marca, asi que si una
// actualizacion de Tailwind deja de emitir alguno de estos pines el branding se
// mueve sin que se note en una revision de codigo.
//
// Solo se exigen los pines que el sitio usa: Tailwind v4 descarta del CSS las
// variables de theme que ninguna utilidad consume, asi que un pin correcto pero
// sin uso no aparece y no debe considerarse un problema.
for (const [token, expected] of Object.entries(PINNED_COLORS)) {
  const used = new RegExp(`(?:^|\\s)(?:[a-z]+:)*(?:text|bg|border|ring|fill|stroke|outline|decoration|divide|placeholder|caret|accent|from|via|to)-${token}(?:-\\d+)?(?:/\\d+)?(?:\\s|$)`);
  const appearsInCss = css.includes(`--color-${token}:`);

  if (!used.test(html)) {
    // Sin uso: el pin sigue en src/tailwind.css para cuando se use, pero no hay
    // nada que verifique en el CSS compilado.
    if (appearsInCss) continue;
    continue;
  }

  const declaration = css.match(new RegExp(`--color-${token}:\\s*([^;]+);`));
  if (!declaration) {
    problems.push(`falta el pin --color-${token} (esperado ${expected})`);
    continue;
  }
  const actual = declaration[1].trim().toLowerCase();
  if (actual !== expected) {
    problems.push(`--color-${token} vale ${actual}, se esperaba ${expected}`);
  }
}

// Los stacks de fuente deben seguir como en el tailwind.config original: con
// Inter y Montserrat caidas, "sans-serif" y "ui-sans-serif" caen a fuentes
// distintas y el texto se rasteriza diferente.
for (const [variable, expected] of Object.entries({
  '--font-sans': '"inter", sans-serif',
  '--font-display': '"montserrat", sans-serif',
})) {
  const declaration = css.match(new RegExp(`${variable}:\\s*([^;]+);`, 'i'));
  if (!declaration) problems.push(`falta ${variable}`);
  else if (declaration[1].trim().toLowerCase() !== expected) {
    problems.push(`${variable} es "${declaration[1].trim()}", se esperaba "${expected}"`);
  }
}

// Los tokens de interlineado tienen que seguir siendo longitudes absolutas. v4 los
// compila como calc(<len>/<len>), que CSS resuelve a un numero y se hereda como
// multiplicador: los hijos que solo cambian el tamano de fuente se quedan sin
// interlineado (un hijo de text-3xl pasaba de 36px a 13.2px). Si alguien reinicia
// estos tokens con los defaults de v4, la diferencia reaparece y es invisible en una
// revision de codigo, asi que se comprueba de forma explicita.
for (const [token, expected] of Object.entries({
  'text-xs': '1rem',
  'text-sm': '1.25rem',
  'text-base': '1.5rem',
  'text-lg': '1.75rem',
  'text-xl': '1.75rem',
  'text-2xl': '2rem',
  'text-3xl': '2.25rem',
})) {
  const declaration = css.match(new RegExp(`--${token}--line-height:\\s*([^;]+);`));
  if (!declaration) {
    // Tailwind descarta del CSS las variables de theme que ninguna utilidad usa.
    if (new RegExp(`(?:^|\\s)(?:[a-z]+:)*${token}(?![\w-])`).test(html)) {
      problems.push(`falta --${token}--line-height (el sitio usa ${token})`);
    }
    continue;
  }
  const actual = declaration[1].trim().toLowerCase();
  if (/calc\(|^\d*\.?\d+$/.test(actual)) {
    problems.push(`--${token}--line-height es "${actual}": es proporcional, se pierde el interlineado heredado de v3`);
  } else if (actual !== expected) {
    problems.push(`--${token}--line-height es "${actual}", se esperaba "${expected}"`);
  }
}

if (problems.length === 0) {
  console.log('paridad v3.4 -> v4: OK (bordes, rings, sombras, paleta y fuentes coinciden con el CDN)');
  process.exit(0);
}

console.error(`paridad v3.4 -> v4: ${problems.length} regresion(es)\n`);
for (const p of problems) console.error(`  - ${p}`);
process.exit(1);