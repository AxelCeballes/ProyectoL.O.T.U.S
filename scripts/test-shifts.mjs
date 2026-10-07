// El fichaje de personal: quién entró, quién salió y cuánto duró. Se prueba
// aparte porque usa localStorage y fetch, igual que el de compras.

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
// El store lee location al importarse, así que los stubs van antes.
globalThis.location = { protocol: 'http:' };

const {
  listShifts,
  startShift,
  endShift,
  deleteShift,
  insideNow,
  knownPeople,
  shiftDuration,
  configureShifts,
} = await import('../people-store.js');

configureShifts({ mode: 'local' });

section('personal: validación');

await revienta(() => startShift({ name: '   ' }), 'rechaza una entrada sin nombre');

section('personal: entrada');

const e1 = await startShift({ name: 'Juan Pérez' });
check('la entrada queda abierta', e1.exitAt === null, String(e1.id));
check('tiene hora de entrada', e1.entryAt > 0, String(e1.entryAt));

const adentro = insideNow(await listShifts());
check('figura como adentro', adentro.length === 1 && adentro[0].name === 'Juan Pérez');

section('personal: no duplica jornadas');

// Dos mayúsculas o una tilde de más no pueden abrir una segunda entrada.
await revienta(() => startShift({ name: 'JUAN PEREZ' }), 'el mismo nombre en mayúsculas no entra de nuevo');
await revienta(() => startShift({ name: 'juan perez' }), 'el mismo nombre en minúsculas no entra de nuevo');

const otro = await startShift({ name: 'Ana Gómez' });
check('otra persona sí entra', otro.name === 'Ana Gómez', otro.name);

section('personal: salida');

const durAntes = shiftDuration(e1);
check('la duración corre mientras está adentro', durAntes >= 0, String(durAntes));

const cerrado = await endShift(e1.id);
check('la salida guarda la hora', cerrado.exitAt !== null, String(cerrado.exitAt));
check('la salida es posterior a la de entrada', cerrado.exitAt >= cerrado.entryAt);

const durado = shiftDuration(cerrado);
check('la duración queda fijada', durado >= 0 && durado < 60000, `${durado} ms`);

await revienta(() => endShift(e1.id), 'no se puede salir dos veces');

const fuera = insideNow(await listShifts());
check('ya no figura adentro', !fuera.some((s) => s.id === e1.id), JSON.stringify(fuera.map((s) => s.name)));
check('la otra persona sigue adentro', fuera.some((s) => s.id === otro.id), JSON.stringify(fuera.map((s) => s.name)));

section('personal: volver a entrar');

// Después de salir, la misma persona puede abrir otra jornada.
const e2 = await startShift({ name: 'Juan Pérez' });
check('permite una jornada nueva', e2.id !== e1.id, `${e2.id} vs ${e1.id}`);

// e1 es una copia vieja que quedó en memoria; el registro guardado es el que
// manda, así que se vuelve a leer del store.
const persistidos = await listShifts();
check('la anterior sigue cerrada', persistidos.find((s) => s.id === e1.id)?.exitAt !== null);

section('personal: nombres conocidos');

const nombres = knownPeople(await listShifts());
check('lista las personas sin repetir', nombres.length === 2, JSON.stringify(nombres));
check('están ordenadas', nombres[0] === 'Ana Gómez', JSON.stringify(nombres));

section('personal: borrar');

await deleteShift(e1.id);
const quedan = await listShifts();
check('borra el registro', !quedan.some((s) => s.id === e1.id), `${quedan.length} registros`);
await revienta(() => deleteShift('no-existe'), 'borrar algo inexistente falla');

section('personal: si la API no existe, sigue funcionando');

storage.clear();
globalThis.fetch = async () => {
  throw new Error('404');
};
configureShifts({ mode: 'api', apiBase: '/api/shifts' });

const conFallo = await startShift({ name: 'María Lara' });
check('cae a localStorage si la API no responde', conFallo.name === 'María Lara', conFallo.name);
const guardado = await listShifts();
check('la entrada quedó guardada igual', guardado.some((s) => s.name === 'María Lara'));

console.log(fallas ? `\n${fallas} PROBLEMA(S)` : '\nlas entradas y salidas andan');
process.exit(fallas ? 1 : 0);
