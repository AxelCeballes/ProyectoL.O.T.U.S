// Verifica que toda clase utilitaria usada en index.html exista en el CSS
// compilado (assets/lotus.css). Detecta clases que el CDN de Tailwind generaba
// en runtime y que un build real no está produciendo.
//
// Ojo: la comparación es de strings, no con RegExp. En RegExp `\:` es un escape
// de `:` y el backslash se pierde, pero en el CSS compilado el backslash es un
// carácter literal (Tailwind escapa `:` y `/` en los selectores).
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('assets/lotus.css', 'utf8');
const inlineStyle = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

const used = new Set();
for (const m of html.matchAll(/class="([^"]*)"/g)) {
  for (const token of m[1].split(/\s+/)) {
    if (token && !token.includes('$')) used.add(token);
  }
}
for (const m of html.matchAll(/classList\.(?:add|remove|toggle)\(\s*'([^']+)'/g)) {
  for (const token of m[1].split(/\s+/)) used.add(token);
}
// 3) Clases asignadas con .className = '...'
for (const m of html.matchAll(/\.className\s*=\s*'([^']+)'/g)) {
  for (const token of m[1].split(/\s+/)) used.add(token);
}

const PREFIX =
  /^(?:[a-z-]+:)*(?:bg|text|border|ring|shadow|flex|grid|gap|p[trblxy]?|m[trblxy]?|w|h|min|max|inset|top|left|right|bottom|z|font|leading|tracking|space|divide|rounded|opacity|from|via|to|animate|transition|duration|ease|delay|col|row|place|items|justify|content|self|overflow|cursor|select|object|fill|stroke|backdrop|blur|basis|grow|shrink|translate|rotate|scale|origin|whitespace|break|truncate|align|table|sr|group)-/;

// Escape de selector de clase CSS: backslash literal antes de cada carácter especial.
const cssSelector = (c) => '.' + c.replace(/[:[\]/%.(),#!$+*?^|\\'" ]/g, (ch) => '\\' + ch);

// ¿El selector aparece en `sheet` como clase completa (no prefijo de otra)?
function hasClass(sheet, cls) {
  const needle = cssSelector(cls);
  let from = 0;
  for (;;) {
    const at = sheet.indexOf(needle, from);
    if (at === -1) return false;
    const before = sheet[at - 1];
    const after = sheet[at + needle.length];
    if ((!before || /[\s,{}()]/.test(before)) && (!after || !/[\w-]/.test(after))) return true;
    from = at + needle.length;
  }
}

const candidates = [...used].filter((c) => PREFIX.test(c)).sort();
const missing = candidates.filter((c) => hasClass(css, c) || hasClass(inlineStyle, c) ? false : true);

console.log(`clases candidatas : ${candidates.length}`);
console.log(`presentes         : ${candidates.length - missing.length}`);
console.log(`FALTANTES         : ${missing.length}`);
for (const c of missing) console.log('  FALTA  ' + c);
process.exitCode = missing.length ? 1 : 0;
