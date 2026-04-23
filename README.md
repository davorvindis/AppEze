# Sistema de Stock Centralizado — Inventario Obras (v4)

Sistema de inventario multi-depósito para materiales de construcción, con app web mobile-first, backend serverless sobre Google Apps Script, y Google Sheets como base de datos.

## Contexto del negocio

Empresa constructora con stock propio distribuido en 5+ galpones (Tinglado, Galpón 1000, Galpón 710, Galpón 5000, Galpón 3) que maneja materiales heterogéneos: porcelanato, aires acondicionados, jacuzzis, bañeras, duchas, grifería, aberturas, eléctricos, pinturas, etc. Todo el stock se consume internamente en obras propias (no hay venta a clientes externos).

Antes: información dispersa en papel, WhatsApp y planillas sueltas. Objetivo: centralizar y permitir carga/consulta desde el celular en el galpón.

## Stack técnico

| Capa | Tecnología | Por qué |
|------|-----------|---------|
| Frontend | HTML5 + JS vanilla + CSS custom (sin framework) | Archivo único, sin build, mobile-first. Corre local o en cualquier hosting estático. |
| Backend / API | Google Apps Script (v8 runtime) | Gratis, sin servidor, permisos nativos con la cuenta del dueño. Expone endpoints JSON vía `doGet`/`doPost`. |
| Base de datos | Google Sheets (7 hojas) | El "dueño" puede ver/editar datos directamente sin UI. Permite a usuarios no-técnicos del equipo operar sobre el Sheet si hace falta. |
| Storage de imágenes | Google Drive (subcarpetas auto-creadas por categoría) | Integrado con el stack de Google; compartido como "cualquiera con el enlace → lector" para que la app web y los QR públicos muestren las fotos sin login. |
| Códigos QR | Servicio público `api.qrserver.com` (fetch desde Apps Script) | Evita dependencias. Cada QR apunta a una URL `/exec?action=infoProducto&sku=XXX` del mismo Apps Script, que sirve HTML público con info + stock actualizado. |
| Autenticación | Token API (constante en Apps Script) + login por usuario + PIN de 4 dígitos | Dos niveles: el token protege la API a nivel app; los usuarios se definen en un array `USUARIOS` en el Apps Script y cada uno tiene su PIN. El nombre del usuario que está logueado queda registrado en cada movimiento. |

## Arquitectura

```
┌────────────────────────────────────────┐
│  HTML/JS app (index.html)       │  ← corre local o en servidor estático
│  - URL y token HARDCODEADOS en el JS   │
│  - Overlay de login: selector usuario  │
│    + PIN pad (4 dígitos) con sesión    │
│    persistida en sessionStorage        │
│  - Pestañas: Stock / Productos /       │
│    Zonas / Obras                       │
│  - Modales: Ingreso / Traslado /       │
│    Egreso / Ajuste / Reserva /         │
│    Nuevo Producto / Nueva Obra /       │
│    Subir Foto / Generar QR /           │
│    Consumo por Obra                    │
└──────────────────┬─────────────────────┘
                   │ fetch JSON (GET con query, POST con JSON body)
                   ▼
┌────────────────────────────────────────┐
│  Apps Script (03_AppsScript_API.gs)    │
│  - handle() con switch de actions      │
│  - Valida token en cada request        │
│  - doGet → puede devolver HTML         │
│    público (destino del QR)            │
└───────────┬─────────────────┬──────────┘
            │                 │
            ▼                 ▼
    ┌──────────────┐   ┌──────────────┐
    │ Google Sheet │   │ Google Drive │
    │  (7 hojas)   │   │ /Fotos/{cat} │
    │              │   │ /QRs/{cat}   │
    └──────────────┘   └──────────────┘
```

### Endpoints del Apps Script

Todos reciben `action` y `token` (excepto `infoProducto` que es público):

| Action | Método | Descripción |
|--------|--------|-------------|
| `getUsuarios` | GET | Lista de usuarios registrados (sólo `user` y `nombre`, nunca el PIN). Lo consume la pantalla de login. |
| `login` | POST | Valida `user` + `pin` contra el array `USUARIOS` del Apps Script. Devuelve `{ user, nombre }` o error. |
| `getProducts` | GET | Catálogo de productos activos |
| `getZones` | GET | Zonas/galpones activos |
| `getObras` | GET | Obras |
| `getCategorias` | GET | Lista de categorías/subcategorías |
| `getStock` | GET | Stock actual por SKU × zona (físico, reservado, disponible, alerta) |
| `getMovimientos` | GET | Últimos N movimientos |
| `getMovimientosObra` | GET | Movimientos + consumo acumulado + reservas vigentes de una obra |
| `getAlertas` | GET | Productos bajo stock mínimo |
| `addMovimiento` | POST | Registra movimiento (valida stock si aplica) |
| `addProducto` | POST | Alta de producto (SKU autogenerado si se omite) |
| `addObra` | POST | Alta de obra |
| `uploadFoto` | POST | Recibe base64, guarda en Drive, actualiza `Foto_URL` |
| `generarQR` | POST | Genera QR que apunta a `infoProducto` del mismo script, guarda en Drive |
| `sincronizarFotos` | POST | Recorre /Fotos/ y asocia archivos con SKU en su nombre a productos |
| `infoProducto` | GET (público) | HTML standalone con info + stock del SKU. Es el destino de los QR. |

### Modelo de datos (7 hojas del Sheet)

1. **Productos**: `SKU | Nombre | Categoria | Subcategoria | Unidad | Foto_URL | Stock_Minimo_Total | Notas | Activo | Unidad_Pack | Cantidad_Por_Pack`
   - `Unidad_Pack` (opcional): cómo viene el producto del proveedor (`pallet`, `caja`, `rollo`, `bulto`, `bolsa`, `pack`).
   - `Cantidad_Por_Pack` (opcional): cuánto de la `Unidad` de stock representa 1 pack (ej: 1 pallet de porcelanato = 60 m² → `60`). La app usa este dato para el cálculo automático en ingresos.
2. **Zonas**: `Codigo | Nombre | Descripcion | Activo | Ubicacion` (col E = link Maps)
3. **Categorias**: `Categoria | Subcategoria` (lista maestra)
4. **Obras**: `Codigo | Nombre | Direccion | Estado | Fecha_Inicio | Notas | Ubicacion` (col G = link Maps)
5. **Movimientos** (fuente de verdad): `ID | Fecha | Tipo | SKU | Cantidad | Zona_Origen | Zona_Destino | Obra | Motivo_Ajuste | Usuario | Notas`
6. **Stock_Actual** (vista calculada por fórmulas SUMIFS sobre Movimientos): matriz SKU × Zona con Total_Fisico, Reservado, Disponible, Minimo, Alerta
7. **Instrucciones** (hoja de ayuda)

### Tipos de movimiento

| Tipo | Zona_Origen | Zona_Destino | Obra | Efecto |
|------|-------------|--------------|------|--------|
| `Ingreso` | — | ✔ | — | +zona_destino |
| `Traslado` | ✔ | ✔ | — | −zona_origen, +zona_destino |
| `Egreso` | ✔ | — | ✔ | −zona_origen (consumo real a obra) |
| `Ajuste` | ✔ | — | — | ±zona_origen con motivo (rotura, error conteo, pérdida, inventario inicial) |
| `Reserva` | ✔ | — | ✔ | Aparta stock sin moverlo (afecta "Disponible" pero no "Físico") |
| `Libera_Reserva` | ✔ | — | ✔ | Cancela una reserva previa |

### SKU automático

Si el usuario no especifica SKU al crear un producto:
- 3 letras normalizadas de Categoría (sin acentos, solo A-Z)
- 3 letras de Subcategoría (o `GEN` si no hay)
- Correlativo de 3 dígitos dentro de ese prefijo

Ejemplos:
- `Revestimientos / Porcelanato` → `REV-POR-001`, `REV-POR-002`, ...
- `Climatización / Aire acondicionado split` → `CLI-AIR-001`
- `Sanitarios / Bañera` → `SAN-BAN-001`

## Estructura de archivos en el repo

```
.
├── README.md                        ← este archivo
├── 01_DISEÑO_Sistema_Stock.md       ← documento de diseño / specs
├── 02_Plantilla_Stock.xlsx          ← plantilla del Google Sheets
├── 03_AppsScript_API.gs             ← backend (se pega en el editor de Apps Script)
├── index.html                ← frontend single-file
└── 05_Guia_Implementacion.md        ← paso a paso de setup
```

## Estructura de Google Drive (creada automáticamente por el Apps Script)

```
Stock Galpones/                         ← carpeta raíz (configurada por ID en Apps Script)
├── Fotos/
│   ├── Revestimientos/
│   │   ├── REV-POR-001_Porcelanato_madera.jpg
│   │   └── ...
│   ├── Climatización/
│   ├── Sanitarios/
│   └── ...
└── QRs/
    ├── Revestimientos/
    │   ├── REV-POR-001_Porcelanato_madera_QR.png
    │   └── ...
    └── ...
```

## Setup (resumen — ver `05_Guia_Implementacion.md` para el detalle)

1. Crear carpeta en Drive, copiar su ID.
2. Subir `02_Plantilla_Stock.xlsx`, convertir a Google Sheet.
3. Extensiones → Apps Script → pegar `03_AppsScript_API.gs`, editar `API_TOKEN`, `DRIVE_ROOT_FOLDER_ID` y el array `USUARIOS` (usuario + PIN + nombre de cada persona del equipo).
4. Implementar como Web App, autorizar permisos (Sheets + Drive + UrlFetch), copiar URL `/exec`.
5. Editar `index.html` y pegar la URL del paso 4 y el token del paso 3 en las constantes `API_URL` y `API_TOKEN` del principio del `<script>`.
6. Abrir el HTML → loguearse con usuario + PIN.
7. Cargar datos iniciales (zonas, obras, productos) y hacer los ajustes de "Inventario inicial".

## Decisiones de diseño clave

- **El stock no se guarda**: se calcula siempre a partir del log de movimientos (única fuente de verdad). Evita desincronización, da trazabilidad total.
- **Anular = movimiento inverso**: nunca borrar filas de Movimientos. Si hay un error, cargar un movimiento opuesto (con nota explicativa).
- **Reservas separadas del físico**: el campo "Disponible" = Físico − Reservado. Esto permite apartar material para una obra sin moverlo todavía.
- **QR → URL pública del mismo backend**: el QR codifica `SCRIPT_URL?action=infoProducto&sku=XXX`, que sirve HTML standalone. No hace falta hostear nada extra — cualquiera puede escanear con el celu y ver info + stock live.
- **Dos niveles de auth (token + PIN por usuario)**: el token API protege la API a nivel app (nadie de afuera puede pegarle). Los usuarios con PIN se definen en un array del Apps Script (`USUARIOS`) y sirven para identificar quién hizo cada movimiento en el log. Es deliberadamente simple — pensado para un equipo conocido de 2-8 personas, estilo "desbloqueo de teléfono". El nombre del usuario logueado queda en cada fila de Movimientos.
- **URL y token hardcodeados en el HTML**: se eliminó la vista de "Configuración" que existía en v3. Ahora al abrir la app van directo al login. Simplifica el onboarding (el usuario no tiene que copiar URLs ni tokens) a cambio de tener que editar el HTML si cambia el deployment.
- **Sin frameworks en el frontend**: un solo archivo HTML de ~1000 líneas. Facilita mantenimiento, despliegue y entendimiento para el dueño (no-dev) que quiere poder tocar cosas.
- **CORS y Apps Script**: Apps Script tiene particularidades — `content-type: text/plain` evita preflight para requests GET simples; para uploads de base64 se usa POST con `application/json` y `e.postData.contents` se parsea manualmente.
- **SKU auto con fallback**: si el usuario quiere pasar su propio SKU (ej. código del proveedor), lo respeta; si no, genera uno coherente con la taxonomía.

## Estado actual y próximos pasos

**Implementado (v4):**
- Todos los endpoints de arriba.
- App con 4 vistas (Stock, Productos, Zonas, Obras) + 10+ modales.
- Subida de fotos desde la app + sincronización desde Drive.
- Generación de QR por producto.
- Consumo por obra interactivo (histórico, totales, reservas vigentes).
- Alertas de stock bajo.
- Links a Google Maps para zonas y obras.
- Reservas y liberación de reservas.
- **Pack / pallet en productos** — cada producto puede definir una "Unidad_Pack" (pallet, caja, rollo, bulto, bolsa, pack) y cuánto de la unidad de stock representa un pack. Al hacer un Ingreso, un toggle "Cargar por pack" permite ingresar cantidad de packs y la app calcula el total en unidades de stock antes de guardar.
- **Egreso masivo multi-producto** — un solo egreso puede tener varias líneas (producto × zona × cantidad) bajo la misma obra. Sólo se listan productos con stock >0; por línea se muestran las zonas con stock y la cantidad disponible. Validación en tiempo real: si la cantidad excede lo disponible el botón "Guardar todo" se bloquea.
- **Login por usuario + PIN (v4)** — overlay de login al abrir la app con selector de usuario (avatar con iniciales) y PIN pad de 4 dígitos estilo "desbloqueo de celular". Los usuarios se definen en el array `USUARIOS` del Apps Script. Sesión persistida en `sessionStorage` (no hay que reloguearse al refrescar). El header muestra un chip con avatar del usuario logueado + botón de logout. Animación de shake en PIN incorrecto. Soporte de teclado físico (0-9 y Backspace) para PC.
- **URL y token hardcodeados (v4)** — se eliminó la vista de Configuración. Las constantes `API_URL` y `API_TOKEN` van al principio del `<script>` del HTML.
- **Fixes de v2→v3**:
  - Atributos `onclick` y `onerror` ahora se construyen con helpers (`jsStr`, `attrEsc`) en vez de escapes manuales — los botones Reservar/Liberar/Foto/QR del detalle de producto ya funcionan correctamente.
  - Imagen fallback extraída a una constante global `NO_FOTO` (data URL SVG pre-codificado) — desaparece el bug que mostraba el HTML del SVG como texto en las tarjetas cuando fallaba la carga.

**Pendiente / roadmap:**
1. **Publicación en servidor propio** — mover `index.html` a un hosting (Netlify / Vercel / VPS).
2. **Autenticación robusta** — migrar del esquema actual (token + PIN) a Google Identity Services (login con Google) + permisos por rol (admin, operador, solo lectura). El esquema actual alcanza para un equipo chico pero no escala a permisos diferenciados.
3. **CORS restringido** — limitar el Apps Script a aceptar sólo requests desde el dominio propio.
4. **Reportes** — dashboard de consumos mensuales por obra, productos más movidos, rotación, etc.
5. **Remitos PDF** — generar PDF automático al hacer un egreso a obra.
6. **Backup** — trigger programado que copie el Sheet semanalmente a otra carpeta.
7. **Notificaciones** — email/WhatsApp cuando un producto cae bajo mínimo.
8. **Escaneo de QR desde la app** — usar `getUserMedia` para leer el QR con la cámara del celu y auto-seleccionar el producto en el formulario de egreso.
9. **Editar / dar de baja productos, zonas, obras** — actualmente solo se puede crear (o editar desde el Sheet directamente).
10. **Fotos múltiples por producto** — hoy es una sola; podría soportar galería.

## Cómo colaborar (para otra IA o un dev humano)

Si estás entrando al proyecto, empezá por:
1. Leer `01_DISEÑO_Sistema_Stock.md` para entender el modelo completo.
2. Leer este README para el stack y las decisiones.
3. El código vive en dos archivos: `03_AppsScript_API.gs` (~400 líneas, backend) y `index.html` (~700 líneas, frontend). Ambos comentados en castellano.
4. La plantilla `02_Plantilla_Stock.xlsx` se puede regenerar desde un script Python que no está en el repo (se puede recrear fácil con openpyxl si hace falta modificarla).
5. Para probar cambios al backend: editar en el editor de Apps Script, guardar, redesplegar con "Gestionar implementaciones → editar → nueva versión". La URL `/exec` se mantiene.
6. Para probar el frontend: abrir el archivo HTML en el navegador. No hay build step.

**Convenciones:**
- Todo en castellano rioplatense (el dueño y los usuarios son argentinos).
- SKU, códigos de zona y obra siempre en mayúsculas.
- Los nombres de hojas del Sheet están hardcoded como constantes al principio del `.gs` — si se renombran hay que actualizarlas.
- Los tipos de movimiento son un enum string cerrado: `Ingreso | Traslado | Egreso | Ajuste | Reserva | Libera_Reserva`. Cambios al enum requieren actualizar validaciones en el `.gs` y las fórmulas del Stock_Actual en el `.xlsx`.
- Las fotos y QRs siempre se nombran `{SKU}_{nombre_sanitizado}.{ext}` — el script `sincronizarFotos` depende de ese prefijo.

## Licencia

Proyecto privado. Todos los derechos reservados.
