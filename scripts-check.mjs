import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('assets/lotus.css', 'utf8');

// Classes utilitarias candidatas: cualquier token que empiece por un prefijo
// conocido de Tailwind. Ignoramos clases del CDN, claves de afaik y estados.
const PREFIX = /^(?:[a-z-]+:)*(?:bg|text|border|ring|shadow|flex|grid|gap|p[trblxy]?|m[trblxy]?|w|h|min|max|inset|top|left|right|bottom|z|font|leading|tracking|space|divide|rounded|opacity|from|via|to|animate|transition|duration|ease|delay|order|col|row|place|items|justify|content|self|overflow|cursor|select|list|object|fill|stroke|backdrop|blur|basis|grow|shrink|translate|rotate|scale|skew|origin|whitespace|break|truncate|align|table|caption|sr|peer|group|container|prose|mx|my|mt|mb|ml|mr)-/;

const seen = new Set();
for (const m of html.matchAll(/class="([^"]*)"/g)) {
  for (let token of m[1].split(/\s+/)) {
    // quita Template literals y expresiones sueltas
    token = token.replace(/\$\{[^}]*\}/g, '').replace(/^['"`]/, '');
    if (!token || token.startsWith('$')) continue;
    seen.add(token);
  }
}
// clases con sintaxis tipo bg-slate-50\/80 o duration-[3000ms]
for (const m of html.matchAll(/['"`]([a-z-]+:[a-z0-9[\]\/.\-]+)['"`]/g)) seen.add(m[1]);

const candidates = [...seen].filter((c) => PREFIX.test(c));
const missing = candidates.filter((c) => {
  const sel = '.' + c.replace(/([:/[\]%(),.])/g, '\\$1');
  return !new RegExp('(^|[,{}])' + sel + '\\s*[,{]').test(css);
});

console.log(`clases candidatas: ${candidates.length}`);
console.log(`faltantes: ${missing.length}`);
for (const c of missing) console.log('  MISSING ' + c);
