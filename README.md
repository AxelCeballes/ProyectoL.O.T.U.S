# Terminal de herramientas L.O.T.U.S.

Guía rápida para el equipo de Falmet y pañol industrial.

## Demo en línea

[Abrir L.O.T.U.S. en Vercel](https://lotusweb-flame.vercel.app/)

## ¿Para qué sirve?

Es una web para consultar y administrar herramientas del pañol de **Falmet**. El inventario compartido se guarda en el servidor y el Excel se actualiza automáticamente cada vez que se agrega, elimina o modifica una herramienta o reparación.

El libro se guarda en `data/falmet-inventario.xlsx` e incluye las hojas **Inventario** y **Reparaciones**. El panel permite descargar la copia más reciente.

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

1. Abra `index.html` para recorrer la demo visual, o `http://localhost:3000` para usar el inventario compartido.
2. Presione `Enter` o el botón de simulación para avanzar desde la pantalla de ingreso.
3. Elija retiro o devolución y presione `Enter` para disparar la lectura del código.
4. Use «Estado de herramientas» para consultar el inventario de ejemplo y filtrar por estado o nombre.
5. Use el botón «Sonidos» del encabezado para probar individualmente los sintetizadores de audio.

## Inventario compartido y Excel

El servidor Node incluido conserva el inventario en `data/tools.json` y regenera el Excel después de cada cambio. La carpeta `data/` queda fuera de Git para no subir datos de la empresa al repositorio.

1. En `.env.local`, agregá `ADMIN_TOKEN=` seguido de una clave larga y privada. No uses la contraseña visual `falmet` como token.
2. Iniciá la aplicación con `npm start`.
3. Abrí `http://localhost:3000`, entrá al Panel Admin con la clave visual `falmet` y, cuando lo pida, ingresá el `ADMIN_TOKEN`.
4. Agregá herramientas o reparaciones. Se guardan en el servidor y el Excel se regenera en el momento. Usá **Descargar Excel** para compartirlo.

Para que todo Falmet use el mismo registro, alojá esta aplicación Node en un servidor de la empresa con disco persistente y respaldá la carpeta `data/`. En ese servidor configurá `HOST=0.0.0.0` y protegé el acceso con HTTPS en la red de la empresa. La publicación estática actual de Vercel no puede conservar archivos escritos por la aplicación: al desplegar allí, hace falta conectar una base de datos externa persistente y adaptar el backend. No cargues datos reales en esa publicación estática.

La contraseña visual `falmet` está en el código público y no protege por sí sola los datos del servidor.

## Panel de administración y reparaciones

El botón «Panel Admin» solicita la contraseña visual `falmet` y luego el token del servidor. La contraseña visual está en el código público y no protege por sí sola los datos. Si se abre `index.html` directamente, el panel queda en modo de demostración local.

`repairs-router.js` es una implementación anterior para Express. El servidor incluido en `scripts/dev-server.mjs` es el que usa esta versión.

## Desarrollo

El CSS ya no se carga desde `cdn.tailwindcss.com`: Tailwind se compila a `assets/lotus.css` y se versiona en el repositorio. Para trabajar sobre el diseño:

```bash
npm install
npm run build   # recompila assets/lotus.css
npm run dev     # recompila al guardar
npm run start   # servidor local en http://127.0.0.1:3000 (sirve el sitio y /api/chat)
npm run check   # build + cobertura de clases + sintaxis + paridad con el CDN + tests del bot
npm run test    # tests del bot: api/chat.js con la API simulada y el chat en un navegador real
```

### Probar el canal de ayuda en local

`npm run dev` solo vigila el CSS, así que **no alcanza para probar el chat**: abriendo `index.html` por `file://` el `fetch` a `/api/chat` falla por CORS y no hay nada que conteste. Para eso está `npm run start`, que publica el sitio y le pasa las peticiones de `/api/chat` al mismo handler que usa Vercel — lo que se prueba en local es el mismo código que va a producción.

Necesita una clave. Copiá `.env.example` a `.env.local` y pegá la clave ahí:

```bash
cp .env.example .env.local   # en Windows: copy .env.example .env.local
# editá .env.local y poné GEMINI_API_KEY=tu-clave
npm start
```

La del free tier se consigue en [AI Studio](https://aistudio.google.com/apikey), sin tarjeta. `.env.local` está en `.gitignore`, así que la clave no se sube al repositorio. En Vercel no hace falta ese archivo: las variables se definen en el panel del proyecto. Al arrancar, el servidor dice qué proveedor usa, si encontró la clave y, si no, qué variable falta.

Al agregar clases nuevas hay que recompilar y commitear `assets/lotus.css`; en Vercel el build se ejecuta en cada deploy (`vercel.json`).

`npm run check` incluye `scripts/audit-tailwind-parity.mjs`, que compara el CSS compilado contra lo que renderizaba el CDN. El CDN servía Tailwind v3 y la CLI es v4, así que entre una y otra cambiaron cosas que se ven sin que nadie lo note en el código:

- **Sombras.** `shadow-sm` de v4 quedó más marcado. Fijado al valor de v3.
- **Paleta.** v4 migró los colores a OKLCH y 22 referencias cambiaron de valor; el más visible es `emerald-500`, de `#10B981` a `#00BC7D`, que es justamente el verde de marca de este proyecto. Fijados los 19 que el sitio usa.
- **Fuentes.** v4 agrega `ui-sans-serif, system-ui` al stack. Con las webfonts caídas eso resuelve a otra fuente y el texto se rasteriza distinto. Se repitió el stack del `tailwind.config` original.
- **Interlineado.** v4 emite el `line-height` de cada escala como `calc(<len>/<len>)`. En CSS dividir dos longitudes da un **número**, y un número en `line-height` se hereda como multiplicador: el elemento que usa la escala mide igual que en v3, pero un hijo que solo cambia el tamaño de fuente se queda sin interlineado. Un hijo de `text-3xl` pasaba de 36px a 13.2px. Se redefinieron los siete tokens `--text-*--line-height` como longitudes absolutas, con los valores de v3 medidos en el sitio original (no los de la documentación, porque el `tailwind.config` los sobreescribía). Es seguro porque `.text-sm` compila como `line-height:var(--tw-leading,…)`, así que un `leading-*` explícito sigue mandando. Para recuperar el interlineado proporcional de v4, borrar ese bloque de `src/tailwind.css`.
- **Bordes y rings.** v4 usa `currentColor` como color de borde y 1px de ring donde v3 usaba gris y 3px. Hoy el sitio no tiene ningún `border` sin color ni `ring` sin ancho, y el script lo verifica.
- **Sombras `shadow-2xs` y `shadow-xs`.** El CDN era v3 y **no definía** esas dos utilidades, así que los 11 usos de `shadow-2xs` y los 2 de `hover:shadow-xs` se dibujaban sin sombra; con v4 sí se aplican. Es la única diferencia visual que queda y es intencionada. Para volver al comportamiento anterior, quitar esas clases del HTML.

`npm run check:render` sí abre Chrome y compara capturas de píxeles entre el sitio con el CDN y el sitio con el CSS compilado, con el HTML idéntico en las dos ramas. Necesita `BEFORE_DIR` apuntando al sitio original, porque de ahí toma el `tailwind.config` que usaba el CDN:

```bash
BEFORE_DIR=/ruta/al/sitio-original npm run check:render
```

Los umbrales están en `scripts/verify-render.mjs`. La comparación es determinista (dos capturas de la misma página dan 0 píxeles distintos), así que los umbrales solo sirven para detectar regresiones: hoy las cuatro pantallas quedan en 0.029%, 0.040%, 0.006% y 0.143%, que es antialiasing de texto y el borde de 1px de las sombras del punto anterior.

## Asistente de ayuda

El chat de ayuda usa una función de Vercel (`api/chat.js`). Por defecto consulta la API de **Google Gemini**, cuyo free tier no cobra y no pide tarjeta; la alternativa con Anthropic queda disponible pero cuesta plata. Para habilitarlo, defina la credencial del proveedor como variable de entorno secreta en la configuración del proyecto de Vercel y vuelva a desplegar. Nunca coloque la clave en `index.html` ni la suba al repositorio.

Los mensajes enviados al chat se procesan mediante un modelo de lenguaje de un tercero. No envíe datos personales ni información confidencial. El asistente no tiene acceso a datos reales: esta aplicación es una demo y muestra información ficticia.

**Sobre el free tier de Gemini:** la documentación de Google indica que en el nivel gratuito el contenido puede usarse para mejorar sus productos. Para una demo con datos de ejemplo no es un problema, pero es el motivo por el que conviene no mandar información sensible por ese canal.

Variables de entorno (ver `.env.example`):

| Variable | Requerida | Por defecto | Notas |
| --- | --- | --- | --- |
| `CHAT_PROVIDER` | no | `gemini` | `gemini` o `anthropic`. Un valor desconocido hace que la función responda 500. |
| `GEMINI_API_KEY` | sí, si el proveedor es Gemini | — | Sin ella `/api/chat` responde 503. Se consigue gratis en [AI Studio](https://aistudio.google.com/apikey). |
| `GEMINI_MODEL` | no | `gemini-3.5-flash-lite` | Ver abajo: el free tier retira y satura modelos. |
| `ANTHROPIC_API_KEY` | sí, si el proveedor es Anthropic | — | Sin ella responde 503. Anthropic no tiene free tier. |
| `ANTHROPIC_MODEL` | no | `claude-sonnet-5-5` | `claude-haiku-4-5-20251001` fue retirado el 15/10/2026. |
| `ANTHROPIC_EFFORT` | no | `low` | Subirlo obliga a subir `MAX_TOKENS`. |
| `CHAT_RATE_LIMIT` | no | `12` | Consultas por IP cada 60 s. Ojo: `0` **no** desactiva el límite, cae en 12. Para dejar el canal sin límite por IP hay que editar `checkRateLimit()` en `api/chat.js`. |

Lo único que cambia entre proveedores es el armado de la petición y la lectura de la respuesta; la validación, el rate limit y el manejo de errores son comunes. `scripts/test-chat.mjs` corre la suite entera contra **los dos**, así que un cambio en uno no puede romper el otro en silencio.

### El modelo por defecto está medido, no supuesto

Esto se escribió primero con `gemini-2.5-flash`, que es el ejemplo del quickstart de Google. Al probarlo contra la API real respondió:

```
This model models/gemini-2.5-flash is no longer available to new users.
Please update your code to use models/gemini-3.8-flash
```

Cambiar a `3.8-flash` tampoco sirvió: devuelve 503 `This model is currently experiencing high demand`. Lo que quedó fue `gemini-3.5-flash-lite`, que respondió en 0.7–1.5 s de forma sostenida mientras `3.5-flash` tardaba 12 s y `3.6`, `3.7` y `3.8` estaban saturados.

La capacidad del free tier es volátil: entre dos consultas del mismo minuto un modelo puede pasar de 503 a 12 s. Si el canal empieza a fallar, `npm run check:modelos` lista lo que acepta la clave y prueba cuál responde, para cambiar `GEMINI_MODEL` con datos en vez de adivinar. Ojo que el listado por sí solo no alcanza: un modelo puede figurar en la lista y dar 404.

Tampoco se manda `thinkingConfig`. Se probaron las cinco variantes contra la API: `thinkingLevel: "off"` da 400 en los flash-lite y `thinkingBudget: 0` da 400 en dos de cada tres. Los flash-lite no razonan aunque no se les pida, así que mandarlo solo agregaba una forma de romper el canal. El handler sigue filtrando los bloques `thought: true` por si alguien cambia a un modelo que sí razona.

Dos detalles que imponen la API de cada lado y conviene no olvidar:

- Gemini nombra al asistente `model` donde Anthropic usa `assistant`, y devuelve los bloques de razonamiento en la misma lista de `parts` marcados con `thought: true`. Sin filtrarlos, el operario leería el razonamiento crudo en la burbuja del chat.
- Google responde **400** y no 401 cuando la clave no existe (`API_KEY_INVALID`), mientras que Anthropic responde 401. Por eso el handler mira el cuerpo del error y no solo el status: una clave mal pegada es un problema de configuración y devuelve 503, no un 502 que invita a reintentar.

El rate limit vive en memoria de la función, así que es por instancia y no sustituye a un límite en el borde.

`scripts/test-chat-ui.mjs` prueba el frontend en Chrome de verdad: sustituye `fetch`, hace fallar la primera consulta, pulsa el botón «Reintentar» que genera el propio código y cuenta lo que queda en el DOM. Cubre lo que `test-chat.mjs` no alcanza, porque aquel solo prueba la función serverless. Es la prueba que sostiene el fix del reintento: quitando la línea que retira la burbuja del usuario, la prueba falla con dos burbujas en pantalla.

## PARTICIPANTES

-AXEL CEBALLES
-FEDERICO LERA
-BERENICE
-AGUSTIN
