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

var META_HEADERS = ['Date', 'Account', 'Campaign', 'Ad Set', 'Ad', 'Spend', 'Impressions',
  'Clicks', 'Reach', 'Frequency', 'LP Views', 'Registrations', 'Schedules (Meta)', 'Video Views', 'Thumbnail URL'];
var POSTHOG_HEADERS = ['Date', 'Ad', 'Sessions', 'Bounced Sessions'];

// ===================== WEB APP =====================
// Sirve el dashboard como página web pública. Requiere un archivo HTML llamado
// "Dashboard" en este mismo proyecto de Apps Script (con el contenido de
// SSW_AccountDashboard.html adentro). Deploy > New deployment > Web app.
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('SSW Account Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ===================== ENTRY POINTS =====================

function runDailySync() {
  syncMeta();
  syncPostHog();
}

function createTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncMeta').timeBased().everyDays(1).atHour(3).create();
  ScriptApp.newTrigger('syncPostHog').timeBased().everyDays(1).atHour(4).create();
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
