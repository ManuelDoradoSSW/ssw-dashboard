# HANDOFF — SSW Account Dashboard (Meta Ads)

Last updated: 2026-08-06. Written for a fresh Claude session to pick this up with zero prior context.

## 1. Objetivo

Dashboard de performance de la cuenta de Meta Ads de **SSW (So Shall We)** — la agencia
propia, no un cliente. Lo usa Manuel (dueño/operador) para ver spend, funnel de
conversión y calidad de leads (Real MQL vs Spam) across sus 3 cuentas de Meta, y
para compartírselo a quien necesite verlo (dashboard público vía link).

Problema que resuelve: centralizar en un solo lugar datos que hoy viven separados en
3 sistemas (Meta Ads, PostHog, iClosed/CRM) y que antes no se cruzaban — en particular,
saber cuántos de los leads que trae Meta son *reales* (schedules reales, vía iClosed)
vs ruido/spam, algo que Meta por sí solo no puede decir con certeza.

## 2. Stack y estructura de archivos

Sin build step, sin framework. Todo vive en 3 piezas:

| Pieza | Dónde vive | Qué es |
|---|---|---|
| **`index.html`** | `/Users/manueldorado/Claude Code/ssw-dashboard/index.html` (este repo) | El dashboard entero: HTML + CSS + JS inline, un solo archivo autocontenido. Usa Chart.js 4.4.1 desde cdnjs (única dependencia externa además del fetch de datos). |
| **`Code.gs`** | Vive de verdad en **Google Apps Script**, atado a la Google Sheet (Extensions → Apps Script desde la Sheet). Copia de referencia en este repo (`Code.gs`) para no perder el código entre sesiones — **si vas a editarlo, la fuente de verdad es Apps Script, no este archivo**; después de editar en Apps Script, traé la copia acá también. | Todo el backend: sync diario de Meta/PostHog hacia la Sheet, backfill histórico, helpers. |
| **Google Sheet** | `https://docs.google.com/spreadsheets/d/1uBEyQS2yW-RncHIHVOSb90ulAO6zmyDntgHXZ4gyVcg/edit` | Base de datos central. 3 tabs: `Meta_Raw`, `PostHog_Raw`, `iClosed_Raw`. Compartida como "Anyone with the link — Viewer" (el dashboard la lee vía la API pública de gviz, sin autenticación). |

**Cómo se conectan:** `index.html` corre 100% en el navegador de quien lo abra. Al cargar,
hace 3 fetches JSONP (`<script>` tag, patrón gviz) a la Google Sheet, uno por tab, arma
un dataset unificado en memoria (JS puro, sin backend propio), y renderiza todo con
Chart.js + DOM directo. **No hay servidor propio** — Vercel solo sirve el archivo estático,
Apps Script solo llena la Sheet, y el navegador de cada visitante hace el resto en vivo.

**Hosting / deploy:**
- Repo GitHub: `https://github.com/ManuelDoradoSSW/ssw-dashboard` (remote configurado por SSH: `git@github.com:ManuelDoradoSSW/ssw-dashboard.git` — ya autenticado, `git push` no pide nada).
- Vercel: proyecto conectado a ese repo, auto-deploya en cada push a `main`. **URL pública: `https://ssw-dashboard-nine.vercel.app`** — esta es la que se comparte.
- Flujo para publicar un cambio: editar `index.html` → `git add` + `git commit` (esto lo hace Claude) → el usuario corre `git push` → Vercel redeploya solo en ~10-20s.

## 3. Estado actual

**Terminado y funcionando (probado en vivo con datos reales):**
- Las 5 secciones originales: Big Numbers, Spend and Cost per Real MQL (chart), Creative
  Performance (tabla), Creative Table — Choose your Metrics (scatter), Funnel view.
- Filtros: barra de filtros **sticky** (`position: sticky; top: 0` en `#filters-card`,
  queda fija arriba al scrollear). Rango de fechas por **presets** (`#f-date-preset`):
  Last 7 days / Last 30 days / This Month / Last Month / Year to date / Custom (los
  date pickers "From"/"To" solo se muestran con Custom). Account/Campaign/Ad Set
  (multi-select con checkboxes, cascada entre sí).
- Comparación de períodos: checkbox "Compare" + modo "Previous period" o "Custom range"
  (con 2 date pickers propios). Deltas por tile con color según si subir es bueno o malo.
- **Dark mode manual**: checkbox "Dark mode" en los filtros pisa `prefers-color-scheme`
  vía atributo `data-theme` en `<html>` (`:root[data-theme="dark"]`/`="light"` con mayor
  especificidad que la media query), persistido en `localStorage` (`ssw-dashboard-theme`).
- **Password gate**: pantalla de bloqueo antes de mostrar el dashboard (contraseña
  `AccountSSW2026`, hardcodeada en el JS). Desbloqueo persistido en `sessionStorage`
  (`ssw-dashboard-unlocked`) — se vuelve a pedir si se cierra el navegador/tab. Es
  protección liviana del lado del cliente, **no seguridad real** (la password queda
  visible en "view source", y la Google Sheet detrás sigue siendo pública vía link) —
  el usuario lo sabe, lo pidió igual como filtro contra "alguien abre el link al azar".
- Big Numbers: 11 tiles en grid de 4 columnas — Spend, Clicks, CPM, CTR, Cost per 1K
  Reached, Frequency (estimated), Real MQLs (iClosed), Spam (iClosed), Cost per Real MQL,
  Qualified MQLs (iClosed), Cost per Qualified MQL. "Cost per 1K Reached" es el mismo
  cálculo que Meta llama "Cost per 1,000 Accounts Center Accounts Reached" (renombre de
  "cost per 1000 people reached", no es una métrica nueva) — `spend / reach * 1000`,
  ya calculable con los datos que trae Meta_Raw, **no requirió tocar Code.gs**.
- Spend chart: título con 2 `<select>` inline (look de heading, no de form control) para
  elegir qué métrica va en barra (izq) y cuál en línea (der), 9 métricas disponibles.
  Daily/Weekly toggle. Línea siempre visualmente por encima de las barras.
- Tabla Creative Performance: columnas "Creative" (thumbnail) y "Ad" fijas al scrollear
  horizontalmente. `table-layout: fixed` con anchos explícitos (evita que nombres largos
  rompan el layout). Fila se resalta (`tr.row-highlighted`) cuando se llega desde un
  click en el scatter (ver abajo).
- Scatter ("Choose your Metrics"): ejes X/Y elegibles (10 métricas, incluye Real MQL/
  Spam/Cost per Real MQL) + botón "Filter" (panel con Spend/Impressions/Clicks, mayor/
  menor que + valor). **Click en un punto** resalta esa fila en Creative Performance y
  hace scroll hasta ahí (compensando la altura de la barra de filtros sticky).
- Funnel: Impressions → Clicks → LP Views → Registrations (all MQLs, de iClosed) → Real MQL.
- Branding: logo SSW arriba, paleta violeta/verde, texto principal en amarillo Pantone
  `#E6C301` (dark mode).
- Apps Script: sync diario de Meta (10 días rolling) y PostHog (10 días rolling) vía
  triggers ya activos. Backfill histórico ya corrido (year-to-date, ~9,468 filas).
- Deploy: repo + Vercel funcionando, confirmado en vivo.
- **Light mode**: verificado visualmente varias veces esta sesión (filtros, tabla,
  highlight, Big Numbers) — se ve bien, ya no es un pendiente.

**A medias / no verificado:**
- `doGet()` en `Code.gs`: quedó de un intento anterior de hostear como Web App de Apps
  Script, **abandonado en favor de Vercel**. No rompe nada dejarlo, pero es código muerto.

**No implementado (fuera de alcance, por decisión):**
- Meta Schedules como métrica separada — se intentó pero Meta no expone Schedule vs
  Contact vs 2ndCallBooked por separado en la API cruda sin Custom Conversions
  configuradas en Ads Manager (ver sección 6). Se descartó explícitamente por pedido
  del usuario; el dashboard usa solo Real MQL de iClosed.
- Hold Rate — no hay datos de video retention disponibles en la fuente actual.
- Automatización de iClosed — sigue siendo 100% manual (el usuario pega el export).

## 4. Decisiones tomadas (no volver a discutir)

- **Grano de datos unificado**: Date × Account × Campaign × Ad Set × Ad. `Meta_Raw` es la
  tabla ancla; `PostHog_Raw` e `iClosed_Raw` se cruzan por Date+Ad.
- **Join key = Ad Name (texto)**, no ID. Se aceptó ese riesgo explícitamente (ver §6 para
  el manejo de encoding).
- **"Schedules" = Real MQL de iClosed (Yes), no evento de Meta.** Meta trae el dato via
  CAPI pero no es confiable 1:1 por delay/sobre-atribución — decisión tomada al principio
  del proyecto y reconfirmada cuando se descubrió la limitación de Custom Conversions.
- **Registrations (funnel) = suma de Yes+No+Blank de iClosed**, no el campo `registrations`
  de Meta — se cambió a mitad de sesión porque con el campo de Meta el funnel quedaba
  no-monotónico (Real MQL > Registrations en algunos filtros).
- **Bounce Rate** = mismo cálculo que el nativo de PostHog Web Analytics (sesión con ≤1
  pageview, sin autocapture, <10s) — se llega a esto vía la queries `WebStatsTableQuery`
  (el mismo query kind que usa la UI de PostHog por dentro), NO reinventando la fórmula
  a mano (un intento anterior con HogQL manual daba resultados incorrectos).
- **Paleta**: violeta (`#4a3aa7` light / `#9085e9` dark) reemplaza al azul, verde (`#008300`)
  reemplaza al naranja/rojo — pedido explícito de branding SSW. Texto principal en dark
  mode: amarillo Pantone `#E6C301` (también pedido de branding). Metodología de paleta
  categórica/secuencial sigue la skill `dataviz` del proyecto, con estos valores
  sobrescritos a mano para SSW (no se re-corrió el validador tras el cambio de marca,
  es un pedido estético puntual, no un rediseño completo).
- **Ventana de sync diario = 10 días** (no todo el historial) para no gastar cuota/tiempo
  de la API de Meta todos los días. El historial completo se trae con `backfillMeta`
  (manual, corrido una vez, trae year-to-date).
- **Reach/Frequency sumados por día**: aproximación conocida y documentada en el caveat
  visible del dashboard (Meta dedupea reach solo dentro de un rango, no al sumar días).
- **Hosting**: Vercel + GitHub, no Apps Script Web App (se armó esto último primero pero
  se migró a Vercel por pedido del usuario — más apropiado para un sitio 100% estático).
- **Auth de git**: SSH (no HTTPS+token) — se configuró así después de fricción real con
  tokens durante el setup. Clave ya en GitHub (título "SSW Dash Key").

## 5. Fuente de datos — detalle técnico

**Google Sheet**: ID `1uBEyQS2yW-RncHIHVOSb90ulAO6zmyDntgHXZ4gyVcg`.
Fetch desde el HTML vía gviz JSONP:
```
https://docs.google.com/spreadsheets/d/1uBEyQS2yW-RncHIHVOSb90ulAO6zmyDntgHXZ4gyVcg/gviz/tq?tqx=out:json;responseHandler:CALLBACK&sheet=TABNAME&_=timestamp
```
Los headers reales de cada sheet están en la fila 1 de datos (no en la metadata `cols` de
gviz, que viene vacía) — el parser lee por **posición fija de columna**, no por nombre.

**`Meta_Raw`** (15 columnas, en este orden):
`Date, Account, Campaign, Ad Set, Ad, Spend, Impressions, Clicks, Reach, Frequency, LP Views, Registrations, Schedules (Meta), Video Views, Thumbnail URL`
— llenada por `syncMeta()` / `backfillMeta()` en Code.gs.

**`PostHog_Raw`** (4 columnas): `Date, Ad, Sessions, Bounced Sessions` — llenada por `syncPostHog()`.
("Sessions" en realidad son "Visitors" de PostHog — funciona igual para el cálculo, ver comentario en el código.)

**`iClosed_Raw`** (7 columnas, desde 2026-08-06): `Date, Account, Campaign, Ad Set, Ad,
Real MQL, Lead Score` — **manual, el usuario pega el export de iClosed acá**. `Real MQL`
es texto `YES` / `NO` / vacío (vacío = contactos de antes del 14/6/2026 cuando no existía
el campo, o algún hueco posterior). `Lead Score` (columna G, agregada 2026-08-06) es texto
libre -- "Qualified" = cualquier valor no vacío que no contenga "LOW" (cubre "Quality",
"High Quality", etc.); vacío o "Low Quality" no cuenta. Da la métrica "Qualified MQL",
**independiente de Real MQL** (no es un subconjunto de Real MQL=Yes) -- por eso en data
vieja hay filas con Lead Score de calidad y Real MQL vacío (la columna Real MQL no existía
antes del 14/6/2026), lo cual está documentado en un caveat visible en el dashboard, no es
un bug. `Account` casi siempre viene vacío (iClosed no lo trae) — el dashboard lo completa
automáticamente cruzando `Campaign` contra `Meta_Raw` cuando puede.

**IMPORTANTE — posición fija de columnas**: el parser de `iClosed_Raw` lee por índice
(`r.c[6]` para Lead Score), no por nombre de header. Si en algún momento se agrega otra
columna a este tab, tiene que ir **al final** (columna H en adelante) — insertarla en
el medio corre todo lo que viene después y rompe el join.

**Meta Ads — 3 cuentas:**
| Nombre | Account ID |
|---|---|
| SSW \| 2026 | `act_994485823231431` |
| So Shall We USA | `act_2344085889130673` |
| New Account SSW \| 2026 | `act_1626400979496060` |

Tracking template de Meta (confirmado con el usuario):
`utm_source=fb_ad&utm_medium={{adset.name}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&fbc_id={{adset.id}}&h_ad_id={{ad.id}}`
— o sea, Campaign/Ad Set/Ad de Meta_Raw **son** los UTMs literales (utm_campaign/utm_medium/utm_content).

**PostHog**: host `us.posthog.com`, project ID `462623`. Bounce filtrado por
`$entry_utm_source = 'fb_ad'`, breakdown por `InitialUTMContent`.

**Apps Script Script Properties** (ya configuradas, no hay que tocarlas salvo rotación):
`META_TOKEN` (System User token, scope `ads_read`, confirmado **sin expiración**),
`POSTHOG_API_KEY` (Personal API Key, scope Query), `POSTHOG_PROJECT_ID` = `462623`,
`POSTHOG_HOST` = `https://us.posthog.com`.

**Triggers activos en Apps Script**: `syncMeta` diario 3am, `syncPostHog` diario 4am
(creados con `createTriggers()`, ya corrido).

## 6. Problemas conocidos / bugs abiertos

- **Meta "Schedules" no se puede aislar por API** sin crear Custom Conversions en Meta
  Ads Manager para "Schedule", "Contact" y "2ndCallBooked" (hoy los 3 vienen mezclados
  bajo `offsite_conversion.fb_pixel_custom`). Si en algún momento se crean esas Custom
  Conversions en Ads Manager, ahí sí se podría retomar "Meta Schedules" como métrica
  separada — hoy está deliberadamente sacada del dashboard.
- **Encoding de iClosed**: el export de iClosed trae `Ad`/`Campaign`/`Ad Set` con espacios
  codificados como `+` (ej: `SSW_ADV+_ACQ.COM...+-+Copy+2`), y a veces varios ads separados
  por coma en una sola celda (multi-touch). Ya resuelto con un algoritmo de crosscheck
  (`buildAdCrosscheck`/`resolveAdName` en el HTML) que compara contra los nombres reales
  de Meta para decodificar sin romper "+" legítimos (ej "ADV+"). Con esto, de ~690 filas
  sin match, solo queda 1 genuina sin resolver (el resto son de fuera de la ventana de
  10 días de Meta_Raw, esperable) — pero si aparecen MUCHAS filas nuevas sin match al
  revisar `console.warn` del navegador, revisar si cambió el formato de export de iClosed.
- **Light mode sin verificar** (ver §3).
- **`doGet()` vestigial** en Code.gs, sin usar (ver §3) — se puede borrar cuando se toque
  el archivo de nuevo, no es urgente.
- El panel de navegador usado para testing esta sesión (Claude Browser pane) tuvo
  screenshots en negro intermitentes — es un problema de la herramienta, no del código
  (se verificó todo por inspección JS/DOM directa como respaldo). Si se repite en la
  próxima sesión, no asumir que es un bug del dashboard sin verificar por consola/JS primero.

## 7. Próximos pasos

No hay pedidos pendientes del usuario a esta fecha — todo lo solicitado está implementado,
commiteado, y pusheado (repo `ssw-dashboard` está "up to date with origin/main"). Si el
usuario vuelve con más pedidos, el flujo es:

1. Leer este HANDOFF.md primero.
2. Editar `/Users/manueldorado/Claude Code/ssw-dashboard/index.html` directo (es el mismo
   archivo que sirve Vercel).
3. Probar en un servidor local (`python3 -m http.server` en esa carpeta) + Browser pane
   antes de dar por terminado cualquier cambio — este proyecto tiene antecedentes de bugs
   sutiles (table-layout, z-order de charts, encoding) que solo se detectaron probando en
   vivo, no revisando el código a ojo.
4. Hacer `git add`/`git commit` (esto lo hace Claude), y decirle al usuario que corra
   `git push` (él lo hace, ya tiene SSH configurado, no debería pedir nada).
5. Si el pedido es sobre `Code.gs` (Apps Script): recordar que la fuente de verdad vive
   en el editor de Apps Script (atado a la Sheet), no en este repo — palenta el nuevo
   código ahí primero (Cmd+A, borrar, pegar completo — el usuario tuvo problemas antes
   pegando parches parciales), y después traer la copia actualizada a este repo también.

Pendiente opcional (no pedido, solo sugerido si surge la oportunidad):
- Limpiar `doGet()` de Code.gs si se vuelve a tocar ese archivo.
- Si el volumen de datos sigue creciendo mucho (Meta_Raw ya tiene ~9,500 filas), vigilar
  que Google Sheets no se ponga lento — no es un problema todavía.
- Qualified MQL / Cost per Qualified MQL hoy solo están en Big Numbers -- si el usuario
  los quiere también en la tabla Creative Performance o como métrica del scatter, es
  agregar `mqlQualified`/`cpqmql` a `aggregateByAd()`, la tabla, y `METRIC_OPTIONS`
  (mismo patrón que `mqlYes`/`mqlNo`/`cpsch`).

## 8. Convenciones de código

- **Vanilla JS, sin build step, sin dependencias además de Chart.js (CDN).** Un solo
  archivo HTML autocontenido — no dividir en múltiples archivos ni agregar bundler.
- **CSS**: custom properties (`--variable`) para todo color/tema, definidas en `:root` y
  sobrescritas en `@media (prefers-color-scheme: dark)`. Nunca hardcodear un hex fuera de
  la definición de la variable.
- **Formato de números centralizado**: `fmtMoney`, `fmtInt`, `fmtDec`, `fmtPct`, y el
  dispatcher `fmtByType(value, fmtKey)` — usar estas funciones, no formatear a mano.
- **Comentarios**: solo para el "por qué" no obvio (ej: por qué existe el
  `lineOnTopPlugin`, por qué `resolveAdName` hace lo que hace). Nunca comentar el "qué".
  Nombres de variables/funciones deben ser suficientemente claros por sí solos.
- **Apps Script (`Code.gs`)**: funciones planas (sin clases), secrets siempre vía
  `PropertiesService`, nunca hardcodeados. Llamadas a APIs externas usan
  `fetchJsonWithRetry` (reintentos con backoff exponencial) para tolerar rate limits de
  Meta. Fetches de rango largo (backfill) se parten **por mes** con `Utilities.sleep`
  entre cada uno — NO hacer un solo fetch de un rango de meses (ya causó "Service
  temporarily unavailable" antes de partirlo así).
- **IDs HTML**: kebab-case (`spend-metric-1`, `scatter-filter-btn`). JS: camelCase.
- **Antes de dar un cambio por terminado**: siempre levantar un server local y probar en
  el Browser pane (no alcanza con leer el código) — este dashboard tuvo varios bugs que
  solo aparecían en el navegador real (ver §6).
