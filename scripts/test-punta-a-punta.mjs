// Prueba de punta a punta contra el servidor local: el token de admin, el
// inventario y el chat con Gemini real. Es el recorrido que hace el navegador.
import { readFileSync } from 'node:fs';

const token = readFileSync('.env.local', 'utf8').match(/^ADMIN_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) throw new Error('no hay ADMIN_TOKEN en .env.local');

const BASE = 'http://127.0.0.1:3000';
const h = { 'Content-Type': 'application/json', 'x-admin-token': token };
let fallas = 0;
const check = (nombre, ok, detalle = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${nombre}${detalle ? ` -> ${detalle}` : ''}`);
  if (!ok) fallas++;
};

// 1. Inventario: leer es público (lo hace el kiosco y el chat sin prompt).
// Escribir es de admin. Antes el GET también pedía token y el chat pedía el
// token para arrancar.
const sinToken = await fetch(`${BASE}/api/tools`);
check('sin token el inventario responde 200', sinToken.status === 200, String(sinToken.status));

// Leer es público, pero dar de alta una herramienta es una escritura de admin.
const escribirHerramienta = await fetch(`${BASE}/api/tools`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: 'LOTUS-SIN-TOKEN', name: 'Prueba sin autorización', status: 'available' }),
});
check('alta de herramienta sin token responde 401', escribirHerramienta.status === 401, String(escribirHerramienta.status));

// 2. Con token, el inventario responde.
const inv = await fetch(`${BASE}/api/tools`, { headers: h });
const herramientas = await inv.json();
check('con token el inventario responde 200', inv.status === 200, String(inv.status));
check('el inventario trae herramientas', Array.isArray(herramientas) && herramientas.length > 0, `${herramientas?.length} herramientas`);

// 3. Alta por API y confirmacion de que quedo guardada.
const alta = await fetch(`${BASE}/api/tools`, {
  method: 'POST',
  headers: h,
  body: JSON.stringify({ id: 'LOTUS-PRUEBA', name: 'Disco de Corte 7"', category: 'Consumibles', status: 'available' }),
});
const altaBody = await alta.json();
check('alta por API aceptada', alta.status < 300, `${alta.status}`);

const despues = await (await fetch(`${BASE}/api/tools`, { headers: h })).json();
check('el alta quedo guardada en el servidor', despues.some((t) => t.id === 'LOTUS-PRUEBA'));

// 4. El chat recibe ese inventario y no inventa nada en un saludo.
const INVENTARIO = despues.map((t) => ({ name: t.name, category: t.category, status: t.status }));

for (const message of ['hola', 'cuantas herramientas hay?', 'hay discos de corte?']) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context: { screen: 4 }, inventario: INVENTARIO }),
  });
  const d = await r.json();
  check(`"${message}" responde 200`, r.status === 200, String(r.status));
  check(`"${message}" no inventa altas`, (d.agregar?.length ?? 0) === 0, JSON.stringify(d.agregar?.map((t) => t.name) ?? null));
  check(`"${message}" no dice Bienvenido ni kiosco`, !/\b(bienvenid[oa]|kiosco)\b/i.test(d.reply ?? ''));
}

// 5. Un alta pedida explicitamente si tiene que llegar.
const r = await fetch(`${BASE}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'agrega una pinza pelacables en categoria Manuales',
    context: { screen: 4 },
    inventario: INVENTARIO,
  }),
});
const d = await r.json();
check('un alta explicita llega', (d.agregar?.length ?? 0) >= 1, JSON.stringify(d.agregar?.map((t) => t.name)));

// 6. Pedidos de compra: "nos faltan discos de corte" genera un pedido, no un
// alta. Un disco que se acaba es un consumible a reponer, no una herramienta
// nueva en el taller.
console.log('\ncompras:');

const pedidos = [];
for (const message of ['nos faltan discos de corte', 'hay que comprar 5 guantes de cuero']) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context: { screen: 4 }, inventario: INVENTARIO }),
  });
  const d = await r.json();
  console.log(`  "${message}" -> ${d.reply}`);
  check(`"${message}" no crea altas de inventario`, (d.agregar?.length ?? 0) === 0, JSON.stringify(d.agregar?.map((t) => t.name) ?? null));
  for (const c of d.comprar ?? []) pedidos.push(c);
}

check('el bot pidio discos de corte', pedidos.some((p) => /disco/i.test(p.name)), JSON.stringify(pedidos.map((p) => p.name)));
check('el bot pidio guantes', pedidos.some((p) => /guante/i.test(p.name)));
check('cada pedido trae nombre y cantidad', pedidos.every((p) => p.name && p.quantity >= 1));
check('la cantidad que se pidio se respeta', pedidos.some((p) => /guante/i.test(p.name) && p.quantity === 5), JSON.stringify(pedidos.find((p) => /guante/i.test(p.name))?.quantity));

// 7. La API de pedidos: leer es público; anotar/cambiar escribe y exige token.
// Escribir sin token da 401 (no regala el dato), con token guarda y fusiona.
console.log('\ncompras por API:');

const comprasSinToken = await fetch(`${BASE}/api/purchases`);
check('sin token los pedidos responden 200', comprasSinToken.status === 200, String(comprasSinToken.status));

const escribirSinToken = await fetch(`${BASE}/api/purchases`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Cosa sin autorización', quantity: 1 }),
});
check('anotar un pedido sin token responde 401', escribirSinToken.status === 401, String(escribirSinToken.status));

const altaCompra = await fetch(`${BASE}/api/purchases`, {
  method: 'POST',
  headers: h,
  body: JSON.stringify({ name: 'Disco de corte 4 1/2"', category: 'Consumibles', quantity: 3 }),
});
const compraBody = await altaCompra.json();
check('alta de compra aceptada', altaCompra.status < 300, String(altaCompra.status));
check('el pedido tiene id', !!compraBody.id, compraBody.id);

const repetida = await (await fetch(`${BASE}/api/purchases`, {
  method: 'POST',
  headers: h,
  body: JSON.stringify({ name: 'DISCO DE CORTE 4 1/2"', category: 'Consumibles', quantity: 2 }),
})).json();
check('el mismo articulo no se duplica', repetida.id === compraBody.id, `${repetida.id} vs ${compraBody.id}`);
check('suma la cantidad', repetida.quantity === 5, String(repetida.quantity));

const mala = await fetch(`${BASE}/api/purchases`, {
  method: 'POST',
  headers: h,
  body: JSON.stringify({ name: 'Discos', quantity: 0 }),
});
check('una cantidad invalida responde 400', mala.status === 400, String(mala.status));

const listados = await (await fetch(`${BASE}/api/purchases`, { headers: h })).json();
check('el pedido quedo en el servidor', listados.some((p) => p.id === compraBody.id));

const pedidoId = compraBody.id;
const recibido = await fetch(`${BASE}/api/purchases/${encodeURIComponent(pedidoId)}`, {
  method: 'PATCH',
  headers: h,
  body: JSON.stringify({ status: 'received' }),
});
check('cambiar el estado a recibido', recibido.status < 300, String(recibido.status));

const borrado = await fetch(`${BASE}/api/purchases/${encodeURIComponent(pedidoId)}`, { method: 'DELETE', headers: h });
check('borrar el pedido de prueba', borrado.status < 300, String(borrado.status));

// 9. Personal por API: el fichaje es del kiosco (NFC), así que la entrada y la
// salida no piden token — el escaneo no puede abrir un prompt. Borrar un
// registro (limpieza del panel) sí exige token.
console.log('\npersonal por API:');

const personalSinToken = await fetch(`${BASE}/api/shifts`);
check('sin token las entradas responden 200', personalSinToken.status === 200, String(personalSinToken.status));

const entrada = await (await fetch(`${BASE}/api/shifts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Ana Gómez' }),
})).json();
check('la entrada se registró sin token (kiosco)', !!entrada.id && entrada.exitAt === null, entrada.id);

const entradaRepetida = await fetch(`${BASE}/api/shifts`, {
  method: 'POST',
  headers: h,
  body: JSON.stringify({ name: 'ANA GÓMEZ' }),
});
check('el mismo nombre no abre otra jornada', entradaRepetida.status === 409, String(entradaRepetida.status));

const sinNombre = await fetch(`${BASE}/api/shifts`, { method: 'POST', headers: h, body: JSON.stringify({ name: '  ' }) });
check('una entrada sin nombre responde 400', sinNombre.status === 400, String(sinNombre.status));

const salida = await (await fetch(`${BASE}/api/shifts/${encodeURIComponent(entrada.id)}`, {
  method: 'PATCH',
  headers: h,
  body: JSON.stringify({ kind: 'out' }),
})).json();
check('la salida se registró', salida.exitAt !== null && salida.exitAt >= salida.entryAt, String(salida.exitAt));

const salidaRep = await fetch(`${BASE}/api/shifts/${encodeURIComponent(entrada.id)}`, {
  method: 'PATCH',
  headers: h,
  body: JSON.stringify({ kind: 'out' }),
});
check('no se puede salir dos veces', salidaRep.status === 409, String(salidaRep.status));

const listadoPersonal = await (await fetch(`${BASE}/api/shifts`, { headers: h })).json();
check('el registro quedó en el servidor', listadoPersonal.some((s) => s.id === entrada.id));

// 10. Horario de herramientas: última salida y última entrada.
console.log('\nhorario de herramientas:');

const movOut = await (await fetch(`${BASE}/api/tools/${encodeURIComponent('LOTUS-PRUEBA')}/movement`, {
  method: 'PATCH',
  headers: h,
  body: JSON.stringify({ kind: 'out' }),
})).json();
check('la salida queda registrada', movOut.lastOutAt > 0, String(movOut.lastOutAt));
check('la herramienta pasa a en uso', movOut.status === 'in_use', movOut.status);

const movOut2 = await fetch(`${BASE}/api/tools/${encodeURIComponent('LOTUS-PRUEBA')}/movement`, {
  method: 'PATCH',
  headers: h,
  body: JSON.stringify({ kind: 'out' }),
});
check('no se puede salir dos veces', movOut2.status === 409, String(movOut2.status));

const movIn = await (await fetch(`${BASE}/api/tools/${encodeURIComponent('LOTUS-PRUEBA')}/movement`, {
  method: 'PATCH',
  headers: h,
  body: JSON.stringify({ kind: 'in' }),
})).json();
check('la entrada queda registrada', movIn.lastInAt > 0, String(movIn.lastInAt));
check('vuelve a estar disponible', movIn.status === 'available', movIn.status);

const movIn2 = await fetch(`${BASE}/api/tools/${encodeURIComponent('LOTUS-PRUEBA')}/movement`, {
  method: 'PATCH',
  headers: h,
  body: JSON.stringify({ kind: 'in' }),
});
check('no se puede entrar dos veces', movIn2.status === 409, String(movIn2.status));

const movInvalido = await fetch(`${BASE}/api/tools/${encodeURIComponent('LOTUS-PRUEBA')}/movement`, {
  method: 'PATCH',
  headers: h,
  body: JSON.stringify({ kind: 'volando' }),
});
check('un movimiento desconocido responde 400', movInvalido.status === 400, String(movInvalido.status));

// 11. Limpieza: borrar lo que se creo en la prueba.
const borrar = await fetch(`${BASE}/api/tools/${encodeURIComponent('LOTUS-PRUEBA')}`, { method: 'DELETE', headers: h });
check('el alta de prueba se borro', borrar.status < 300, String(borrar.status));
const borrarEntrada = await fetch(`${BASE}/api/shifts/${encodeURIComponent(entrada.id)}`, { method: 'DELETE', headers: h });
check('la entrada de prueba se borro', borrarEntrada.status < 300, String(borrarEntrada.status));

console.log(fallas ? `\n${fallas} PROBLEMA(S)` : '\ntodo anda');
process.exit(fallas ? 1 : 0);