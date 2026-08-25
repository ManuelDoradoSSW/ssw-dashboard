// ===================== CONFIG =====================
var GRAPH_API_VERSION = 'v21.0'; // si Meta lo deprecó, subir versión acá
var WINDOW_DAYS = 10; // ventana que se re-sincroniza cada corrida (cubre delay de atribución)

var META_ACCOUNTS = [
  { id: 'act_994485823231431', name: 'SSW | 2026' },
  { id: 'act_2344085889130673', name: 'So Shall We USA' },
  { id: 'act_1626400979496060', name: 'New Account SSW | 2026' }
];

var META_SHEET = 'Meta_Raw';
var POSTHOG_SHEET = 'PostHog_Raw';
var ICLOSED_SHEET = 'iClosed_Raw';

var META_HEADERS = ['Date', 'Account', 'Campaign', 'Ad Set', 'Ad', 'Spend', 'Impressions',
  'Clicks', 'Reach', 'Frequency', 'LP Views', 'Registrations', 'Schedules (Meta)', 'Video Views', 'Thumbnail URL'];
var POSTHOG_HEADERS = ['Date', 'Ad', 'Sessions', 'Bounced Sessions'];
var ICLOSED_HEADERS = ['Date', 'Account', 'Campaign', 'Ad Set', 'Ad', 'Real MQL', 'Lead Score'];
var CREATIVES_SHEET = 'Creatives';
var CREATIVES_HEADERS = ['Ad', 'Thumbnail URL'];

// ===================== ENTRY POINTS =====================

function runDailySync() {
  syncMeta();
  syncPostHog();
  syncCreatives();
  syncIClosed();
}

function createTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncMeta').timeBased().everyDays(1).atHour(3).create();
  ScriptApp.newTrigger('syncPostHog').timeBased().everyDays(1).atHour(4).create();
  ScriptApp.newTrigger('syncIClosed').timeBased().everyDays(1).atHour(5).create();
}

// Agrega SOLO el trigger diario de syncCreatives, sin tocar los otros (a diferencia de
// createTriggers, que los recrea todos -- incluido el de syncIClosed, que NO debe activarse
// mientras ese sync siga roto, ver HANDOFF §7). Correr una vez desde el editor de Apps Script.
function createCreativesTrigger() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'syncCreatives'; });
  if (exists) { Logger.log('El trigger de syncCreatives ya existe, no hago nada.'); return; }
  ScriptApp.newTrigger('syncCreatives').timeBased().everyDays(1).atHour(2).create();
  Logger.log('Trigger de syncCreatives creado (diario ~2am).');
}

// ===================== META =====================

function syncMeta() {
  var token = PropertiesService.getScriptProperties().getProperty('META_TOKEN');
  if (!token) throw new Error('Falta META_TOKEN en Script Properties');

  var since = daysAgo(WINDOW_DAYS);
  var until = daysAgo(0);
  var rows = [];

  META_ACCOUNTS.forEach(function (acc) {
    rows = rows.concat(fetchMetaAccount(acc, since, until, token));
  });

  upsertRows(META_SHEET, META_HEADERS, rows, since, until);
}

// Corrida manual, UNA vez (o cada tanto): trae todo el año hasta hoy, mes por mes (con pausas
// entre cada uno para no pegarle demasiado rápido a la API). Si un mes falla, lo salta y sigue
// con el resto en vez de cortar todo el backfill. No la deja el trigger diario porque re-traer
// meses de historia todos los días sería lento y desperdicia cuota -- syncMeta sigue cubriendo
// solo la ventana de 10 días para atribución.
function backfillMeta() {
  var token = PropertiesService.getScriptProperties().getProperty('META_TOKEN');
  if (!token) throw new Error('Falta META_TOKEN en Script Properties');
  var since = new Date().getUTCFullYear() + '-01-01';
  var until = daysAgo(0);

  // ACUMULO las 3 cuentas y escribo UNA sola vez al final -- si cada cuenta hiciera su propio
  // upsertRows con el mismo rango de fechas, cada llamada borraría lo que escribió la anterior
  // (todas comparten el mismo since/until, así que "afuera del rango" nunca protege a las otras
  // cuentas). Esto fue justo el bug que rompió el primer backfill.
  var allRows = [];
  META_ACCOUNTS.forEach(function (acc) {
    allRows = allRows.concat(fetchMetaAccountChunked(acc, since, until, token));
  });

  upsertRows(META_SHEET, META_HEADERS, allRows, since, until);
  Logger.log('Backfill listo: ' + allRows.length + ' filas desde ' + since + ' hasta ' + until);
}

// Por si el backfill completo se corta a mitad de camino: corré esto para una cuenta puntual
// pasando su account id, ej: backfillMetaOne('act_2344085889130673'). A diferencia de
// backfillMeta, este SÍ hace su propio upsert -- pero pasándole el nombre de cuenta a
// upsertRows para que solo reemplace las filas de ESA cuenta, sin tocar las otras 2.
function backfillMetaOne(accountId) {
  var token = PropertiesService.getScriptProperties().getProperty('META_TOKEN');
  if (!token) throw new Error('Falta META_TOKEN en Script Properties');
  var acc = META_ACCOUNTS.filter(function (a) { return a.id === accountId; })[0];
  if (!acc) throw new Error('Cuenta no encontrada: ' + accountId);

  var since = new Date().getUTCFullYear() + '-01-01';
  var until = daysAgo(0);
  var rows = fetchMetaAccountChunked(acc, since, until, token);
  upsertRows(META_SHEET, META_HEADERS, rows, since, until, acc.name);
  Logger.log(acc.name + ': backfill terminado, ' + rows.length + ' filas totales.');
}

function fetchMetaAccountChunked(account, since, until, token) {
  var chunks = monthChunks(since, until);
  var allRaw = [];
  var adIdsSeen = {};

  chunks.forEach(function (chunk) {
    try {
      var raw = fetchMetaInsightsRaw(account, chunk.since, chunk.until, token);
      raw.forEach(function (r) { if (r.ad_id) adIdsSeen[r.ad_id] = true; });
      allRaw = allRaw.concat(raw);
      Logger.log(account.name + ' ' + chunk.since + '..' + chunk.until + ': ' + raw.length + ' filas');
    } catch (e) {
      Logger.log(account.name + ' ' + chunk.since + '..' + chunk.until + ' FALLO, sigo con el resto: ' + e.message);
    }
    Utilities.sleep(2000);
  });

  var thumbnails = fetchThumbnailsForAdIds(Object.keys(adIdsSeen), token);
  return allRaw.map(function (r) { return buildMetaRow(r, account, thumbnails); });
}

function monthChunks(sinceStr, untilStr) {
  var chunks = [];
  var cursor = sinceStr;
  while (cursor <= untilStr) {
    var d = new Date(cursor + 'T00:00:00Z');
    var monthEnd = Utilities.formatDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)), 'UTC', 'yyyy-MM-dd');
    var chunkUntil = monthEnd < untilStr ? monthEnd : untilStr;
    chunks.push({ since: cursor, until: chunkUntil });
    cursor = addDays(chunkUntil, 1);
  }
  return chunks;
}

function fetchMetaAccount(account, since, until, token) {
  var raw = fetchMetaInsightsRaw(account, since, until, token);
  var adIdsSeen = {};
  raw.forEach(function (r) { if (r.ad_id) adIdsSeen[r.ad_id] = true; });
  var thumbnails = fetchThumbnailsForAdIds(Object.keys(adIdsSeen), token);
  return raw.map(function (r) { return buildMetaRow(r, account, thumbnails); });
}

function fetchMetaInsightsRaw(account, since, until, token) {
  var rows = [];
  var timeRange = encodeURIComponent(JSON.stringify({ since: since, until: until }));
  var fields = 'ad_id,ad_name,adset_name,campaign_name,account_name,spend,impressions,clicks,reach,frequency,actions';
  var url = 'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + account.id + '/insights'
    + '?level=ad&time_increment=1&limit=500'
    + '&time_range=' + timeRange
    + '&fields=' + fields
    + '&access_token=' + token;

  while (url) {
    var json = fetchJsonWithRetry(url, account.name);
    rows = rows.concat(json.data || []);
    url = json.paging && json.paging.next ? json.paging.next : null;
  }
  return rows;
}

function buildMetaRow(r, account, thumbnails) {
  return [
    r.date_start,
    r.account_name || account.name,
    r.campaign_name || '',
    r.adset_name || '',
    r.ad_name || '',
    Number(r.spend || 0),
    Number(r.impressions || 0),
    Number(r.clicks || 0),
    Number(r.reach || 0),
    Number(r.frequency || 0),
    findAction(r.actions, ['omni_landing_page_view', 'landing_page_view']),
    findAction(r.actions, ['omni_complete_registration', 'complete_registration', 'offsite_conversion.fb_pixel_complete_registration']),
    findAction(r.actions, ['schedule_total', 'schedule_website']),
    findAction(r.actions, ['video_view']),
    (thumbnails && thumbnails[r.ad_id]) || ''
  ];
}

function fetchJsonWithRetry(url, accountName) {
  var lastErr;
  for (var i = 0; i < 5; i++) {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var json = JSON.parse(resp.getContentText());
    if (!json.error) return json;
    lastErr = json.error;
    Utilities.sleep(5000 * Math.pow(2, i)); // 5s, 10s, 20s, 40s, 80s
  }
  throw new Error('Meta API (' + accountName + '): ' + lastErr.message);
}

function fetchThumbnailsForAdIds(adIds, token) {
  var map = {};
  var batchSize = 50;
  for (var i = 0; i < adIds.length; i += batchSize) {
    var batch = adIds.slice(i, i + batchSize);
    var url = 'https://graph.facebook.com/' + GRAPH_API_VERSION + '/'
      + '?ids=' + batch.join(',')
      + '&fields=' + encodeURIComponent('creative{thumbnail_url}')
      + '&access_token=' + token;
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var json = JSON.parse(resp.getContentText());
    if (json.error) { Logger.log('fetchThumbnailsForAdIds: ' + JSON.stringify(json.error)); continue; }
    batch.forEach(function (adId) {
      var entry = json[adId];
      if (entry && entry.creative && entry.creative.thumbnail_url) map[adId] = entry.creative.thumbnail_url;
    });
  }
  return map;
}

// ===================== CREATIVES (thumbnails frescos) =====================
// Las URLs de thumbnail de Meta son links de CDN firmados y TEMPORALES -- expiran (403). syncMeta
// solo refresca la ventana de WINDOW_DAYS, así que los ads más viejos quedan con la URL vencida y
// su imagen no carga en el dashboard. Esta función enumera TODOS los ads de las 3 cuentas (no solo
// los que tuvieron entrega en la ventana) y guarda su thumbnail_url ACTUAL en el tab Creatives,
// keyed por nombre de ad (que es como joinea el dashboard). Corriéndola a diario, el dashboard
// siempre tiene URLs de <24h. No guarda los bytes de la imagen: si el ad se borra de Meta o la URL
// vence entre corridas, esa imagen igual puede fallar -- para persistencia total habría que bajar
// los bytes a Drive (ver HANDOFF §7). El dashboard usa esta URL para pisar la guardada en Meta_Raw.
function syncCreatives() {
  var token = PropertiesService.getScriptProperties().getProperty('META_TOKEN');
  if (!token) throw new Error('Falta META_TOKEN en Script Properties');

  var byName = {};
  var count = 0;
  META_ACCOUNTS.forEach(function (acc) {
    try {
      fetchAccountCreatives(acc, token).forEach(function (c) {
        if (c.name && c.thumbnailUrl) { byName[c.name] = c.thumbnailUrl; count++; }
      });
    } catch (e) {
      Logger.log('syncCreatives ' + acc.name + ' FALLO, sigo con el resto: ' + e.message);
    }
  });

  var rows = Object.keys(byName).map(function (name) { return [name, byName[name]]; });
  writeWholeSheet(CREATIVES_SHEET, CREATIVES_HEADERS, rows);
  Logger.log('Creatives: ' + rows.length + ' ads con thumbnail (de ' + count + ' ads vistos en total).');
}

function fetchAccountCreatives(account, token) {
  var out = [];
  var url = 'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + account.id + '/ads'
    + '?fields=' + encodeURIComponent('name,creative{thumbnail_url}')
    + '&limit=200&access_token=' + token;
  while (url) {
    var json = fetchJsonWithRetry(url, account.name);
    (json.data || []).forEach(function (ad) {
      out.push({ name: ad.name || '', thumbnailUrl: (ad.creative && ad.creative.thumbnail_url) || '' });
    });
    url = json.paging && json.paging.next ? json.paging.next : null;
  }
  return out;
}

// Reemplaza el contenido entero de una tab (la crea si no existe). A diferencia de upsertRows no
// filtra por fecha -- Creatives es un snapshot completo que se reescribe en cada corrida.
function writeWholeSheet(sheetName, headers, rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  var maxRows = sheet.getMaxRows();
  if (maxRows > 1) sheet.getRange(2, 1, maxRows - 1, headers.length).clearContent();
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function debugMetaActions() {
  var token = PropertiesService.getScriptProperties().getProperty('META_TOKEN');
  var since = daysAgo(30);
  var until = daysAgo(0);
  var timeRange = encodeURIComponent(JSON.stringify({ since: since, until: until }));

  META_ACCOUNTS.forEach(function (acc) {
    var url = 'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + acc.id + '/insights'
      + '?level=campaign&time_range=' + timeRange
      + '&fields=campaign_name,actions'
      + '&limit=500&access_token=' + token;
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var json = JSON.parse(resp.getContentText());
    if (json.error) { Logger.log(acc.name + ' ERROR: ' + JSON.stringify(json.error)); return; }
    var types = {};
    (json.data || []).forEach(function (r) {
      (r.actions || []).forEach(function (a) {
        types[a.action_type] = (types[a.action_type] || 0) + Number(a.value || 0);
      });
    });
    Logger.log(acc.name + ' (' + acc.id + ') action types last 30 days: ' + JSON.stringify(types, null, 2));

    var ccUrl = 'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + acc.id + '/customconversions'
      + '?fields=id,name,custom_event_type,rule&access_token=' + token;
    var ccResp = UrlFetchApp.fetch(ccUrl, { muteHttpExceptions: true });
    var ccJson = JSON.parse(ccResp.getContentText());
    if (ccJson.error) { Logger.log(acc.name + ' customconversions ERROR: ' + JSON.stringify(ccJson.error)); return; }
    Logger.log(acc.name + ' custom conversions: ' + JSON.stringify(ccJson.data, null, 2));
  });
}

function findAction(actions, preferredTypes) {
  if (!actions) return 0;
  for (var i = 0; i < preferredTypes.length; i++) {
    var match = actions.filter(function (a) { return a.action_type === preferredTypes[i]; })[0];
    if (match) return Number(match.value || 0);
  }
  return 0;
}

// ===================== ICLOSED =====================
// Base URL y auth confirmados contra la spec pública de la API (developer.iclosed.io):
// Authorization: Bearer <API key completa, ya incluye su propio prefijo>.
var ICLOSED_BASE_URL = 'https://public.api.iclosed.io';

// --- Sync automático NUEVO (2026-08-21), escribe a una tab APARTE para validar antes de migrar ---
var ICLOSED_AUTO_SHEET = 'iClosed_Auto';
// mismas 9 columnas que iClosed_Raw + Contact ID (col J) como llave de merge. El dashboard, si
// algún día se lo repunta a esta tab, ignora la col J (lee hasta la I).
var ICLOSED_AUTO_HEADERS = ['Date', 'Account', 'Campaign', 'Ad Set', 'Ad', 'Real MQL', 'Lead Score', 'Scheduling status', 'Event', 'Contact ID'];
var ICLOSED_AUTO_WINDOW_DAYS = 14; // ventana (por joinedTime) que se re-sincroniza cada corrida; es MERGE, no reemplazo

function syncIClosed() {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ICLOSED_API_KEY');
  if (!apiKey) throw new Error('Falta ICLOSED_API_KEY en Script Properties');

  var since = daysAgo(WINDOW_DAYS);
  var until = daysAgo(0);
  var calls = fetchIClosedEventCalls(since, until, apiKey);

  // Real MQL y Lead Score son custom fields a nivel CONTACTO (no de la llamada puntual),
  // así que se piden una sola vez por contacto único, no por call -- confirmado con
  // debugIClosedContactDetail() (customField.identifier 'real-mql' / 'lead-score').
  var contactFields = fetchIClosedContactFields(uniqueContactIds(calls), apiKey);

  var rows = calls
    .map(function (call) { return buildIClosedRow(call, contactFields); })
    .filter(Boolean); // descarta calls sin utm_content -- sin Ad no hay con qué atribuir la fila

  upsertRows(ICLOSED_SHEET, ICLOSED_HEADERS, rows, since, until);
  Logger.log('iClosed: ' + rows.length + ' filas (de ' + calls.length + ' calls) para ' + since + '..' + until);
}

function fetchIClosedEventCalls(since, until, apiKey) {
  var all = [];
  var limit = 100;
  var page = 0;
  while (true) {
    var url = ICLOSED_BASE_URL + '/v1/eventCalls'
      + '?eventType=PAST&dateFrom=' + since + '&dateTo=' + until
      + '&limit=' + limit + '&page=' + page + '&orderColumn=dateTime&orderBy=asc';
    var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + apiKey }, muteHttpExceptions: true });
    var json = JSON.parse(resp.getContentText());
    if (json.error) throw new Error('iClosed eventCalls: ' + JSON.stringify(json.error));
    var calls = (json.data && json.data.eventCalls) || [];
    all = all.concat(calls);
    var total = (json.data && json.data.count) || 0;
    page++;
    if (calls.length === 0 || page * limit >= total) break;
  }
  return all;
}

function uniqueContactIds(calls) {
  var seen = {};
  var ids = [];
  calls.forEach(function (c) {
    if (c.contactId && !seen[c.contactId]) { seen[c.contactId] = true; ids.push(c.contactId); }
  });
  return ids;
}

// Una llamada a /v1/contacts/detail por contacto -- la API no ofrece un endpoint bulk para
// esto (contactId es un parámetro simple, no una lista). Para la ventana rolling de
// WINDOW_DAYS esto es un puñado de contactos, no un problema de cuota.
function fetchIClosedContactFields(contactIds, apiKey) {
  var map = {};
  contactIds.forEach(function (contactId) {
    var url = ICLOSED_BASE_URL + '/v1/contacts/detail?contactId=' + contactId;
    var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + apiKey }, muteHttpExceptions: true });
    var json = JSON.parse(resp.getContentText());
    if (json.error) {
      Logger.log('iClosed contact ' + contactId + ' FALLO, sigo con el resto: ' + JSON.stringify(json.error));
      return;
    }
    var assoc = (json.data && json.data.CustomFieldAssociation) || [];
    map[contactId] = {
      realMql: findCustomFieldAnswer(assoc, 'real-mql'),
      leadScore: findCustomFieldAnswer(assoc, 'lead-score')
    };
  });
  return map;
}

function findCustomFieldAnswer(customFieldAssociations, identifier) {
  var entry = customFieldAssociations.filter(function (a) {
    return a.customField && a.customField.identifier === identifier;
  })[0];
  if (!entry || !entry.CustomFieldAnswer || !entry.CustomFieldAnswer.length) return '';
  return entry.CustomFieldAnswer[0].answer || '';
}

// utm_campaign/utm_medium/utm_content son literalmente Campaign/Ad Set/Ad (mismo tracking
// template que Meta_Raw) -- utm_content ya viene con espacios codificados como "+", igual
// que el export manual de iClosed, así que el decodePlusEncoded/resolveAdName del lado del
// HTML lo resuelve sin cambios. Account queda vacío a propósito: el dashboard ya lo completa
// cruzando Campaign contra Meta_Raw (mismo comportamiento que el export manual de siempre).
function buildIClosedRow(call, contactFields) {
  var utmMap = {};
  (call.utm || []).forEach(function (u) { utmMap[u.utmKey] = u.utmValue; });
  var ad = utmMap['utm_content'];
  if (!ad) return null;

  var fields = contactFields[call.contactId] || { realMql: '', leadScore: '' };
  var date = (call.dateTimeUTC || call.dateTime || '').substring(0, 10);
  return [date, '', utmMap['utm_campaign'] || '', utmMap['utm_medium'] || '', ad, fields.realMql, fields.leadScore];
}

// Prueba manual: trae las últimas llamadas (event calls) de los últimos 14 días y loguea
// el JSON crudo tal cual lo devuelve la API. Correrla UNA vez para ver los nombres reales
// de UTM keys, el valor de "outcome", y cómo aparece el custom field "Lead Score" en
// secondaryAnswers/questions -- recién con eso se puede escribir el sync real sin adivinar
// la forma exacta de la respuesta.
function debugIClosed() {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ICLOSED_API_KEY');
  if (!apiKey) throw new Error('Falta ICLOSED_API_KEY en Script Properties');

  var url = ICLOSED_BASE_URL + '/v1/eventCalls'
    + '?eventType=PAST'
    + '&dateFrom=' + daysAgo(14)
    + '&dateTo=' + daysAgo(0)
    + '&limit=5&page=0&orderColumn=dateTime&orderBy=desc';

  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + apiKey },
    muteHttpExceptions: true
  });
  Logger.log('STATUS ' + resp.getResponseCode());
  Logger.log(resp.getContentText());
}

// Prueba manual #3: para un contacto que en el export manual aparece con MÚLTIPLES ads
// (UTM Content con coma), ver si "referrerUrl" de /v1/contacts/detail corresponde al primer
// touch o al último -- necesario para decidir qué se pierde si el sync usa solo referrerUrl
// en vez del multi-touch completo que trae el export manual. Uso "search" de /v1/contacts
// para encontrar el contactId a partir del email (no lo tenemos a mano de otra forma).
function debugIClosedFindByEmail(email) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ICLOSED_API_KEY');
  if (!apiKey) throw new Error('Falta ICLOSED_API_KEY en Script Properties');

  var searchUrl = ICLOSED_BASE_URL + '/v1/contacts?search=' + encodeURIComponent(email) + '&limit=5';
  var searchResp = UrlFetchApp.fetch(searchUrl, { headers: { Authorization: 'Bearer ' + apiKey }, muteHttpExceptions: true });
  Logger.log('SEARCH STATUS ' + searchResp.getResponseCode());
  Logger.log(searchResp.getContentText());

  var searchJson = JSON.parse(searchResp.getContentText());
  var contacts = (searchJson.data && searchJson.data.contacts) || [];
  if (!contacts.length) { Logger.log('No se encontró ningún contacto con ese email.'); return; }

  var contactId = contacts[0].id;
  Logger.log('contactId encontrado: ' + contactId);

  var detailUrl = ICLOSED_BASE_URL + '/v1/contacts/detail?contactId=' + contactId;
  var detailResp = UrlFetchApp.fetch(detailUrl, { headers: { Authorization: 'Bearer ' + apiKey }, muteHttpExceptions: true });
  Logger.log('DETAIL STATUS ' + detailResp.getResponseCode());
  Logger.log(detailResp.getContentText());
}

// Prueba manual #2: debugIClosed() no trajo "Lead Score" en ningún lado (solo preguntas de
// intake tipo modelo de negocio/revenue/ad spend). La spec de /v1/contacts/detail sí expone
// "CustomFieldAssociation" -- ahí es donde debería vivir Lead Score (y potencialmente Real
// MQL, si también es un custom field en vez de derivarse de task.outcome). Correr esto con
// un contactId real (ej. uno que haya salido en el log de debugIClosed) para confirmar.
function debugIClosedContactDetail(contactId) {
  // el botón Run del editor no permite pasar argumentos -- si corrés esto directo desde el
  // dropdown, sin llamarla desde otro lado, usa este contactId de ejemplo (salió en el log
  // de debugIClosed()). Para probar con otro, cambiá este número.
  contactId = contactId || 4297233;
  var apiKey = PropertiesService.getScriptProperties().getProperty('ICLOSED_API_KEY');
  if (!apiKey) throw new Error('Falta ICLOSED_API_KEY en Script Properties');

  var url = ICLOSED_BASE_URL + '/v1/contacts/detail?contactId=' + contactId;
  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + apiKey },
    muteHttpExceptions: true
  });
  Logger.log('STATUS ' + resp.getResponseCode());
  Logger.log(resp.getContentText());
}

// ===================== ICLOSED AUTO (API -> tab aparte, para validar) =====================
// Reemplaza el pegado manual del export "Global Data / All Contacts". Escribe a iClosed_Auto
// (NO a iClosed_Raw) para comparar contra la tab manual antes de migrar. Fuente correcta =
// /v1/contacts (por joinedTime = Contact Creation Date), + /v1/contacts/detail (utm via
// referrerUrl single-touch + Real MQL/Lead Score) + /v1/eventCalls?contactId (nombre de Call A/B).
//
// MERGE por Contact ID con reglas confirmadas con el usuario:
//  - Date / Campaign / Ad Set / Ad (utm): se fijan una vez (origen, no cambian).
//  - Real MQL / Lead Score: SIEMPRE el último valor (se completan post-call, con ~1 día de lag).
//  - Scheduling status + Event: se actualizan mientras el status sea pre-booking; se CONGELAN
//    apenas llega a un *_CALL_BOOKED, para que un show/DQ posterior no borre el booking.
//  - Multi-touch: la API solo da referrerUrl (un touch), así que se acepta perder el ~14% multi-touch.

// Corrida diaria (una vez validado). NO está en createTriggers todavía a propósito.
function syncIClosedAuto() {
  runIClosedAuto(daysAgo(ICLOSED_AUTO_WINDOW_DAYS), daysAgo(0));
}

// Para el test de validación: llena iClosed_Auto desde una fecha dada hasta hoy, mes por mes
// (idempotente: re-correr mergea de nuevo, no duplica). Ej: backfillIClosedAuto('2026-06-01')
function backfillIClosedAuto(sinceStr) {
  var since = sinceStr || daysAgo(30);
  var until = daysAgo(0);
  monthChunks(since, until).forEach(function (chunk) {
    try {
      runIClosedAuto(chunk.since, chunk.until);
    } catch (e) {
      Logger.log('iClosed_Auto backfill ' + chunk.since + '..' + chunk.until + ' FALLO, sigo: ' + e.message);
    }
    Utilities.sleep(1000);
  });
  Logger.log('backfillIClosedAuto listo desde ' + since);
}

function runIClosedAuto(since, until) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ICLOSED_API_KEY');
  if (!apiKey) throw new Error('Falta ICLOSED_API_KEY en Script Properties');

  var contacts = fetchIClosedContactsList(since, until, apiKey);
  Logger.log('iClosed_Auto ' + since + '..' + until + ': ' + contacts.length + ' contactos');

  // merge: leer lo que ya hay en iClosed_Auto, indexado por Contact ID
  var byId = {};
  readSheetAsObjects(ICLOSED_AUTO_SHEET, ICLOSED_AUTO_HEADERS).forEach(function (row) {
    byId[String(row['Contact ID'])] = row;
  });

  contacts.forEach(function (c) {
    try {
      var id = String(c.id);
      var detail = fetchIClosedDetail(c.id, apiKey);
      var utm = parseUtmFromUrl(detail.referrerUrl);
      var eventName = fetchIClosedEventNames(c.id, apiKey);
      var status = c.status || detail.status || '';
      var prev = byId[id];

      if (!prev) {
        byId[id] = {
          'Date': (detail.joinedTime || '').substring(0, 10),
          'Account': '',
          'Campaign': utm.campaign, 'Ad Set': utm.medium, 'Ad': utm.content,
          'Real MQL': detail.realMql, 'Lead Score': detail.leadScore,
          'Scheduling status': status, 'Event': eventName, 'Contact ID': id
        };
      } else {
        prev['Real MQL'] = detail.realMql;   // siempre el último
        prev['Lead Score'] = detail.leadScore;
        var frozen = prev['Scheduling status'] === 'DISCOVERY_CALL_BOOKED' || prev['Scheduling status'] === 'STRATEGY_CALL_BOOKED';
        if (!frozen) { prev['Scheduling status'] = status; prev['Event'] = eventName; }
        // Date / utm: no se tocan (se fijaron al crear la fila)
      }
    } catch (e) {
      Logger.log('iClosed_Auto contacto ' + c.id + ' FALLO, sigo: ' + e.message);
    }
  });

  var rows = Object.keys(byId).map(function (id) {
    var r = byId[id];
    return ICLOSED_AUTO_HEADERS.map(function (h) { return r[h] != null ? r[h] : ''; });
  });
  writeWholeSheet(ICLOSED_AUTO_SHEET, ICLOSED_AUTO_HEADERS, rows);
  Logger.log('iClosed_Auto: ' + rows.length + ' filas totales (merge).');
}

// /v1/contacts filtrado por joinedTime (= Contact Creation Date del export manual). El item de
// lista trae id + status; joinedTime/utm/custom fields se piden con /detail por contacto.
function fetchIClosedContactsList(since, until, apiKey) {
  var all = [], limit = 100, page = 0;
  while (true) {
    var url = ICLOSED_BASE_URL + '/v1/contacts'
      + '?timeFrom=' + encodeURIComponent(since) + '&timeTo=' + encodeURIComponent(until)
      + '&limit=' + limit + '&page=' + page + '&orderColumn=joinedTime&orderBy=asc';
    var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + apiKey }, muteHttpExceptions: true });
    var json = JSON.parse(resp.getContentText());
    if (json.error) throw new Error('iClosed contacts: ' + JSON.stringify(json.error));
    var list = (json.data && json.data.contacts) || [];
    all = all.concat(list);
    var total = (json.data && json.data.count) || 0;
    page++;
    if (list.length === 0 || page * limit >= total) break;
  }
  return all;
}

function fetchIClosedDetail(contactId, apiKey) {
  var url = ICLOSED_BASE_URL + '/v1/contacts/detail?contactId=' + contactId;
  var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + apiKey }, muteHttpExceptions: true });
  var json = JSON.parse(resp.getContentText());
  var d = (json && json.data) || {};
  var assoc = d.CustomFieldAssociation || [];
  return {
    joinedTime: d.joinedTime || d.createdAt || '',
    referrerUrl: d.referrerUrl || '',
    status: d.status || '',
    realMql: findCustomFieldAnswer(assoc, 'real-mql'),
    leadScore: findCustomFieldAnswer(assoc, 'lead-score')
  };
}

// Nombres de las call(s) agendadas del contacto (Event). Varias -> separadas por coma, igual
// que el export manual (ej. "SSW Assessment Call B, SSW Assessment Call A").
function fetchIClosedEventNames(contactId, apiKey) {
  var url = ICLOSED_BASE_URL + '/v1/eventCalls?contactId=' + contactId + '&eventType=ALL&limit=100&page=0';
  var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + apiKey }, muteHttpExceptions: true });
  var json = JSON.parse(resp.getContentText());
  var calls = (json.data && json.data.eventCalls) || [];
  var names = [];
  calls.forEach(function (ec) {
    var n = ec.event && ec.event.name;
    if (n && names.indexOf(n) === -1) names.push(n);
  });
  return names.join(', ');
}

// Extrae utm_campaign/medium/content del query string, SIN decodificar (deja el "+" tal cual,
// mismo formato que el export manual, así el crosscheck del dashboard lo resuelve igual).
function parseUtmFromUrl(url) {
  var out = { campaign: '', medium: '', content: '' };
  if (!url) return out;
  var q = url.indexOf('?');
  if (q === -1) return out;
  url.substring(q + 1).split('&').forEach(function (pair) {
    var eq = pair.indexOf('=');
    var k = eq === -1 ? pair : pair.substring(0, eq);
    var v = eq === -1 ? '' : pair.substring(eq + 1);
    if (k === 'utm_campaign') out.campaign = v;
    else if (k === 'utm_medium') out.medium = v;
    else if (k === 'utm_content') out.content = v;
  });
  return out;
}

function readSheetAsObjects(sheetName, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var idIdx = headers.length - 1; // Contact ID es la última columna
  return data.filter(function (row) { return row[idIdx] !== '' && row[idIdx] != null; }).map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

// ===================== POSTHOG =====================

function debugWebStats() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('POSTHOG_API_KEY');
  var projectId = props.getProperty('POSTHOG_PROJECT_ID');
  var host = props.getProperty('POSTHOG_HOST');

  var day = daysAgo(1); // ayer, para tener un día completo cerrado
  var body = {
    query: {
      kind: 'WebStatsTableQuery',
      properties: [{ key: '$entry_utm_source', value: 'fb_ad', operator: 'exact', type: 'session' }],
      breakdownBy: 'InitialUTMContent',
      dateRange: { date_from: day, date_to: day },
      includeBounceRate: true,
      limit: 200
    }
  };

  var resp = UrlFetchApp.fetch(host + '/api/projects/' + projectId + '/query/', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  Logger.log('DAY=' + day);
  Logger.log('STATUS ' + resp.getResponseCode());
  var json = JSON.parse(resp.getContentText());
  Logger.log('COLUMNS: ' + JSON.stringify(json.columns));
  Logger.log('RESULTS: ' + JSON.stringify(json.results).substring(0, 2500));
}

function syncPostHog() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('POSTHOG_API_KEY');
  var projectId = props.getProperty('POSTHOG_PROJECT_ID');
  var host = props.getProperty('POSTHOG_HOST');
  if (!apiKey || !projectId || !host) throw new Error('Faltan POSTHOG_API_KEY / POSTHOG_PROJECT_ID / POSTHOG_HOST en Script Properties');

  var since = daysAgo(WINDOW_DAYS);
  var until = daysAgo(1); // hasta ayer -- hoy está incompleto y ensucia el bounce rate
  var rows = [];

  var day = since;
  while (day <= until) {
    rows = rows.concat(fetchPostHogDay(day, apiKey, projectId, host));
    day = addDays(day, 1);
  }

  upsertRows(POSTHOG_SHEET, POSTHOG_HEADERS, rows, since, until);
}

// Misma query (WebStatsTableQuery) que usa por dentro la tabla de Web Analytics de PostHog,
// así el bounce rate sale calculado exactamente igual al que se ve en su UI.
function fetchPostHogDay(day, apiKey, projectId, host) {
  var body = {
    query: {
      kind: 'WebStatsTableQuery',
      properties: [{ key: '$entry_utm_source', value: 'fb_ad', operator: 'exact', type: 'session' }],
      breakdownBy: 'InitialUTMContent',
      dateRange: { date_from: day, date_to: day },
      includeBounceRate: true,
      limit: 200
    }
  };
  var resp = UrlFetchApp.fetch(host + '/api/projects/' + projectId + '/query/', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var json = JSON.parse(resp.getContentText());
  if (json.error) throw new Error('PostHog API (' + day + '): ' + JSON.stringify(json.error));

  return (json.results || []).map(function (r) {
    var ad = r[0] || '(sin utm_content)';
    var visitors = Number((r[1] && r[1][0]) || 0);
    var bounceRate = Number((r[3] && r[3][0]) || 0);
    return [day, ad, visitors, Math.round(visitors * bounceRate)];
  });
}

// Corrida manual, UNA vez (o cada tanto): trae PostHog año-a-la-fecha, día por día, pero
// escribiendo la Sheet MES A MES (upsertRows por chunk, no todo junto al final) -- así si
// Apps Script corta la ejecución a mitad de camino (límite de tiempo de ejecución), lo ya
// escrito queda guardado y alcanza con volver a correr la función para retomar el resto,
// en vez de perder todo el trabajo. syncPostHog() sigue cubriendo solo la ventana de
// WINDOW_DAYS -- esta función es la que llena el historial que nunca se backfilleó.
function backfillPostHog() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('POSTHOG_API_KEY');
  var projectId = props.getProperty('POSTHOG_PROJECT_ID');
  var host = props.getProperty('POSTHOG_HOST');
  if (!apiKey || !projectId || !host) throw new Error('Faltan POSTHOG_API_KEY / POSTHOG_PROJECT_ID / POSTHOG_HOST en Script Properties');

  var since = new Date().getUTCFullYear() + '-01-01';
  var until = daysAgo(1); // hasta ayer, igual que syncPostHog -- hoy queda incompleto y ensucia el bounce rate
  var chunks = monthChunks(since, until);

  chunks.forEach(function (chunk) {
    var rows = [];
    var day = chunk.since;
    while (day <= chunk.until) {
      try {
        rows = rows.concat(fetchPostHogDay(day, apiKey, projectId, host));
      } catch (e) {
        Logger.log('PostHog ' + day + ' FALLO, sigo con el resto: ' + e.message);
      }
      day = addDays(day, 1);
    }
    upsertRows(POSTHOG_SHEET, POSTHOG_HEADERS, rows, chunk.since, chunk.until);
    Logger.log('PostHog backfill ' + chunk.since + '..' + chunk.until + ': ' + rows.length + ' filas');
    Utilities.sleep(1000);
  });

  Logger.log('Backfill PostHog listo desde ' + since + ' hasta ' + until);
}

// ===================== SHEET HELPERS =====================

function upsertRows(sheetName, headers, newRows, since, until, accountFilter) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('No existe la tab ' + sheetName);

  var lastRow = sheet.getLastRow();
  var keep = [];
  if (lastRow > 1) {
    var data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    keep = data.filter(function (row) {
      var d = formatDate(row[0]);
      if (d < since || d > until) return true;
      // si se pasa accountFilter, solo se reemplazan filas de ESA cuenta dentro del rango --
      // así backfillMetaOne no borra las otras 2 cuentas al re-sincronizar una sola
      if (accountFilter && row[1] !== accountFilter) return true;
      return false;
    });
  }

  sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), headers.length).clearContent();
  var finalRows = keep.concat(newRows);
  if (finalRows.length > 0) {
    sheet.getRange(2, 1, finalRows.length, headers.length).setValues(finalRows);
  }
}

function formatDate(value) {
  if (value instanceof Date) return Utilities.formatDate(value, 'UTC', 'yyyy-MM-dd');
  return String(value).substring(0, 10);
}

function daysAgo(n) {
  return addDays(Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd'), -n);
}

function addDays(dateStr, n) {
  var d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}
