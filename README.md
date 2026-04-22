# Sistema de Stock Centralizado — Inventario Obras

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
| Autenticación | Token API compartido (constante en Apps Script) | MVP. En el roadmap está migrar a Google Identity Services cuando se publique en servidor propio. |

## Arquitectura

```
┌────────────────────────────────────────┐
│  HTML/JS app (04_App_Stock.html)       │  ← corre local o en servidor estático
│  - Pestañas: Stock / Productos /       │
│    Zonas / Obras / Config              │
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

1. **Productos**: `SKU | Nombre | Categoria | Subcategoria | Unidad | Foto_URL | Stock_Minimo_Total | Notas | Activo`
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
├── 04_App_Stock.html                ← frontend single-file
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
3. Extensiones → Apps Script → pegar `03_AppsScript_API.gs`, editar `API_TOKEN` y `DRIVE_ROOT_FOLDER_ID`.
4. Implementar como Web App, autorizar permisos (Sheets + Drive + UrlFetch), copiar URL `/exec`.
5. Abrir `04_App_Stock.html`, pestaña Config, pegar URL y token.
6. Cargar datos iniciales (zonas, obras, productos) y hacer los ajustes de "Inventario inicial".

## Decisiones de diseño clave

- **El stock no se guarda**: se calcula siempre a partir del log de movimientos (única fuente de verdad). Evita desincronización, da trazabilidad total.
- **Anular = movimiento inverso**: nunca borrar filas de Movimientos. Si hay un error, cargar un movimiento opuesto (con nota explicativa).
- **Reservas separadas del físico**: el campo "Disponible" = Físico − Reservado. Esto permite apartar material para una obra sin moverlo todavía.
- **QR → URL pública del mismo backend**: el QR codifica `SCRIPT_URL?action=infoProducto&sku=XXX`, que sirve HTML standalone. No hace falta hostear nada extra — cualquiera puede escanear con el celu y ver info + stock live.
- **Token único compartido en vez de login**: MVP. Aceptable para 2-5 usuarios conocidos. El camino a autenticación real está documentado en el roadmap.
- **Sin frameworks en el frontend**: un solo archivo HTML de ~600 líneas. Facilita mantenimiento, despliegue y entendimiento para el dueño (no-dev) que quiere poder tocar cosas.
- **CORS y Apps Script**: Apps Script tiene particularidades — `content-type: text/plain` evita preflight para requests GET simples; para uploads de base64 se usa POST con `application/json` y `e.postData.contents` se parsea manualmente.
- **SKU auto con fallback**: si el usuario quiere pasar su propio SKU (ej. código del proveedor), lo respeta; si no, genera uno coherente con la taxonomía.

## Estado actual y próximos pasos

**Implementado (v2):**
- Todos los endpoints de arriba.
- App con 5 vistas (Stock, Productos, Zonas, Obras, Config) + 10 modales.
- Sube de fotos desde la app + sincronización desde Drive.
- Generación de QR por producto.
- Consumo por obra interactivo (histórico, totales, reservas vigentes).
- Alertas de stock bajo.
- Links a Google Maps para zonas y obras.
- Reservas y liberación de reservas.

**Pendiente / roadmap:**
1. **Publicación en servidor propio** — mover `04_App_Stock.html` a un hosting (Netlify / Vercel / VPS).
2. **Autenticación real** — migrar del token compartido a Google Identity Services (login con Google) + permisos por rol (admin, operador, solo lectura).
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
3. El código vive en dos archivos: `03_AppsScript_API.gs` (~400 líneas, backend) y `04_App_Stock.html` (~700 líneas, frontend). Ambos comentados en castellano.
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
