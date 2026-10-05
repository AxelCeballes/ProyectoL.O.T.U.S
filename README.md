# Terminal de herramientas L.O.T.U.S.

Guía rápida para el equipo de Falmet y pañol industrial.

## Demo en línea

[Abrir L.O.T.U.S. en Vercel](https://lotusweb-flame.vercel.app/)

## ¿Para qué sirve?

Es una demostración de una pantalla para retirar y devolver herramientas del pañol de **L.O.T.U.S. SOLUTIONS** (*Logic Optimization & Technology Unified Solutions*). Permite recorrer el flujo y consultar una lista de herramientas de ejemplo.

Los datos que aparecen son ficticios. La página no registra movimientos reales ni se conecta a una base de datos. El asistente de ayuda sí envía las consultas a la API de Anthropic.

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

## Panel de administración y reparaciones

El botón «Panel Admin» solicita la contraseña `falmet` antes de abrir el inventario de ejemplo, donde se pueden consultar y registrar reparaciones. Esta clave está en el JavaScript público del navegador y solo sirve como bloqueo visual de la demo; no reemplaza autenticación segura. En modo local, los cambios se guardan en `localStorage` del navegador y solo existen en ese navegador. No son datos compartidos ni un registro real.

`repairs-router.js` es una opción independiente para un servidor Express propio; no se usa en el despliegue estático de Vercel. Para persistencia compartida en producción, conecte el panel a una base de datos y agregue autenticación de administrador antes de habilitar escrituras.

## Desarrollo

El CSS ya no se carga desde `cdn.tailwindcss.com`: Tailwind se compila a `assets/lotus.css` y se versiona en el repositorio. Para trabajar sobre el diseño:

```bash
npm install
npm run build   # recompila assets/lotus.css
npm run dev     # recompila al guardar
npm run check   # build + cobertura de clases + sintaxis + paridad con el CDN + tests del bot
npm run test    # tests del bot: api/chat.js con la API simulada y el chat en un navegador real
```

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

El chat de ayuda usa una función de Vercel (`api/chat.js`) que consulta la API de Anthropic. Para habilitarlo, configure `ANTHROPIC_API_KEY` como variable de entorno secreta en la configuración del proyecto de Vercel y vuelva a desplegar. Nunca coloque la clave en `index.html` ni la suba al repositorio.

Los mensajes enviados al chat se procesan mediante Anthropic. No envíe datos personales ni información confidencial. El asistente no tiene acceso a datos reales: esta aplicación es una demo y muestra información ficticia.

`api/chat.js` es la única función serverless del bot. Usa `claude-sonnet-5-5` con `thinking: between_tools`, porque ese tipo de thinking consume `max_tokens` (1024) y con `enabled` no alcanzaría para una respuesta.

Variables de entorno (ver `.env.example`):

| Variable | Requerida | Por defecto | Notas |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | sí | — | Sin ella `/api/chat` responde 503. Definir en el panel de Vercel. |
| `ANTHROPIC_MODEL` | no | `claude-sonnet-5-5` | `claude-haiku-4-5-20251001` fue retirado el 15/10/2026. |
| `ANTHROPIC_EFFORT` | no | `low` | Subirlo obliga a subir `MAX_TOKENS`. |
| `CHAT_RATE_LIMIT` | no | `8` | Consultas por IP cada 60 s; `0` desactiva. |

El rate limit vive en memoria de la función, así que es por instancia y no sustituye a un límite en el borde.

`scripts/test-chat-ui.mjs` prueba el frontend en Chrome de verdad: sustituye `fetch`, hace fallar la primera consulta, pulsa el botón «Reintentar» que genera el propio código y cuenta lo que queda en el DOM. Cubre lo que `test-chat.mjs` no alcanza, porque aquel solo prueba la función serverless. Es la prueba que sostiene el fix del reintento: quitando la línea que retira la burbuja del usuario, la prueba falla con dos burbujas en pantalla.

## PARTICIPANTES

-AXEL CEBALLES
-FEDERICO LERA
-BERENICE
-AGUSTIN