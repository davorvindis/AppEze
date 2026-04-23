# Sistema de Stock Centralizado — Documento de Diseño

**Proyecto:** Centralización de inventario multi-depósito para materiales de construcción
**Autor:** Eze
**Fecha:** Abril 2026
**Estado:** Fase 1 — Diseño e implementación inicial

---

## 1. Objetivo

Unificar en un solo sistema la información de stock de todas las zonas de almacenamiento (Tinglado, Galpón 1000, Galpón 710, Galpón 5000, Galpón 3, y futuras), con una app mobile-first que permita cargar movimientos fácilmente desde el celular y consultar stock en tiempo real.

## 2. Alcance

- Catálogo único de productos de construcción (porcelanato, climatización, sanitarios, grifería, etc.).
- Gestión de stock por zona (múltiples depósitos).
- Registro de movimientos: Ingresos, Traslados entre galpones, Egresos a obras propias, y Ajustes.
- Sistema de reservas (material asignado a obra pero no retirado).
- Alertas de stock bajo.
- Catálogo de obras con alta rápida.
- Fotos de productos alojadas en Google Drive.
- App web mobile-first; inicialmente local, luego publicada en servidor propio.
- 2 a 5 usuarios concurrentes.

## 3. Arquitectura

```
┌───────────────────────────┐
│   App HTML + JS (mobile)   │  ← Frontend (primero local, luego servidor)
└──────────────┬────────────┘
               │ HTTPS (fetch JSON)
┌──────────────▼─────────────┐
│   Google Apps Script API    │  ← Backend (gratuito, sin servidor)
│   (doGet / doPost)          │
└──────────────┬─────────────┘
               │
┌──────────────▼─────────────┐
│   Google Sheets (BBDD)      │  ← 6 hojas + fotos en Drive
└────────────────────────────┘
```

**Ventajas del stack:**

- Costo cero (todo dentro del ecosistema Google).
- Escalable a dar de baja fácil: si mañana crece, el frontend queda igual y solo se cambia el backend por Supabase/Postgres.
- Los usuarios no-técnicos pueden abrir el Sheet y ver/editar datos directamente si hace falta.

## 4. Modelo de datos (hojas del Sheet)

### 4.1 `Productos` — catálogo maestro

| Columna | Tipo | Ejemplo | Notas |
|---|---|---|---|
| SKU | texto único | PORC-0060 | Código interno; generado o manual |
| Nombre | texto | Porcelanato símil madera 20x120 | |
| Categoría | lista | Revestimientos | Validación con hoja Categorias |
| Subcategoría | lista | Porcelanato | |
| Unidad | lista | m² | m², u., kg, lt, ml |
| Foto_URL | URL | https://drive.google.com/... | Link público al Drive |
| Stock_Mínimo_Total | número | 100 | Alerta cuando total < mínimo |
| Notas | texto | | |
| Activo | sí/no | sí | Para dar de baja sin borrar |

### 4.2 `Zonas` — depósitos

| Columna | Tipo | Ejemplo |
|---|---|---|
| Código | texto único | G1000 |
| Nombre | texto | Galpón 1000 |
| Descripción | texto | Sector norte |
| Activo | sí/no | sí |

Valores iniciales: `TIN` (Tinglado), `G1000`, `G710`, `G5000`, `G3`.

### 4.3 `Categorias`

Lista maestra para que los desplegables sean consistentes. Estructura simple:

| Categoría | Subcategoría |
|---|---|
| Revestimientos | Porcelanato |
| Revestimientos | Cerámico |
| Climatización | Aire acondicionado split |
| Climatización | Aire acondicionado central |
| Sanitarios | Bañera |
| Sanitarios | Jacuzzi |
| Sanitarios | Ducha |
| Sanitarios | Inodoro |
| Grifería | Cocina |
| Grifería | Baño |
| Aberturas | Puerta |
| Aberturas | Ventana |
| Eléctricos | — |
| Pinturas | — |
| Varios | — |

### 4.4 `Obras` — destino de los egresos

| Columna | Tipo | Ejemplo |
|---|---|---|
| Código | texto único | OBR-024 |
| Nombre | texto | Edificio Belgrano |
| Dirección | texto | Av. Belgrano 1234 |
| Estado | lista | Activa / Finalizada |
| Fecha_Inicio | fecha | 2026-03-01 |
| Notas | texto | |

### 4.5 `Movimientos` — log de toda la actividad (FUENTE DE VERDAD)

| Columna | Tipo | Notas |
|---|---|---|
| ID | texto único | Generado por Apps Script (timestamp + random) |
| Fecha | fecha/hora | Timestamp automático |
| Tipo | lista | Ingreso / Traslado / Egreso / Ajuste / Reserva / Libera_Reserva |
| SKU | texto | Ref a Productos |
| Cantidad | número | Siempre positiva; el signo lo da el tipo |
| Zona_Origen | texto | Vacío para Ingreso |
| Zona_Destino | texto | Vacío para Egreso y Ajuste |
| Obra | texto | Requerido solo para Egresos y Reservas |
| Motivo_Ajuste | lista | Requerido solo para Ajustes: Rotura, Error conteo, Pérdida/robo, Inventario inicial |
| Usuario | texto | Nombre o email |
| Notas | texto | Libre |

**Regla clave:** el stock actual de cada producto en cada zona se calcula sumando/restando los movimientos. No se almacena.

### 4.6 `Stock_Actual` — vista calculada (cross-tab)

Calculada con fórmulas `SUMIFS` sobre `Movimientos`. Matriz producto × zona con totales por fila (stock total) y columna (total por galpón). Se agrega también una columna **Stock_Reservado** y **Stock_Disponible** (físico − reservado).

## 5. Tipos de movimiento (definitivos)

| Tipo | Zona_Origen | Zona_Destino | Obra | Efecto en stock |
|---|---|---|---|---|
| **Ingreso** | — | requerida | — | Suma en Destino |
| **Traslado** | requerida | requerida | — | Resta de Origen, suma en Destino |
| **Egreso** | requerida | — | requerida | Resta de Origen definitivamente |
| **Ajuste** | requerida | — | — | Suma o resta en Origen (con signo) |
| **Reserva** | requerida | — | requerida | No afecta stock físico, suma en reservado |
| **Libera_Reserva** | requerida | — | requerida | Libera la reserva (por cancelación) |

## 6. Pantallas de la app mobile

### 6.1 Home / Stock
- Barra de búsqueda por nombre o SKU.
- Filtros: Zona (todos / galpón X), Categoría, "Solo bajo mínimo".
- Tarjetas de producto: foto, nombre, stock total, desglose por zona (chips), badge rojo si bajo mínimo.
- Tap en una tarjeta → detalle del producto con histórico de movimientos.

### 6.2 Nuevo Ingreso
Formulario con: Producto (autocomplete) · Cantidad · Zona destino · Proveedor/Notas · Guardar.

### 6.3 Nuevo Traslado
Producto · Cantidad · Zona origen · Zona destino · Notas. Validación: cantidad ≤ stock en origen.

### 6.4 Nuevo Egreso (a obra)
Producto · Cantidad · Zona origen · **Obra** (desplegable + botón "+ Nueva obra") · Retira (persona) · Notas.

### 6.5 Nueva Reserva / Libera reserva
Igual que egreso pero no descuenta físico. Al momento del retiro real se convierte en egreso.

### 6.6 Ajuste de stock
Producto · Zona · Cantidad (con +/−) · Motivo (desplegable: Rotura, Error conteo, Pérdida/robo, Inventario inicial) · Notas.

### 6.7 Panel de alertas
Lista de productos bajo stock mínimo, ordenados por "cuán debajo del mínimo están".

### 6.8 Alta rápida de producto y de obra
Formularios simples accesibles desde los flujos de carga, para no frenar la operación.

## 7. Workflow inicial de carga (Fase 2)

1. Dar de alta las **Zonas** (5 galpones iniciales).
2. Dar de alta las **Categorías** (ya vienen pre-cargadas).
3. Dar de alta las **Obras** activas.
4. Cargar el **Catálogo de productos** con sus stocks mínimos.
5. Hacer un movimiento tipo **Ajuste / Inventario inicial** por cada producto × zona con el stock real contado.
6. A partir de ahí, solo se registran movimientos normales.

## 8. Seguridad y permisos

- El Sheet queda compartido con los 2-5 usuarios del equipo (solo los que cargan).
- El Apps Script web app se publica con "Cualquiera con el link" pero requiere un token simple en cada request (evita abuso sin complicar la UX).
- Fase 4 (cuando vaya al servidor propio): login real y permisos por rol (administrador, operador de galpón, solo lectura).

## 9. Roadmap por fases

| Fase | Qué incluye | Responsable |
|---|---|---|
| **1 — Estructura** | Plantilla Sheets + Apps Script + HTML prototipo | Este entregable |
| **2 — Carga inicial** | Zonas, categorías, obras, catálogo, stock inicial | Eze + equipo |
| **3 — Uso real (2 semanas)** | Operación diaria, detectar falencias | Equipo |
| **4 — Publicación** | Mover HTML a servidor propio, dominio, login | Eze (dev) |
| **5 — Mejoras** | Reportes mensuales, exportar a PDF, escaneo QR, app nativa si hace falta | A definir |

## 10. Entregables de la Fase 1

1. `02_Plantilla_Stock.xlsx` — plantilla lista para importar a Google Sheets.
2. `03_AppsScript_API.gs` — código del backend (pegar en Extensiones → Apps Script).
3. `index.html` — frontend mobile-first (sirve para local y para GitHub Pages / PWA).
4. `05_Guia_Implementacion.md` — paso a paso para poner todo en marcha.
