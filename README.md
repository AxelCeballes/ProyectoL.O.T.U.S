# L.O.T.U.S. SOLUTIONS - Suite Industrial (Kiosk & Admin Dashboard)

Plataforma frontend SPA para la gestión, supervisión y control de pañol industrial en fábricas y talleres metalúrgicos. Desarrollada con **HTML5, Tailwind CSS y JavaScript Vanilla**.

---

## 📂 Módulos de la Solución

### 1. `dashboard.html` — Panel de Administración (Supervisión y Control)
Diseñado para jefes de planta, supervisores de pañol y personal de mantenimiento.

* **Layout Clásico de Dashboard**:
  - **Sidebar Lateral**: Navegación entre *Dashboard*, *Historial de Operaciones*, *Alertas*, *Inventario* y *Personal*, con enlace directo al Kiosk.
  - **Barra Superior**: Buscador global rápido con atajo <kbd>Ctrl+K</kbd>, indicador de turno fabril, campanita de notificaciones con badge de alertas activas y perfil de usuario.
* **Historial de Operaciones (Core)**:
  - **Data Table** moderna con ordenamiento e interactividad.
  - **Filtros Dinámicos en Tiempo Real**: Búsqueda por operario, ítem o ID; filtro por tipo de acción (*Retiro*, *Devolución*, *Reporte de Falla*); filtro por fecha (*Hoy*, *Ayer*, *Semana*); y filtro por estado (*Completado*, *Pendiente*).
  - **Paginación** configurable y botón de **Exportación a CSV**.
  - Modal para registro de nueva operación manual y visor de fichas técnicas.
* **Centro de Alertas en Tiempo Real (Core)**:
  - Tarjetas con niveles de severidad: **Urgente / Fallas** (Rojo), **Advertencias / Mantenimiento** (Amarillo/Naranja) e **Informativas**.
  - Tarjetas precargadas con casos reales de fábrica metalúrgica (Torno paralelo MAQ-001, stock crítico de discos de corte, pico térmico CNC Haas, torquímetro vencido).
  - **Interacción Multicanal**: Botón *"Enviar Aviso (WhatsApp)"* que conmuta al estado *"Aviso Enviado ✔️"* y actualiza el contador de alertas en tiempo real.
* **Inventario & Padrón de Operarios**: Vistas complementarias con stock, códigos de máquina, habilitación de tarjetas NFC y herramientas en custodia.

---

### 2. `index.html` — Terminal de Pañol Kiosk (Autoservicio)
Diseñado para terminales táctiles y estaciones KDS de entrega rápida en el pañol.

* **Pantalla 1 (Standby NFC)**: Espera de lectura de tarjeta NFC con pulsos concéntricos, logo corporativo oficial y atajo de teclado para emular lector RFID.
* **Pantalla 2 (Dashboard Operario)**: Ficha de usuario ("Juan Pérez - Mantenimiento") con estado habilitado y dos botones de bloque sólido: *RETIRO DE HERRAMIENTA* y *DEVOLUCIÓN*.
* **Pantalla 3 (Escáner Láser de Código de Barras)**: Visor de mira óptica con haz láser rojo animado, sonido acústico industrial generado por Web Audio API y alerta verde de confirmación con retorno automático en 3 segundos.

---

## 🎨 Identidad Visual y Estilo Corporativo

- **Estilo**: Corporativo, moderno, limpio (Light Mode).
- **Color de Fondo**: Gris ultra claro (`#F8F9FA`).
- **Color Principal**: Azul Marino Profundo (`#1A2B42`).
- **Colores de Estado**:
  - 🔴 **Rojo** (`#EF4444`): Urgente, fallas y paradas recomendadas.
  - 🟡 **Amarillo / Naranja** (`#F59E0B`): Advertencias, mantenimientos preventivos y bajo stock.
  - 🟢 **Verde** (`#10B981`): Operativo, habilitado y aviso enviado con éxito.
- **Tipografías**: Google Fonts (*Inter* para lectura precisa de datos y *Montserrat* para encabezados institucionales).

---

## 🖥️ Cómo ejecutar y probar

No requiere instalación de servidores ni dependencias (`npm` o `node`).

1. **Abrir el Panel de Administración**: Doble clic sobre [`dashboard.html`](dashboard.html) en tu navegador.
2. **Abrir el Kiosk de Pañol**: Doble clic sobre [`index.html`](index.html).
3. Ambos módulos cuentan con navegación cruzada en sus encabezados para alternar entre uno y otro de forma instantánea.
