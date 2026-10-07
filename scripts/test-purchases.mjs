// El store de compras es el que decide si un pedido se guarda, se fusiona o se
// descarta. Se prueba aparte porque usa localStorage y fetch: en el navegador
// arranca en modo "api" y recien cae a local si el servidor no responde.

let fallas = 0;
const check = (nombre, ok, detalle = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${nombre}${detalle ? ` -> ${detalle}` : ''}`);
  if (!ok) fallas++;
};
const section = (titulo) => console.log(`\n${titulo}`);
const revienta = async (fn, nombre) => {
  try {
    await fn();
    check(nombre, false, 'no lanzó error');
  } catch (e) {
    check(nombre, true, e.message);
  }
};

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k),
};
// El store lee location al importarse, asi que los stubs van primero.
globalThis.location = { protocol: 'http:' };

const {
  listPurchases,
  addPurchase,
  setPurchaseStatus,
  deletePurchase,
  openPurchases,
  configurePurchases,
} = await import('../purchases-store.js');

configurePurchases({ mode: 'local' });

section('compras: validacion');

await revienta(() => addPurchase({ name: '   ' }), 'rechaza un pedido sin nombre');
await revienta(() => addPurchase({ name: 'Discos', quantity: 0 }), 'rechaza cantidad 0');
await revienta(() => addPurchase({ name: 'Discos', quantity: 99999 }), 'rechaza una cantidad absurda');

section('compras: guardado');

const d1 = await addPurchase({ name: 'Disco de corte 4 1/2"', category: 'Consumibles', quantity: 3 });
check('guarda el primer pedido', !!d1.id, d1.id);
check('arranca como pendiente', d1.status === 'pending');

section('compras: no duplica lo mismo');

// El modelo escribe "Disco de corte" una vez y "disco de corte" otra, y a
// veces con tilde. Si eso creara dos pedidos, el pañol compraría el doble.
const d2 = await addPurchase({ name: 'DISCO DE CORTE 4 1/2"', category: 'Consumibles', quantity: 2 });
check('el mismo articulo no crea un pedido nuevo', d2.id === d1.id, `${d2.id} vs ${d1.id}`);
check('suma la cantidad', d2.quantity === 5, String(d2.quantity));

// "disco de corte" y "disco corte" son articulos distintos, no el mismo
// artículo: unirlos de más haría que falte una pieza en el pedido.
const distinto = await addPurchase({ name: 'disco corte 4 1/2"', category: 'Consumibles', quantity: 1 });
check('no une articulos que solo difieren en "de"', distinto.id !== d1.id);
await deletePurchase(distinto.id);

const otro = await addPurchase({ name: 'Guantes de cuero', category: 'Seguridad', quantity: 10 });
check('un articulo distinto si crea pedido', otro.id !== d1.id);

section('compras: listado y estados');

let lista = await listPurchases();
check('lista los dos pedidos', lista.length === 2, String(lista.length));
check('openPurchases trae los dos', openPurchases(lista).length === 2);

await setPurchaseStatus(otro.id, 'received');
lista = await listPurchases();
check('el recibido sale de los abiertos', openPurchases(lista).length === 1);
check('el pendiente sigue abierto', openPurchases(lista)[0].id === d1.id);

await revienta(() => setPurchaseStatus(d1.id, 'inventado'), 'rechaza un estado raro');

section('compras: borrar');

await deletePurchase(d1.id);
lista = await listPurchases();
check('borra el pedido', !lista.some((p) => p.id === d1.id), JSON.stringify(lista.map((p) => p.name)));

await revienta(() => deletePurchase('no-existe'), 'borrar algo inexistente falla');

section('compras: si la API no existe, sigue funcionando');

// Es lo que pasa en el hosting actual, que todavia no expone /api/purchases.
// Si el store tirara el error, el bot no podria anotar pedidos ahi.
storage.clear();
globalThis.fetch = async () => {
  throw new Error('404');
};

configurePurchases({ mode: 'api', apiBase: '/api/purchases' });
const conFallo = await addPurchase({ name: 'Papel de impresora', quantity: 2 });
check('cae a localStorage si la API no responde', conFallo.quantity === 2, conFallo.name);

const persistido = await listPurchases();
check('el pedido quedo guardado igual', persistido.some((p) => p.name === 'Papel de impresora'));

console.log(fallas ? `\n${fallas} PROBLEMA(S)` : '\ntodas las compras andan');
process.exit(fallas ? 1 : 0);