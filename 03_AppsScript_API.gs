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

// Parsea coordenadas en formato DMS (34°52'04.2"S 58°10'27.3"W) o decimal (-34.868, -58.174)
// Devuelve { lat, lng } o null.
function parsearCoordenadas(texto) {
  if (!texto) return null;
  var s = String(texto).trim();
  if (!s) return null;

  // Formato DMS: 34°52'04.2"S 58°10'27.3"W
  var dms = s.match(/(\d+)[°]\s*(\d+)[''′]\s*([\d.]+)[""″]?\s*([NSns])\s+(\d+)[°]\s*(\d+)[''′]\s*([\d.]+)[""″]?\s*([EWOewo])/);
  if (dms) {
    var lat = parseFloat(dms[1]) + parseFloat(dms[2]) / 60 + parseFloat(dms[3]) / 3600;
    var lng = parseFloat(dms[5]) + parseFloat(dms[6]) / 60 + parseFloat(dms[7]) / 3600;
    if (dms[4].toUpperCase() === 'S') lat = -lat;
    if (dms[8].toUpperCase() === 'W' || dms[8].toUpperCase() === 'O') lng = -lng;
    return { lat: lat, lng: lng };
  }

  // Formato decimal: -34.868, -58.174  o  -34.868 -58.174
  var dec = s.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/);
  if (dec) return { lat: parseFloat(dec[1]), lng: parseFloat(dec[2]) };

  return null;
}

function getProducts()   { return sheetData(SHEET_PRODUCTOS).filter(p => p.Activo !== 'No'); }

function getZones() {
  return sheetData(SHEET_ZONAS).filter(z => z.Activo !== 'No').map(z => {
    z._coords = parsearCoordenadas(z.Coordenadas);
    return z;
  });
}

function getObras() {
  return sheetData(SHEET_OBRAS).map(o => {
    o._coords = parsearCoordenadas(o.Coordenadas);
    return o;
  });
}
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
  const skuStr = String(sku);
  const row = stock.find(r => String(r.SKU) === skuStr);
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

// Función de diagnóstico: corre varios tests sobre Drive y te dice
// exactamente dónde falla. Mirá la salida con Ver → Registros.
function diagnosticoDrive() {
  const log = [];
  const push = (t) => { log.push(t); Logger.log(t); };

  push('========== DIAGNÓSTICO DRIVE ==========');

  // Test 1: cuenta efectiva
  try {
    const user = Session.getActiveUser().getEmail();
    push('1) Cuenta activa: ' + (user || '(vacío — probablemente sos un usuario externo al workspace del script)'));
    const effective = Session.getEffectiveUser().getEmail();
    push('   Cuenta efectiva (dueña del script): ' + effective);
  } catch (e) { push('1) ERROR leyendo cuenta: ' + e.message); }

  // Test 2: info básica de Drive (llamada muy simple)
  try {
    const used = DriveApp.getStorageUsed();
    push('2) DriveApp.getStorageUsed(): ' + used + ' bytes — OK, Drive responde.');
  } catch (e) { push('2) ERROR getStorageUsed: ' + e.message); }

  // Test 3: leer la carpeta raíz
  try {
    const root = DriveApp.getRootFolder();
    push('3) DriveApp.getRootFolder(): ' + root.getName() + ' (ID=' + root.getId() + ') — OK.');
  } catch (e) { push('3) ERROR getRootFolder: ' + e.message + ' — muy probable que tu Workspace tenga bloqueado el acceso de Apps Script a Drive.'); }

  // Test 4: listar primeras 3 carpetas de la raíz
  try {
    const it = DriveApp.getRootFolder().getFolders();
    let n = 0;
    while (it.hasNext() && n < 3) { push('4.' + (n+1) + ') Carpeta encontrada: ' + it.next().getName()); n++; }
    if (n === 0) push('4) Tu raíz de Drive no tiene carpetas (raro pero OK).');
  } catch (e) { push('4) ERROR listando carpetas: ' + e.message); }

  // Test 5: crear carpeta temporal (lo que falló antes)
  try {
    const test = DriveApp.createFolder('__test_stock_' + Date.now());
    push('5) createFolder OK: ' + test.getName() + ' (ID=' + test.getId() + '). La borro.');
    test.setTrashed(true);
  } catch (e) { push('5) ERROR createFolder: ' + e.message); }

  // Test 6: ¿se puede abrir el ID que tenés guardado?
  try {
    if (!DRIVE_ROOT_FOLDER_ID) push('6) DRIVE_ROOT_FOLDER_ID está vacío.');
    else {
      const f = DriveApp.getFolderById(DRIVE_ROOT_FOLDER_ID);
      push('6) getFolderById("' + DRIVE_ROOT_FOLDER_ID + '") OK: ' + f.getName());
    }
  } catch (e) { push('6) ERROR getFolderById: ' + e.message); }

  push('========== FIN DIAGNÓSTICO ==========');
  push('Si 2/3/4/5 dan error, tu Workspace (@tabacaleraespert.com) probablemente tiene');
  push('bloqueado el acceso de Apps Script a Drive. Opciones:');
  push(' - Pedirle al admin de Workspace que habilite Drive para Apps Script.');
  push(' - Usar una cuenta personal de Gmail para el Apps Script.');
  push(' - Alternativa sin Drive: guardar las fotos como enlaces externos (te puedo implementar).');

  return log.join('\n');
}

// Helper manual: ejecutá esta función desde el editor de Apps Script si
// nunca creaste la carpeta raíz o perdiste el ID. Crea "Stock Galpones"
// en tu Drive, la comparte con "cualquiera con el link (Lector)" y te
// loguea el ID para que lo pegues en DRIVE_ROOT_FOLDER_ID.
function crearCarpetaStockGalpones() {
  // Si ya existe una carpeta con ese nombre en la raíz, la reutilizo.
  // OJO: en algunas cuentas getFoldersByName tira "Service error: Drive".
  // Si falla, creamos directo — una sola vez no es drama.
  const nombre = 'Stock Galpones';
  let folder = null;
  try {
    const existing = DriveApp.getRootFolder().getFoldersByName(nombre);
    if (existing.hasNext()) {
      folder = existing.next();
      Logger.log('Ya existía una carpeta llamada "' + nombre + '". Reutilizando.');
    }
  } catch (e) {
    Logger.log('El iterador de Drive falló (' + e.message + '). Voy a crear la carpeta directo.');
  }
  if (!folder) {
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

// NOTA IMPORTANTE sobre el iterador de Drive:
// En algunas cuentas, los iteradores de DriveApp (getFolders, getFoldersByName,
// getFiles, getFilesByName) tiran "Service error: Drive" de manera
// intermitente/persistente. No es un problema de permisos (createFolder y
// getFolderById funcionan). Para no depender del iterador:
//   1) cacheamos el ID de cada carpeta que necesitamos en Script Properties.
//   2) si el iterador falla, directamente creamos la carpeta.
// Así, a partir de la 2da llamada ya no usamos el iterador.
function _folderCacheKey(parent, name) { return 'folder::' + parent.getId() + '::' + name; }

function ensureFolder(parent, name) {
  const props = PropertiesService.getScriptProperties();
  const key = _folderCacheKey(parent, name);
  const cachedId = props.getProperty(key);
  if (cachedId) {
    try {
      const f = DriveApp.getFolderById(cachedId);
      if (!f.isTrashed()) return f;
    } catch (_) { /* cache vencido, seguimos */ }
  }
  // Intentamos el iterador; si falla, creamos.
  let found = null;
  try {
    const it = parent.getFoldersByName(name);
    if (it.hasNext()) found = it.next();
  } catch (_) { /* Service error: Drive — vamos a crear */ }
  if (!found) found = parent.createFolder(name);
  props.setProperty(key, found.getId());
  return found;
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

  // Usamos el formato "thumbnail" porque drive.google.com/uc?export=view
  // devuelve 403 al incrustarse como <img> desde otro dominio (Google lo
  // restringió en 2023+). El endpoint /thumbnail sigue funcionando.
  const url = `https://drive.google.com/thumbnail?id=${file.getId()}&sz=w1000`;
  updateProductoFotoURL(sku, url);
  return { url, fileId: file.getId() };
}

function updateProductoFotoURL(sku, url) {
  const s = sheet(SHEET_PRODUCTOS);
  const last = s.getLastRow();
  if (last < 2) return;
  // SKU puede venir como Number desde el Sheet si es 100% numérico (EAN),
  // pero el parametro sku llega como String desde el POST. Normalizar ambos.
  const skuStr = String(sku);
  const skus = s.getRange(2, 1, last-1, 1).getValues();
  for (let i = 0; i < skus.length; i++) {
    if (String(skus[i][0]) === skuStr) {
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

  // Formato /thumbnail para evitar 403 al incrustar como <img> (ver nota en uploadFoto)
  const url = `https://drive.google.com/thumbnail?id=${file.getId()}&sz=w1000`;
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
  // Normalizar ambos lados a String: los SKU numericos (EAN) vienen como
  // Number desde el Sheet pero como String desde el POST.
  const skuStr = String(sku);
  const skus = s.getRange(2, 1, last-1, 1).getValues();
  for (let i = 0; i < skus.length; i++) {
    if (String(skus[i][0]) === skuStr) {
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
  // Normalizamos a String: los SKU numericos (EAN) se leen como Number del Sheet
  // pero el regex del nombre del archivo siempre devuelve String → sin esto, los
  // SKU 100% numericos no matchean y quedan desincronizados.
  const skus = productos.map(p => String(p.SKU));
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
        // Formato /thumbnail para evitar 403 al incrustar como <img>
        const url = `https://drive.google.com/thumbnail?id=${f.getId()}&sz=w1000`;
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

  // Normalizar a String ambos lados: los SKU numericos (EAN) se leen como Number del Sheet.
  const p = getProducts().find(pp => String(pp.SKU) === sku);
  const stock = getStock().find(s => String(s.SKU) === sku);

  if (!p) {
    return HtmlService.createHtmlOutput(
      `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
      `<title>Sin producto</title></head>` +
      `<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;` +
      `margin:0;padding:32px 20px;text-align:center;background:#F4F6F9;color:#222;font-size:17px;">` +
      `<div style="font-size:56px;margin-bottom:8px;">❓</div>` +
      `<h1 style="color:#C0392B;font-size:26px;margin:0 0 12px;">Producto no encontrado</h1>` +
      `<p style="color:#6B7280;font-size:16px;">SKU: <code style="font-size:17px;">${sku}</code></p></body></html>`)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  const zonas = getZones();
  const zonasRows = zonas.map(z => {
    const v = stock ? Number(stock[z.Codigo] || 0) : 0;
    const empty = v === 0 ? ' style="color:#9CA3AF"' : '';
    return `<tr${empty}><td>${z.Nombre}</td><td class="num">${v}</td></tr>`;
  }).join('');

  const total     = stock ? Number(stock.Total_Fisico || 0) : 0;
  const reservado = stock ? Number(stock.Reservado || 0) : 0;
  const disponible= stock ? Number(stock.Disponible || 0) : 0;
  const minimo    = stock ? Number(stock.Minimo || 0) : 0;
  const alerta    = stock && stock.Alerta === 'BAJO STOCK';
  const foto      = p.Foto_URL || '';
  const unidad    = p.Unidad || '';

  // Chip de sub/categoria
  const chipText = (p.Subcategoria || p.Categoria || '').trim();

  const html = `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#143757">
<title>${p.Nombre} · ${p.SKU}</title>
<style>
  /* Mobile-first: todo dimensionado para que se lea sin zoom en un celu.
     Base font 17px (estandar iOS para evitar que Safari haga auto-zoom en inputs). */
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html, body { margin:0; padding:0; }
  body {
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    background:#F4F6F9; color:#1F2937;
    font-size:17px; line-height:1.45;
    padding-bottom:env(safe-area-inset-bottom);
  }
  header {
    background:#143757; color:#fff;
    padding:18px 20px calc(18px + env(safe-area-inset-top)) 20px;
    padding-top:calc(18px + env(safe-area-inset-top));
    text-align:center; font-size:17px; font-weight:600; letter-spacing:.02em;
  }
  .wrap { max-width:560px; margin:0 auto; padding:14px; }
  .card {
    background:#fff; border-radius:14px; padding:18px;
    margin-bottom:12px; box-shadow:0 2px 8px rgba(0,0,0,.06);
  }
  h1 { margin:0 0 6px; font-size:26px; line-height:1.2; color:#143757; font-weight:800; }
  .sku {
    display:inline-block; font-family:"SF Mono",Menlo,Consolas,monospace;
    font-size:15px; color:#374151; background:#F3F4F6;
    padding:4px 10px; border-radius:6px; margin-right:6px;
  }
  .chip {
    display:inline-block; font-size:13px; color:#4B5563;
    background:#E5E7EB; padding:4px 10px; border-radius:6px;
    font-weight:600; text-transform:uppercase; letter-spacing:.03em;
  }
  .sub-line { margin-top:6px; }
  img.foto {
    width:100%; max-height:320px; object-fit:cover;
    border-radius:12px; display:block; margin-top:14px;
    background:#E3E7ED;
  }
  .big {
    font-size:72px; font-weight:800; color:#143757;
    text-align:center; margin:4px 0 0; line-height:1;
    letter-spacing:-.02em;
  }
  .big-unit { font-size:22px; color:#6B7280; text-align:center; margin-top:6px; font-weight:500; }
  .big-label { text-align:center; color:#9CA3AF; font-size:13px; margin-top:2px; text-transform:uppercase; letter-spacing:.08em; font-weight:600; }
  .status {
    margin-top:14px; padding:12px 16px; border-radius:10px;
    font-weight:700; text-align:center; font-size:16px;
  }
  .status.warn { background:#FEE2E2; color:#991B1B; }
  .status.ok   { background:#D1FAE5; color:#065F46; }
  .status.nil  { background:#F3F4F6; color:#6B7280; }
  .card-title {
    font-weight:700; color:#374151; font-size:15px;
    text-transform:uppercase; letter-spacing:.06em;
    margin-bottom:10px;
  }
  table { width:100%; border-collapse:collapse; font-size:17px; }
  td { padding:14px 4px; border-bottom:1px solid #E5E7EB; }
  tr:last-child td { border-bottom:none; }
  .num { text-align:right; font-weight:700; font-family:"SF Mono",Menlo,monospace; }
  .totals td { padding:12px 4px; font-size:16px; }
  .totals td:first-child { color:#6B7280; }
  .totals tr.highlight td { color:#143757; font-weight:700; font-size:17px; }
  footer {
    text-align:center; color:#9CA3AF; font-size:13px;
    padding:16px 20px calc(16px + env(safe-area-inset-bottom));
  }
  @media (max-width:360px) {
    .big { font-size:60px; }
    h1 { font-size:22px; }
  }
</style></head>
<body>
<header>📦 Stock · EQTC</header>
<div class="wrap">
  <div class="card">
    <h1>${p.Nombre}</h1>
    <div class="sub-line">
      <span class="sku">${p.SKU}</span>${chipText ? `<span class="chip">${chipText}</span>` : ''}
    </div>
    ${foto ? `<img class="foto" src="${foto}" alt="" onerror="this.style.display='none'">` : ''}
  </div>
  <div class="card">
    <div class="big-label">Disponible</div>
    <div class="big">${disponible}</div>
    <div class="big-unit">${unidad}</div>
    ${alerta
      ? '<div class="status warn">⚠️ Bajo stock mínimo</div>'
      : (total > 0
          ? '<div class="status ok">✓ Stock OK</div>'
          : '<div class="status nil">Sin stock cargado</div>')}
  </div>
  <div class="card">
    <div class="card-title">Por galpón</div>
    <table>${zonasRows || '<tr><td colspan="2" style="color:#9CA3AF;text-align:center;">Sin datos</td></tr>'}</table>
  </div>
  <div class="card">
    <div class="card-title">Resumen</div>
    <table class="totals">
      <tr class="highlight"><td>Total físico</td><td class="num">${total} ${unidad}</td></tr>
      <tr><td>Reservado</td><td class="num">${reservado}</td></tr>
      <tr><td>Mínimo</td><td class="num">${minimo}</td></tr>
    </table>
  </div>
</div>
<footer>Escaneado desde la etiqueta · stock en tiempo real</footer>
</body></html>`;

  return HtmlService.createHtmlOutput(html)
    .setTitle(p.Nombre + ' · Stock')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
