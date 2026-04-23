# Guía de Implementación — Sistema de Stock v4

Esta guía te lleva de los archivos a tener la app funcionando en el celular. Calculá **30-45 min** la primera vez.

> **Novedades v4:** login por usuario + PIN (tipo desbloqueo de celu), URL y token hardcodeados en el HTML (se fue la vista de Configuración), sesión persistida.
>
> **Novedades v3:** soporte de pallet/caja (carga por pack con cálculo automático), egreso masivo multi-producto con validación en tiempo real, fixes en detalle de producto (Reservar/Liberar/Foto/QR).

---

## Paso 1 — Drive: carpeta raíz + subcarpetas (5 min)

1. Entrá a [drive.google.com](https://drive.google.com).
2. Creá una carpeta **"Stock Galpones"** (o como quieras llamarla).
3. **Copiá el ID de la carpeta** desde la URL. Ej: si la URL es `https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnO`, el ID es `1AbCdEfGhIjKlMnO`. Lo vamos a pegar en el Apps Script.
4. Compartila con permiso "Cualquier persona con el enlace → Lector". Así las fotos y QRs que la app guarde adentro se pueden ver sin pedir login.

> No hace falta crear las subcarpetas "Fotos" y "QRs" a mano — el Apps Script las crea solas, y dentro de cada una va armando una por categoría.

## Paso 2 — Subir la plantilla al Sheets (3 min)

1. Subí `02_Plantilla_Stock.xlsx` a "Stock Galpones".
2. Clic derecho → **Abrir con → Hojas de cálculo de Google**.
3. **Archivo → Guardar como Hojas de cálculo de Google**.
4. Compartilo con los 2-5 usuarios del equipo (permiso de editor).

## Paso 3 — Instalar el Apps Script (10 min)

1. En el Sheet: **Extensiones → Apps Script**.
2. Borrá `Código.gs` y pegá todo el contenido de `03_AppsScript_API.gs`.
3. Editá las **tres constantes** al principio del archivo:
   ```js
   const API_TOKEN = 'tu_token_único';               // lo que vos quieras
   const DRIVE_ROOT_FOLDER_ID = 'el_ID_del_paso_1';  // del paso 1.3

   const USUARIOS = [
     { user: 'Ezecorbe', pin: '2525', nombre: 'Eze' },
     // agregá acá a cada persona del equipo — ver Paso 4
   ];
   ```
4. Guardá (disquete). Nombre del proyecto: "Stock API".
5. **Agregar el manifiesto `appsscript.json` con scopes explícitos** (evita el error "No tienes permiso para llamar a DriveApp"):
   - Engranaje de la izquierda → **"Configuración del proyecto"** → tildar **"Mostrar el archivo de manifiesto 'appsscript.json' en el editor"**.
   - Volvé al editor, abrí `appsscript.json` y pegá el contenido del archivo `appsscript.json` de este repo (incluye los scopes `/auth/drive` y `/auth/spreadsheets`, y define `executeAs: USER_DEPLOYING`).
6. **Forzar el diálogo de permisos**: en el selector de funciones elegí `ensureDriveRoot` → Ejecutar → aceptá **todos** los permisos que pida (Drive + Sheets + External request).
7. **Implementar → Nueva implementación → Aplicación web**:
   - Ejecutar como: **Yo** (no "Usuario que accede a la app" — sino el script corre sin tus permisos de Drive).
   - Quién tiene acceso: **Cualquier persona**.
8. Copiá la URL que termina en `/exec`.

> Si ya tenías la app desplegada y te tira "No tienes permiso para llamar a DriveApp.getFolderById", hacé los pasos 5 y 6 sobre el proyecto existente y después **Implementar → Administrar implementaciones → editar → Versión nueva → Implementar**. La URL se mantiene.

## Paso 4 — Dar de alta a los usuarios del equipo (2 min)

En el mismo `03_AppsScript_API.gs`, editá el array `USUARIOS`. Cada entrada tiene tres campos:

| Campo | Qué es |
|-------|--------|
| `user` | identificador único (sin espacios). Es el que aparece en el selector de login. |
| `pin` | 4 dígitos (string entre comillas simples). El que la persona va a tipear en el PIN pad. |
| `nombre` | nombre real para mostrar (va al chip del header y queda registrado en cada movimiento como "Usuario"). |

Ejemplo con un equipo de 3:
```js
const USUARIOS = [
  { user: 'Ezecorbe',  pin: '2525', nombre: 'Eze' },
  { user: 'JuanP',     pin: '1234', nombre: 'Juan Pérez' },
  { user: 'MartaR',    pin: '9988', nombre: 'Marta R.' },
];
```

Después de cambiar el array hay que **volver a desplegar**: Implementar → Gestionar implementaciones → editar (lápiz) → Nueva versión → Implementar. La URL `/exec` se mantiene.

**Para cambiar un PIN** o dar de baja a alguien: editás el array, redesplegás. Listo.

## Paso 5 — Pegar URL y token en el HTML (1 min)

Abrí `index.html` con cualquier editor de texto y al principio del `<script>` vas a ver:

```js
const API_URL   = 'https://script.google.com/.../exec';  // reemplazar
const API_TOKEN = 'el_inventario_123_de_Eze';            // reemplazar
```

- Pegá la URL del paso 3.7 en `API_URL`.
- Pegá el mismo token que pusiste en el `.gs` en `API_TOKEN`.
- Guardá el archivo.

## Paso 6 — Abrir la app y loguearte (1 min)

Doble clic en `index.html` o subila a tu servidor. Para usarla en el celu más cómodo: Chrome → menú → "Agregar a pantalla de inicio".

Al abrir:
1. Si hay más de un usuario, te muestra el selector → tocá tu avatar.
2. Te aparece el PIN pad → marcá los 4 dígitos.
3. Entra directo al Stock. La sesión queda guardada hasta que cierres la pestaña o toques **Salir**.

Si ponés el PIN mal, el PIN pad hace un shake rojo y se limpia. No hay bloqueo por intentos fallidos (es un sistema para equipo conocido, no público).

## Paso 7 — Carga inicial (20-30 min)

Desde el Sheet o desde la app:

1. **Zonas** — ya vienen los 5 galpones. Completá la columna **Ubicacion** con el link de Google Maps de cada galpón si lo tenés.
2. **Categorías** — ya vienen 30 pre-cargadas.
3. **Obras** — desde la app: pestaña Obras → **+ Nueva obra** (te pide nombre, dirección y link de Maps).
4. **Productos** — desde la app: pestaña Productos → **+ Nuevo**. Si dejás el SKU vacío, se genera automático (ej: `REV-POR-001` para Revestimientos/Porcelanato).
   - Si el producto viene por **pallet/caja/rollo**, tildá "Viene por pack / pallet / caja" y completá cuánto de la unidad de stock trae un pack. Ejemplo: porcelanato 60x120 que viene en pallets de 60 m² → Unidad = `m²`, Unidad pack = `pallet`, Cantidad por pack = `60`.
5. **Inventario inicial** — por cada producto × zona con stock, tocá **± Ajuste**, elegí el producto, poné cantidad positiva, zona, motivo "Inventario inicial".

## Paso 8 — Uso diario

- **Ingreso de mercadería** → botón `+ Ingreso`.
  - Si el producto tiene pack configurado, aparece un toggle **"Cargar por pallet/caja/..."** Al tildarlo, ponés cuántos packs recibiste (ej: `1`) y el sistema calcula solo el stock (ej: `1 × 60 = 60 m²`) y te lo muestra antes de guardar.
- **Mover entre galpones** → `↔ Traslado`. La lista sólo muestra productos con stock >0. Si pedís más de lo que hay, te avisa en el momento y bloquea el botón Guardar.
- **Retirar para una obra** → `→ Egreso` (modo masivo). Elegís la obra una sola vez, agregás tantas líneas como productos necesites (+ Agregar otro producto). Cada línea te muestra en qué galpón hay stock y cuánto, y te avisa si te pasás. Solo aparecen productos con stock disponible.
- **Rotura / error de conteo** → `± Ajuste`.
- **Alguien me pidió algo pero todavía no lo llevó** → abrí el producto → 📌 **Reservar**. Queda apartado para esa obra sin salir físicamente del galpón.
- **Se canceló la reserva** → abrí el producto → **Liberar**.

## Paso 9 — Fotos y QR

**Foto de un producto:**
1. Abrí el producto (tap en la tarjeta).
2. Botón **📷 Foto** → elegí imagen o sacá una con la cámara.
3. Se sube sola a Drive en `/Fotos/{Categoría}/{SKU}_{nombre}.jpg` y el link queda guardado automáticamente en la hoja Productos.

**QR de un producto:**
1. Abrí el producto.
2. Botón **🔗 QR** → se genera, queda guardado en Drive en `/QRs/{Categoría}/` y te muestra la imagen.
3. Imprimís el QR, lo pegás al producto/pallet. Cuando cualquiera lo escanea con el celu, se abre una página pública con la foto, la info y el stock actual (sin necesidad de login).

**Subida manual de fotos (alternativa):**
Si alguien subió fotos a Drive sin pasar por la app, asegurate que el nombre del archivo empiece con el SKU (ej: `REV-POR-001_cualquier_cosa.jpg`). Después desde el Apps Script editor corré la función `sincronizarFotos` una vez — te asocia todas.

## Troubleshooting

**"Token inválido"** → el token del HTML (`API_TOKEN`) no coincide con el del Apps Script.

**"Configurá DRIVE_ROOT_FOLDER_ID"** → te olvidaste de pegar el ID de la carpeta en el Apps Script.

**"Usuario no encontrado" al loguear** → ese `user` no existe en el array `USUARIOS` del `.gs`. Ojo: distingue el nombre de usuario pero no mayúsculas/minúsculas.

**"PIN incorrecto"** → el PIN no coincide con el del array `USUARIOS`. Revisá que los PINs estén entre comillas simples (como string, no como número).

**Agregué un usuario nuevo y no aparece en el login** → te falta **redesplegar** el Apps Script. Implementar → Gestionar implementaciones → editar → Nueva versión → Implementar.

**Cambié el PIN y sigue funcionando el viejo** → igual que el anterior: redesplegar el Apps Script.

**No me quiero loguear cada vez** → la sesión queda guardada en `sessionStorage` — mientras no cierres la pestaña del navegador no te vuelve a pedir PIN. Si querés que quede por más tiempo, agregá la app a la pantalla de inicio del celu (Chrome → menú → "Agregar a pantalla de inicio").

**La foto no se ve** → la carpeta raíz tiene que estar compartida como "Cualquier persona con el enlace → Lector".

**"Stock insuficiente"** → la API valida antes de sacar. Revisá cuánto hay en origen.

**Quiero anular un movimiento** → no borres filas. Cargá un movimiento inverso.

**El producto viene en pallets pero en stock lo mido en m²** → en el alta del producto tildá "Viene por pack", poné Unidad_Pack = `pallet` y Cantidad_Por_Pack = cuántos m² trae un pallet (ej: `60`). Al hacer ingreso, tildás "Cargar por pallet" y ponés 1 → te suma 60 m².

**Al hacer egreso no veo el producto** → el listado de egreso filtra por stock >0. Si el producto no aparece es porque no hay unidades disponibles en ningún galpón. Revisá ingresos y ajustes.
