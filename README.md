# L.O.T.U.S. SOLUTIONS 
Sistema de terminal de autoservicio para control y gestión de pañol 



  Identidad Visual y Diseño (Light Mode Corporativo)
- **Marca**: L.O.T.U.S. SOLUTIONS (*Logic Optimization & Technology Unified Solutions*).
- **Paleta de Colores**:
  - Color Primario Institucional: **Azul Marino Profundo** (`#1A2B42`).
  - Fondo de Aplicación: **Gris Ultra Claro** (`#F8F9FA`).
  - Acentos de Estado: Verde Esmeralda (`#10B981`) para condiciones habilitadas y confirmación de escaneo.
- **Tipografías**: Google Fonts (*Montserrat* para titulares e identidad de marca, e *Inter* para datos de alta legibilidad).
- **Estilo**: Kiosk KDS industrial, minimalista, limpio y moderno.


 Flujo de Pantallas e Interacciones

### 1. Pantalla 1: Standby (Esperando NFC)
- Presenta el imagotipo oficial con anillos concéntricos y pulso armónico en Azul Marino.
- Indicación clara: *"Por favor, apoye su tarjeta NFC en el lector para ingresar."*
- **Mecánica Hardware**: Contiene un `input` oculto con foco permanente. Al aproximar una tarjeta NFC o presionar la tecla `Enter`, emite un chime armónico de confirmación y transiciona a la Pantalla 2.

### 2. Pantalla 2: Dashboard del Operario
- Ficha de perfil: **"Usuario: Juan Pérez | Sector: Mantenimiento | #OP-8492"**.
- Indicador de estado con pulso activo: **"Estado: Habilitado"**.
- Dos pulsadores principales en bloque sólido Azul Marino (`#1A2B42`) con iconografía vectorial:
  - **RETIRO DE HERRAMIENTA** (Salida).
  - **DEVOLUCIÓN** (Reintegro).
- Botón secundario minimalista: **"Cerrar sesión"** (vuelve a Standby).

### 3. Pantalla 3: Escaneo de Herramienta (Código de Barras)
- Visor con mira óptica y animación de escaneo láser vertical rojo.
- Texto: *"Escanee el código de barras de la herramienta"*.
- Input invisible con foco continuo para captura de pistola lectora HID.
- Al accionar el lector láser o pulsar `Enter`:
  - Emite el clásico beep acústico industrial generado por Web Audio API.
  - Despliega una alerta modal verde estilizada con el mensaje **"Retiro registrado exitosamente"** (o devolución) y detalle del ítem.
  - Barra de progreso con temporizador que retorna automáticamente a la **Pantalla 1 tras 3 segundos**.


