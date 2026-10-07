# Terminal de herramientas L.O.T.U.S.

Guía rápida para el equipo de Falmet y pañol industrial.

## Demo en línea

[Abrir L.O.T.U.S. en Vercel](https://lotus-web-flame.vercel.app/)

## ¿Para qué sirve?

Es una demostración de una pantalla para retirar y devolver herramientas del pañol de **L.O.T.U.S. SOLUTIONS** (*Logic Optimization & Technology Unified Solutions*). Permite recorrer el flujo y consultar una lista de herramientas de ejemplo.

La pantalla de retiro y devolución todavía muestra datos de ejemplo. El Panel Admin usa el inventario persistente cuando la web se sirve desde Node; el asistente de ayuda envía consultas al proveedor configurado.

---

## 🎨 Identidad Visual y Diseño
- **Colores**: Azul Marino Profundo (`#1A2B42`), Gris Ultra Claro (`#F8F9FA`) y acentos en Verde Esmeralda (`#10B981`).
- **Modo Claro / Modo Oscuro**: Alternable con el botón del encabezado y guardado en `localStorage`.
- **Efectos de Sonido**: 7 efectos sintetizados en tiempo real mediante **Web Audio API** (NFC, pistola láser, acorde de éxito, clic táctil, switch mecánico y alarma de error), con panel interactivo de pruebas en el encabezado.

---

## 🚀 Flujo de Pantallas

1. **Pantalla 1: Standby (Esperando NFC)**: Apoyo de tarjeta NFC con pulsos concéntricos, onda sonar verde y respuesta táctil.
2. **Pantalla 2: Dashboard del Operario**: Ficha de usuario habilitada, acciones principales (*Retiro de herramienta* y *Devolución*) con efecto shimmer reflectante y botón para ver estado de herramientas.
3. **Pantalla 3: Escaneo de Código de Barras**: Visor de mira óptica HUD con línea láser, flash verde de lectura y alerta de éxito con checkmark animado retornando en 3 segundos.
4. **Pantalla 4: Estado de herramientas (Inventario)**: Consulta rápida de disponibilidad, ubicación y buscador con contadores progresivos.

---

## 🖥️ Cómo probarla

1. Abra `index.html` en cualquier navegador web moderno (Chrome, Edge, Firefox, Safari).
2. Presione `Enter` o el botón de simulación para avanzar desde la pantalla de ingreso.
3. Elija retiro o devolución y presione `Enter` para disparar la lectura del código.
4. Use «Estado de herramientas» para consultar el inventario de ejemplo y filtrar por estado o nombre.
5. Use el botón «Sonidos» del encabezado para probar individualmente los sintetizadores de audio.

## Inventario compartido y Excel

El servidor Node incluido conserva el inventario en `data/tools.json` y regenera el Excel después de cada cambio. La carpeta `data/` queda fuera de Git para no subir datos de la empresa al repositorio.

1. En `.env.local`, agregá `ADMIN_TOKEN=` seguido de una clave larga y privada. No uses la contraseña visual `falmet` como token.
2. Iniciá la aplicación con `npm start`.
3. Abrí `http://localhost:3000`, entrá al Panel Admin con la clave visual `falmet` y, cuando lo pida, ingresá el `ADMIN_TOKEN`.
4. Agregá herramientas, reparaciones, pedidos de compra y entradas/salidas de personal. Se guardan en el servidor y el Excel se regenera en el momento. Usá **Descargar Excel** para compartirlo.

Para que todo Falmet use el mismo registro, alojá esta aplicación Node en un servidor de la empresa con disco persistente y respaldá la carpeta `data/`. En ese servidor configurá `HOST=0.0.0.0` y protegé el acceso con HTTPS en la red de la empresa. La publicación estática actual de Vercel no puede conservar archivos escritos por la aplicación: al desplegar allí, hace falta conectar una base de datos externa persistente y adaptar el backend. No cargues datos reales en esa publicación estática.

La contraseña visual `falmet` está en el código público y no protege por sí sola los datos del servidor.

## Panel de administración y reparaciones

El botón «Panel Admin» solicita la contraseña visual `falmet` y luego el token del servidor. La contraseña visual está en el código público y no protege por sí sola los datos. Si se abre `index.html` directamente, el panel queda en modo de demostración local.

El panel incluye pestañas para herramientas, reparaciones, compras y personal, con el horario (última salida y entrada) de cada herramienta. Las compras se anotan desde el chat pidiendo reponer algo (por ejemplo: «nos faltan discos de corte»).

`repairs-router.js` es una implementación anterior para Express. El servidor incluido en `scripts/dev-server.mjs` es el que usa esta versión.

## PARTICIPANTES

-AXEL CEBALLES
-FEDERICO LERA
-BERENICE
-AGUSTIN