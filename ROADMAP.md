# ROADMAP — Inventario Obras

Pendientes ordenados por impacto ÷ esfuerzo. Actualizado: 2026-04-22.

## ✅ Quick wins (hechos)

- **Toast notifications flotantes** — reemplaza los `alert-ok` inline que se cierran al cerrar el modal.
- **Undo de 5 segundos** — después de cada movimiento, botón "Deshacer" en el toast que emite el movimiento inverso.
- **Haptic feedback** — vibración sutil en éxito (30ms) y error (patrón 50-50-50) usando `navigator.vibrate`.
- **Últimos usados** — los 3 últimos SKU/obra/zona elegidos aparecen arriba del dropdown en la sesión actual.

## 🎯 Features gordas (próximas — fin de semana de laburo c/u)

### Dashboard home
Reemplazar la tab "Stock" default con un panel de insights:
- Alertas activas (bajo stock) con link directo al producto.
- Movimientos del día agrupados por tipo.
- Top 5 SKUs por actividad semanal.
- Obras con más stock asignado (reservas + en curso).

### Scanner de QR/barcode integrado
Hoy el QR abre un link externo (`infoProducto`). Si lo escaneás desde DENTRO de la app:
- Usar `BarcodeDetector` (nativo en Samsung Internet/Chrome Android) con fallback a `ZXing-js` para iOS/Safari.
- Botón "📷 Escanear" en el header o en el FAB que abre la cámara.
- Detectar SKU → llevar al detalle del producto con el form de movimiento pre-abierto.
- Reduce el flujo de 6 pasos a 2.

### Historial auditable
Pestaña "Movimientos" (hoy no existe en el frontend, solo en el Sheet) con:
- Filtros por SKU / zona / obra / usuario / rango de fechas.
- Timeline vertical con cards por movimiento (tipo, cantidad, fecha, usuario, notas).
- Botón "Anular" en cada card que emite el movimiento inverso (respetando convención del CLAUDE.md).
- Búsqueda de texto libre en notas/motivos.

### Offline queue
Aprovechar el service worker existente para write operations:
- Interceptar `POST` cuando no hay internet y encolar en IndexedDB.
- Reintentar con backoff exponencial cuando vuelve la conexión.
- Indicador visual de "movimientos pendientes de sincronizar" en el header.
- Crítico para galpones con mala señal.

## 🏆 Nivel AAA (2–3 días cada uno)

### Bulk actions con multi-select
- Tap largo sobre un producto en la lista → entra en modo selección.
- Tocar varios → barra inferior con acciones "Traslado / Egreso / Reserva" para todos.
- Un solo Traslado mueve los 5 SKUs de una vez (varios movimientos en backend, UX unificada).

### Sugerencias automáticas de reposición
- Cuando un SKU cruza el mínimo, calcular cantidad a pedir:
  - Consumo promedio de las últimas 4 semanas × (lead time + buffer).
- Botón "Pedir al proveedor" que genera link `wa.me/…` con mensaje pre-armado.
- Requiere columna `Proveedor` y `Telefono_Proveedor` en la hoja Productos.

## 💎 Ideas extra (backlog)

- **Dark mode** — switch en el header, guardar preferencia en localStorage.
- **Pull-to-refresh** en las listas de stock.
- **Export PDF** de reporte por obra (período + consumo + stock asignado).
- **Gráfico de evolución** de stock por producto (últimos 30 días) con Chart.js.
- **PIN más robusto** — hash SHA-256 en vez de texto plano en la hoja Usuarios.
- **Plantillas de pedido** — set de SKUs + cantidades reutilizable para obras recurrentes.
- **Badge con alertas** en el icono de la PWA (stock bajo, reservas vencidas).
- **Gestión de usuarios desde la app** — alta/baja/cambio de PIN sin tocar la hoja.
- **Permisos por rol** — admin (todo) vs operario (solo carga movimientos).

## Notas de arquitectura

- **No agregar frameworks sin justificación**. Todo sigue siendo HTML + JS vanilla, archivo único.
- **Anular siempre con movimiento inverso** — nunca borrar filas de Movimientos.
- **Enum de tipos cerrado**: `Ingreso | Traslado | Egreso | Ajuste | Reserva | Libera_Reserva`. Cambios requieren actualizar validaciones en `.gs` y fórmulas en `.xlsx`.
- **Backend es idempotente por ID de movimiento** — si se reintenta, no duplica (pendiente de implementar para offline queue).
