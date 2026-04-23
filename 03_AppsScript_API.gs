/**
 * Sistema de Stock Centralizado — API Backend v3
 *
 * CÓMO CONFIGURAR (primera vez):
 *   1. Extensiones → Apps Script en tu Google Sheet.
 *   2. Borrar Código.gs, pegar TODO este archivo.
 *   3. Editar las DOS constantes de abajo:
 *        - API_TOKEN: tu contraseña para la API.
 *        - DRIVE_ROOT_FOLDER_ID: ID de una carpeta en Drive donde van a
 *          vivir las subcarpetas "Fotos" y "QRs" (una por categoría).
 *          Para obtener el ID: abrí la carpeta en Drive y copialo de la URL
 *          (la parte después de /folders/).
 *   4. Guardar, Implementar → Nueva implementación → Aplicación web.
 *   5. Autorizar permisos (la primera vez pide Drive además de Sheets).
 *   6. Copiar la URL /exec y pegarla en la app HTML.
 *
 * Endpoints (action):
 *   GET/POST (requieren token):
 *     - getProducts, getZones, getObras, getCategorias
 *     - getStock, getMovimientos, getAlertas
 *     - getMovimientosObra (param: obra)
 *     - addMovimiento (ver campos abajo)
 *     - addProducto (SKU autogenerado si se omite)
 *     - addObra (código auto-secuencial OBRA-001, OBRA-002, ...)
 *     - addZona
 *     - uploadFoto (base64 → Drive → actualiza Foto_URL del producto)
 *     - generarQR (crea QR y lo guarda en Drive/QRs/{Categoria}/)
 *     - sincronizarFotos (recorre la carpeta Fotos y matchea por SKU en nombre)
 *
 *   GET públicos (sin token):
 *     - infoProducto (param: sku)  → HTML público con info + stock, destino del QR
 */

// ============== CONFIGURACIÓN — EDITAR ==============
const API_TOKEN = 'el_inventario_123_de_Eze';   // <-- TU TOKEN (mismo que en el HTML)
const DRIVE_ROOT_FOLDER_ID = '1BkCQXA_6ealpBh_pu6ODbYYFxZLdvWH3';  // <-- carpeta "Stock Galpones"

// Usuarios de la app (PIN numérico). Para agregar uno nuevo, copiá un objeto y cambiá los valores.
// La lista la consume el HTML a través del endpoint getUsuarios (devuelve sólo user+nombre, sin PINs).
const USUARIOS = [
  { user: 'Ezecorbe', pin: '2525', nombre: 'Eze' },
  // { user: 'Juan',     pin: '1234', nombre: 'Juan Pérez' },
];
// ====================================================

const SHEET_PRODUCTOS = 'Productos';
const SHEET_ZONAS = 'Zonas';
const SHEET_OBRAS = 'Obras';
const SHEET_CATEGORIAS = 'Categorias';
const SHEET_MOVIMIENTOS = 'Movimientos';
const SHEET_STOCK = 'Stock_Actual';

function doGet(e) {
  const action = (e.parameter || {}).action;
  if (action === 'infoProducto') return servirInfoProductoHTML(e.parameter.sku || '');
  return handle(e);
}

function doPost(e) { return handle(e); }

function handle(e) {
  try {
    const params = e.parameter || {};
    // postData (para subir archivos grandes como base64).
    // Mandamos el body como text/plain para evitar el preflight CORS,
    // así que intentamos parsear JSON siempre que el contents arranque con '{'.
    if (e.postData && e.postData.contents) {
      const raw = String(e.postData.contents).trim();
      if (raw.charAt(0) === '{') {
        try { Object.assign(params, JSON.parse(raw)); } catch (_) {}
      }
    }
    if (params.token !== API_TOKEN) return json({ ok: false, error: 'Token inválido' });

    const action = params.action;
    let result;
    switch (action) {
      case 'getUsuarios':        result = getUsuarios(); break;
      case 'login':              result = login(params); break;
      case 'getProducts':        result = getProducts(); break;
      case 'getZones':           result = getZones(); break;
      case 'getObras':           result = getObras(); break;
      case 'getCategorias':      result = getCategorias(); break;
      case 'getStock':           result = getStock(); break;
      case 'getMovimientos':     result = getMovimientos(parseInt(params.limit || '100')); break;
      case 'getMovimientosObra': result = getMovimientosObra(params.obra); break;
      case 'getReservasDetalle': result = getReservasDetalle(); break;
      case 'getAlertas':         result = getAlertas(); break;
      case 'addMovimiento':      result = addMovimiento(params); break;
      case 'addProducto':        result = addProducto(params); break;
      case 'addObra':            result = addObra(params); break;
      case 'addZona':            result = addZona(params); break;
      case 'uploadFoto':         result = uploadFoto(params); break;
      case 'generarQR':          result = generarQR(params); break;
      case 'sincronizarFotos':   result = sincronizarFotos(); break;
      default: return json({ ok: false, error: 'Acción desconocida: ' + action });
    }
    return json({ ok: true, data: result });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheet(name) {
  const s = SpreadsheetApp.getActive().getSheetByName(name);
  if (!s) throw new Error('Hoja no encontrada: ' + name);
  return s;
}

function sheetData(name) {
  const s = sheet(name);
  const values = s.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(r => r[0] !== '' && r[0] !== null).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

// ============== USUARIOS / LOGIN ==============

function getUsuarios() {
  // No exponemos los PINs — sólo el user y el nombre.
  return USUARIOS.map(u => ({ user: u.user, nombre: u.nombre }));
}

function login(params) {
  const user = (params.user || '').toString().trim();
  const pin  = (params.pin  || '').toString().trim();
  if (!user) throw new Error('Falta usuario');
  if (!pin)  throw new Error('Falta PIN');
  const u = USUARIOS.find(x => x.user.toLowerCase() === user.toLowerCase());
  if (!u) throw new Error('Usuario no encontrado');
  if (String(u.pin) !== pin) throw new Error('PIN incorrecto');
  return { user: u.user, nombre: u.nombre };
}

// ============== LECTURA ==============

function getProducts()   { return sheetData(SHEET_PRODUCTOS).filter(p => p.Activo !== 'No'); }
function getZones()      { return sheetData(SHEET_ZONAS).filter(z => z.Activo !== 'No'); }
function getObras()      { return sheetData(SHEET_OBRAS); }
function getCategorias() { return sheetData(SHEET_CATEGORIAS); }

function getStock() {
  const s = sheet(SHEET_STOCK);
  const values = s.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(r => r[0] !== '' && r[0] !== null).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function getMovimientos(limit) {
  const data = sheetData(SHEET_MOVIMIENTOS);
  data.reverse();
  return limit ? data.slice(0, limit) : data;
}

// Reservas netas agrupadas por SKU + Zona_Origen + Obra.
// Devuelve sólo las combinaciones con cantidad > 0 (o sea, que siguen vigentes).
// El frontend usa esto para que, al Liberar, solo aparezcan los galpones y
// obras donde realmente hay algo reservado del producto elegido.
function getReservasDetalle() {
  const all = sheetData(SHEET_MOVIMIENTOS);
  const map = {};
  all.forEach(m => {
    if (m.Tipo !== 'Reserva' && m.Tipo !== 'Libera_Reserva') return;
    const sku = m.SKU;
    const zona = m.Zona_Origen || m.Zona_Destino || '';
    const obra = m.Obra || '';
    if (!sku || !zona || !obra) return;
    const key = sku + '||' + zona + '||' + obra;
    if (!map[key]) map[key] = { SKU: sku, Zona: zona, Obra: obra, Cantidad: 0 };
    const c = Number(m.Cantidad || 0);
    if (m.Tipo === 'Reserva') map[key].Cantidad += c;
    else map[key].Cantidad -= c;
  });
  return Object.values(map).filter(x => x.Cantidad > 0);
}

function getMovimientosObra(obra) {
  if (!obra) throw new Error('Falta parámetro obra');
  const all = sheetData(SHEET_MOVIMIENTOS);
  const movs = all.filter(m => m.Obra === obra);

  // Consumo efectivo (Egresos)
  const consumo = {};
  movs.forEach(m => {
    if (m.Tipo === 'Egreso') {
      consumo[m.SKU] = consumo[m.SKU] || { sku: m.SKU, cantidad: 0, unidad: '', nombre: '' };
      consumo[m.SKU].cantidad += Number(m.Cantidad || 0);
    }
  });

  const productos = getProducts();
  Object.values(consumo).forEach(c => {
    const p = productos.find(pp => pp.SKU === c.sku);
    if (p) { c.nombre = p.Nombre; c.unidad = p.Unidad; }
  });

  // Reservas netas
  const reservas = {};
  movs.forEach(m => {
    if (m.Tipo === 'Reserva') {
      reservas[m.SKU] = reservas[m.SKU] || { sku: m.SKU, cantidad: 0, unidad: '', nombre: '' };
      reservas[m.SKU].cantidad += Number(m.Cantidad || 0);
    }
    if (m.Tipo === 'Libera_Reserva') {
      reservas[m.SKU] = reservas[m.SKU] || { sku: m.SKU, cantidad: 0, unidad: '', nombre: '' };
      reservas[m.SKU].cantidad -= Number(m.Cantidad || 0);
    }
  });
  Object.values(reservas).forEach(r => {
    const p = productos.find(pp => pp.SKU === r.sku);
    if (p) { r.nombre = p.Nombre; r.unidad = p.Unidad; }
  });

  movs.reverse();

  return {
    movimientos: movs,
    consumo: Object.values(consumo).sort((a,b) => b.cantidad - a.cantidad),
    reservas: Object.values(reservas).filter(r => r.cantidad > 0),
  };
}

function getAlertas() {
  const stock = getStock();
  return stock.filter(r => r.Alerta === 'BAJO STOCK');
}

// ============== ESCRITURA: Movimientos ==============

function addMovimiento(params) {
  const tipo = (params.tipo || '').trim();
  const sku = (params.sku || '').trim();
  const cantidad = parseFloat(params.cantidad || '0');
  const zonaOrigen = (params.zonaOrigen || '').trim();
  const zonaDestino = (params.zonaDestino || '').trim();
  const obra = (params.obra || '').trim();
  const motivo = (params.motivo || '').trim();
  const usuario = (params.usuario || '').trim();
  const notas = (params.notas || '').trim();

  if (!tipo) throw new Error('Falta tipo de movimiento');
  if (!sku) throw new Error('Falta SKU');
  if (!cantidad || isNaN(cantidad)) throw new Error('Cantidad inválida');

  const tiposValidos = ['Ingreso','Traslado','Egreso','Ajuste','Reserva','Libera_Reserva'];
  if (tiposValidos.indexOf(tipo) === -1) throw new Error('Tipo inválido: ' + tipo);

  if (tipo === 'Ingreso' && !zonaDestino) throw new Error('Ingreso requiere Zona_Destino');
  if (tipo === 'Traslado' && (!zonaOrigen || !zonaDestino)) throw new Error('Traslado requiere Zona_Origen y Zona_Destino');
  if (tipo === 'Egreso' && (!zonaOrigen || !obra)) throw new Error('Egreso requiere Zona_Origen y Obra');
  if (tipo === 'Ajuste' && (!zonaOrigen || !motivo)) throw new Error('Ajuste requiere Zona_Origen y Motivo');
  if ((tipo === 'Reserva' || tipo === 'Libera_Reserva') && (!zonaOrigen || !obra))
    throw new Error(tipo + ' requiere Zona_Origen y Obra');

  if (tipo === 'Traslado' || tipo === 'Egreso') {
    const stockZona = getStockEnZona(sku, zonaOrigen);
    if (stockZona < cantidad) {
      throw new Error(`Stock insuficiente en ${zonaOrigen}. Disponible: ${stockZona}, solicitado: ${cantidad}`);
    }
  }

  const id = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss') + '-' + Math.floor(Math.random()*1000);
  const fecha = new Date();
  const row = [id, fecha, tipo, sku, cantidad, zonaOrigen, zonaDestino, obra, motivo, usuario, notas];
  sheet(SHEET_MOVIMIENTOS).appendRow(row);
  SpreadsheetApp.flush();
  return { id };
}

function getStockEnZona(sku, zona) {
  const stock = getStock();
  const row = stock.find(r => r.SKU === sku);
  if (!row) return 0;
  return parseFloat(row[zona] || 0);
}

// ============== ESCRITURA: Productos ==============

function abreviar(texto, n) {
  if (!texto) return '';
  return texto.toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .substring(0, n);
}

function generarSKUAuto(categoria, subcategoria) {
  const cat = abreviar(categoria, 3) || 'VAR';
  const sub = abreviar(subcategoria, 3) || 'GEN';
  const prefix = `${cat}-${sub}-`;
  const s = sheet(SHEET_PRODUCTOS);
  const last = s.getLastRow();
  if (last < 2) return prefix + '001';
  const skus = s.getRange(2, 1, last-1, 1).getValues().flat().filter(x => x);
  let maxNum = 0;
  skus.forEach(sk => {
    const str = sk.toString();
    if (str.startsWith(prefix)) {
      const m = str.match(/\-(\d+)$/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
    }
  });
  return prefix + String(maxNum + 1).padStart(3, '0');
}

function addProducto(params) {
  let sku = (params.sku || '').trim();
  const nombre = (params.nombre || '').trim();
  const categoria = (params.categoria || '').trim();
  const subcategoria = (params.subcategoria || '').trim();
  const unidad = (params.unidad || '').trim();
  const fotoUrl = (params.fotoUrl || '').trim();
  const stockMinimo = parseFloat(params.stockMinimo || '0');
  const notas = (params.notas || '').trim();
  const unidadPack = (params.unidadPack || '').trim();
  const cantidadPackRaw = params.cantidadPack;
  const cantidadPack = cantidadPackRaw === '' || cantidadPackRaw === undefined || cantidadPackRaw === null
    ? ''
    : parseFloat(cantidadPackRaw);

  if (!nombre) throw new Error('Falta nombre');
  if (!categoria) throw new Error('Falta categoría');
  if (unidadPack && (cantidadPack === '' || isNaN(cantidadPack) || cantidadPack <= 0)) {
    throw new Error('Si ponés Unidad_Pack, la Cantidad_Por_Pack tiene que ser un número mayor a 0');
  }

  if (!sku) sku = generarSKUAuto(categoria, subcategoria);

  const s = sheet(SHEET_PRODUCTOS);
  const last = s.getLastRow();
  if (last >= 2) {
    const skus = s.getRange(2, 1, last-1, 1).getValues().flat();
    if (skus.indexOf(sku) !== -1) throw new Error('SKU ya existe: ' + sku);
  }
  // Columnas: A SKU | B Nombre | C Categoria | D Subcategoria | E Unidad | F Foto_URL | G Stock_Minimo_Total | H Notas | I Activo | J Unidad_Pack | K Cantidad_Por_Pack | L QR_URL
  s.appendRow([sku, nombre, categoria, subcategoria, unidad, fotoUrl, stockMinimo, notas, 'Sí', unidadPack, cantidadPack, '']);
  SpreadsheetApp.flush();
  return { sku };
}

function addObra(params) {
  const nombre      = (params.nombre      || '').trim();
  const direccion   = (params.direccion   || '').trim();
  const ubicacion   = (params.ubicacion   || '').trim();
  const notas       = (params.notas       || '').trim();
  const autorizante = (params.autorizante || '').trim();
  const responsable = (params.responsable || '').trim();

  if (!nombre)      throw new Error('Falta nombre de obra');
  if (!autorizante) throw new Error('Falta autorizante (obligatorio)');

  const s = sheet(SHEET_OBRAS);
  const last = s.getLastRow();

  // Código secuencial OBRA-001, OBRA-002, ...
  let maxNum = 0;
  if (last >= 2) {
    const codes = s.getRange(2, 1, last-1, 1).getValues().flat();
    codes.forEach(c => {
      const m = String(c || '').match(/^OBRA-(\d+)$/i);
      if (m) { const n = parseInt(m[1], 10); if (n > maxNum) maxNum = n; }
    });
  }
  const codigo = 'OBRA-' + String(maxNum + 1).padStart(3, '0');

  // Columnas: A Codigo | B Nombre | C Direccion | D Estado | E Fecha_Inicio | F Notas | G Ubicacion | H Autorizante | I Responsable_Obra
  s.appendRow([codigo, nombre, direccion, 'Activa', new Date(), notas, ubicacion, autorizante, responsable]);
  SpreadsheetApp.flush();
  return { codigo };
}

function addZona(params) {
  const codigo      = (params.codigo      || '').trim();
  const nombre      = (params.nombre      || '').trim();
  const descripcion = (params.descripcion || '').trim();
  const ubicacion   = (params.ubicacion   || '').trim();

  if (!codigo) throw new Error('Falta código de zona');
  if (!nombre) throw new Error('Falta nombre');

  const s = sheet(SHEET_ZONAS);
  const last = s.getLastRow();
  if (last >= 2) {
    const codes = s.getRange(2, 1, last-1, 1).getValues().flat().map(c => String(c).toUpperCase());
    if (codes.indexOf(codigo.toUpperCase()) !== -1) throw new Error('Código de zona ya existe: ' + codigo);
  }
  // Columnas: A Codigo | B Nombre | C Descripcion | D Activo | E Ubicacion
  s.appendRow([codigo.toUpperCase(), nombre, descripcion, 'Sí', ubicacion]);
  SpreadsheetApp.flush();
  return { codigo: codigo.toUpperCase() };
}

// ============== DRIVE: Fotos + QRs ==============

function ensureDriveRoot() {
  if (!DRIVE_ROOT_FOLDER_ID || DRIVE_ROOT_FOLDER_ID === 'PEGAR_ID_CARPETA_DRIVE_ACA') {
    throw new Error('Configurá DRIVE_ROOT_FOLDER_ID en el Apps Script');
  }
  try {
    return DriveApp.getFolderById(DRIVE_ROOT_FOLDER_ID);
  } catch (err) {
    throw new Error(
      'No pude abrir la carpeta de Drive con ID "' + DRIVE_ROOT_FOLDER_ID + '". ' +
      'Revisá: 1) que la carpeta exista y no esté en papelera; ' +
      '2) que sea de la misma cuenta Google con la que editás este Apps Script; ' +
      '3) que el ID esté bien pegado (parte de la URL después de /folders/). ' +
      'Tip: ejecutá la función crearCarpetaStockGalpones() para crear una automáticamente y obtener el ID. ' +
      'Error original de Drive: ' + err.message
    );
  }
}

// Helper manual: ejecutá esta función desde el editor de Apps Script si
// nunca creaste la carpeta raíz o perdiste el ID. Crea "Stock Galpones"
// en tu Drive, la comparte con "cualquiera con el link (Lector)" y te
// loguea el ID para que lo pegues en DRIVE_ROOT_FOLDER_ID.
function crearCarpetaStockGalpones() {
  // Si ya existe una carpeta con ese nombre en la raíz, la reutilizo.
  const nombre = 'Stock Galpones';
  const existing = DriveApp.getRootFolder().getFoldersByName(nombre);
  let folder;
  if (existing.hasNext()) {
    folder = existing.next();
    Logger.log('Ya existía una carpeta llamada "' + nombre + '". Reutilizando.');
  } else {
    folder = DriveApp.createFolder(nombre);
    Logger.log('Carpeta creada: ' + nombre);
  }
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const id = folder.getId();
  Logger.log('=====================================================');
  Logger.log('ID de la carpeta: ' + id);
  Logger.log('URL: ' + folder.getUrl());
  Logger.log('Pegá este ID arriba en: const DRIVE_ROOT_FOLDER_ID = \'' + id + '\';');
  Logger.log('Después guardá e Implementá → Versión nueva.');
  Logger.log('=====================================================');
  return id;
}

function ensureFolder(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

function sanitizeFileName(name) {
  return (name || '').toString()
    .replace(/[\/\\?%*:|"<>]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
}

function uploadFoto(params) {
  const sku = (params.sku || '').trim();
  const nombre = (params.nombre || '').trim();
  const categoria = (params.categoria || 'Varios').trim();
  const base64 = params.base64 || '';
  const mimeType = params.mimeType || 'image/jpeg';
  if (!sku) throw new Error('Falta SKU');
  if (!base64) throw new Error('Falta imagen');

  const root = ensureDriveRoot();
  const fotos = ensureFolder(root, 'Fotos');
  const cat = ensureFolder(fotos, categoria || 'Varios');

  const ext = (mimeType.split('/')[1] || 'jpg').replace('jpeg','jpg');
  const fileName = `${sku}_${sanitizeFileName(nombre)}.${ext}`;

  const existing = cat.getFilesByName(fileName);
  while (existing.hasNext()) existing.next().setTrashed(true);

  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, fileName);
  const file = cat.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const url = `https://drive.google.com/uc?export=view&id=${file.getId()}`;
  updateProductoFotoURL(sku, url);
  return { url, fileId: file.getId() };
}

function updateProductoFotoURL(sku, url) {
  const s = sheet(SHEET_PRODUCTOS);
  const last = s.getLastRow();
  if (last < 2) return;
  const skus = s.getRange(2, 1, last-1, 1).getValues();
  for (let i = 0; i < skus.length; i++) {
    if (skus[i][0] === sku) {
      s.getRange(i+2, 6).setValue(url);  // columna F = Foto_URL
      SpreadsheetApp.flush();
      return;
    }
  }
}

// NOTA: esta versión NO usa UrlFetchApp.fetch (que requiere el permiso
// external_request y rompía al llamar desde el script). El HTML genera
// el PNG contra api.qrserver.com directamente desde el navegador y lo
// manda acá en base64, igual que uploadFoto. Así el Apps Script sólo
// necesita permisos de Drive/Sheets.
function generarQR(params) {
  const sku = (params.sku || '').trim();
  const nombre = (params.nombre || '').trim();
  const categoria = (params.categoria || 'Varios').trim();
  const base64 = params.base64 || '';
  if (!sku) throw new Error('Falta SKU');
  if (!base64) throw new Error('Falta imagen del QR (base64)');

  const scriptUrl = ScriptApp.getService().getUrl();
  const qrData = `${scriptUrl}?action=infoProducto&sku=${encodeURIComponent(sku)}`;

  const root = ensureDriveRoot();
  const qrs = ensureFolder(root, 'QRs');
  const cat = ensureFolder(qrs, categoria || 'Varios');

  const fileName = `${sku}_${sanitizeFileName(nombre)}_QR.png`;
  const existing = cat.getFilesByName(fileName);
  while (existing.hasNext()) existing.next().setTrashed(true);

  const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/png', fileName);
  const file = cat.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const url = `https://drive.google.com/uc?export=view&id=${file.getId()}`;
  updateProductoQRURL(sku, url);
  return { url, qrData, fileId: file.getId() };
}

// Actualiza la columna L (12) = QR_URL en la hoja Productos.
// Si la columna todavía no existe, la crea con el encabezado "QR_URL".
function updateProductoQRURL(sku, url) {
  const s = sheet(SHEET_PRODUCTOS);
  const last = s.getLastRow();
  if (last < 2) return;
  // Asegurar encabezado QR_URL en columna 12
  const headers = s.getRange(1, 1, 1, Math.max(12, s.getLastColumn())).getValues()[0];
  if ((headers[11] || '') !== 'QR_URL') {
    s.getRange(1, 12).setValue('QR_URL');
  }
  const skus = s.getRange(2, 1, last-1, 1).getValues();
  for (let i = 0; i < skus.length; i++) {
    if (skus[i][0] === sku) {
      s.getRange(i+2, 12).setValue(url);  // columna L = QR_URL
      SpreadsheetApp.flush();
      return;
    }
  }
}

function sincronizarFotos() {
  const root = ensureDriveRoot();
  const fotos = ensureFolder(root, 'Fotos');
  const productos = getProducts();
  const skus = productos.map(p => p.SKU);
  let actualizados = 0;

  const cats = fotos.getFolders();
  while (cats.hasNext()) {
    const catFolder = cats.next();
    const files = catFolder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      const name = f.getName();
      const match = name.match(/^([A-Z0-9\-]+)[_\.]/);
      if (!match) continue;
      const skuEnArchivo = match[1];
      if (skus.indexOf(skuEnArchivo) !== -1) {
        f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        const url = `https://drive.google.com/uc?export=view&id=${f.getId()}`;
        updateProductoFotoURL(skuEnArchivo, url);
        actualizados++;
      }
    }
  }
  return { actualizados };
}

// ============== VISTA PÚBLICA (destino del QR) ==============

function servirInfoProductoHTML(sku) {
  sku = (sku || '').trim();
  if (!sku) return HtmlService.createHtmlOutput('<h1>Falta SKU</h1>');

  const p = getProducts().find(pp => pp.SKU === sku);
  const stock = getStock().find(s => s.SKU === sku);

  if (!p) {
    return HtmlService.createHtmlOutput(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
      `<body style="font-family:-apple-system,sans-serif;padding:40px;text-align:center;">` +
      `<h1 style="color:#C0392B">Producto no encontrado</h1><p>SKU: ${sku}</p></body></html>`);
  }

  const zonas = getZones();
  const zonasRows = zonas.map(z => {
    const v = stock ? Number(stock[z.Codigo] || 0) : 0;
    return `<tr><td>${z.Nombre}</td><td style="text-align:right;font-weight:600">${v}</td></tr>`;
  }).join('');

  const total     = stock ? Number(stock.Total_Fisico || 0) : 0;
  const reservado = stock ? Number(stock.Reservado || 0) : 0;
  const disponible= stock ? Number(stock.Disponible || 0) : 0;
  const minimo    = stock ? Number(stock.Minimo || 0) : 0;
  const alerta    = stock && stock.Alerta === 'BAJO STOCK';
  const foto      = p.Foto_URL || '';

  const html = `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${p.Nombre} · ${p.SKU}</title>
<style>
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; margin:0; padding:0; background:#F4F6F9; color:#222; }
  header { background:#1F4E78; color:#fff; padding:16px; text-align:center; }
  .wrap { max-width:500px; margin:0 auto; padding:16px; }
  .card { background:#fff; border-radius:12px; padding:16px; margin-bottom:12px; box-shadow:0 2px 6px rgba(0,0,0,.06); }
  h1 { margin:0 0 6px; font-size:20px; }
  .sub { color:#6B7280; font-size:13px; }
  img { width:100%; max-height:280px; object-fit:cover; border-radius:10px; display:block; margin-top:10px; }
  table { width:100%; border-collapse:collapse; margin-top:10px; font-size:15px; }
  td { padding:10px 6px; border-bottom:1px solid #E3E7ED; }
  .big { font-size:36px; font-weight:700; color:#1F4E78; text-align:center; margin:10px 0 0; }
  .mid { text-align:center; color:#6B7280; font-size:13px; }
  .warn { background:#FDE8E6; color:#9C0006; padding:8px 12px; border-radius:8px; font-weight:600; text-align:center; margin-top:10px; }
  .ok   { background:#D5F5E3; color:#1E8449; padding:8px 12px; border-radius:8px; font-weight:600; text-align:center; margin-top:10px; }
</style></head>
<body>
<header><strong>📦 Stock · Galpones</strong></header>
<div class="wrap">
  <div class="card">
    <h1>${p.Nombre}</h1>
    <div class="sub">${p.SKU} · ${p.Categoria || ''} · ${p.Subcategoria || ''}</div>
    ${foto ? `<img src="${foto}" alt="">` : ''}
  </div>
  <div class="card">
    <div class="big">${disponible}</div>
    <div class="mid">${p.Unidad || ''} disponibles</div>
    ${alerta ? '<div class="warn">⚠️ Bajo stock mínimo</div>' : (total > 0 ? '<div class="ok">Stock OK</div>' : '')}
  </div>
  <div class="card">
    <strong>Por galpón</strong>
    <table>${zonasRows}</table>
    <table style="margin-top:12px">
      <tr><td>Total físico</td><td style="text-align:right;font-weight:600">${total}</td></tr>
      <tr><td>Reservado</td><td style="text-align:right">${reservado}</td></tr>
      <tr><td>Mínimo</td><td style="text-align:right">${minimo}</td></tr>
    </table>
  </div>
</div>
</body></html>`;

  return HtmlService.createHtmlOutput(html)
    .setTitle(p.Nombre + ' · Stock')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
