// El horario de las herramientas: cuándo salió del pañol y cuándo entró.
// Se prueba en modo local, que es el que usa el panel cuando no hay servidor.

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
globalThis.location = { protocol: 'http:' };
globalThis.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const { listTools, markToolOut, markToolIn, toolMovement, configureStore } = await import('../repairs-store.js');

configureStore({ mode: 'local' });

const find = async (id) => (await listTools()).find((t) => t.id === id);

section('horarios: herramienta que nunca salió');

const sinMov = await find('LOTUS-20463');
check('arranca sin salidas', toolMovement(sinMov).outAt === 0, String(toolMovement(sinMov).outAt));
check('arranca sin entradas', toolMovement(sinMov).inAt === 0);
check('no figura como prestada', toolMovement(sinMov).fuera === false);

await revienta(() => markToolIn('LOTUS-20463'), 'no se puede anotar la entrada si nunca salió');

section('horarios: salida y entrada');

const salida = await markToolOut('LOTUS-20463');
check('la salida guarda la hora', toolMovement(salida).outAt > 0, String(toolMovement(salida).outAt));
check('pasa a estar en uso', salida.status === 'in_use', salida.status);
check('queda marcada como prestada', toolMovement(salida).fuera === true);

await revienta(() => markToolOut('LOTUS-20463'), 'no se puede salir dos veces seguidas');

const entrada = await markToolIn('LOTUS-20463');
check('la entrada guarda la hora', toolMovement(entrada).inAt > 0, String(toolMovement(entrada).inAt));
check('vuelve a disponible', entrada.status === 'available', entrada.status);
check('ya no figura como prestada', toolMovement(entrada).fuera === false);
check('la entrada es posterior a la salida', toolMovement(entrada).inAt >= toolMovement(entrada).outAt);

await revienta(() => markToolIn('LOTUS-20463'), 'no se puede entrar dos veces seguidas');

section('horarios: herramienta prestada');

// Es el estado del primer seed: ya está afuera, así que solo puede volver.
await revienta(() => markToolOut('LOTUS-84920'), 'una herramienta en uso no puede salir otra vez');

const volvio = await markToolIn('LOTUS-84920');
check('una herramienta en uso sí puede volver', volvio.status === 'available', volvio.status);

section('horarios: queda en el inventario');

const final = await find('LOTUS-20463');
check('el movimiento quedó guardado', toolMovement(final).outAt > 0 && toolMovement(final).inAt > 0,
  JSON.stringify(toolMovement(final)));

console.log(fallas ? `\n${fallas} PROBLEMA(S)` : '\nlos horarios de herramientas andan');
process.exit(fallas ? 1 : 0);
