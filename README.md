# Terminal de herramientas L.O.T.U.S.

Guía rápida para el equipo de Falmet y pañol industrial.

## Demo en línea

[Abrir L.O.T.U.S. en Vercel](https://lotusweb-git-main-kirou.vercel.app/)

## ¿Para qué sirve?

Es una demostración de una pantalla (kiosk SPA) para retirar y devolver herramientas del pañol de **L.O.T.U.S. SOLUTIONS** (*Logic Optimization & Technology Unified Solutions*). Permite recorrer el flujo y consultar una lista de herramientas de ejemplo.

Los datos que aparecen son ficticios. La página no registra movimientos reales, no se conecta a una base de datos y no usa APIs públicas.

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
