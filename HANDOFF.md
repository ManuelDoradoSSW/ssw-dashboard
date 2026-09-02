# HANDOFF — SSW Account Dashboard (Meta Ads)

Last updated: 2026-08-19. Written for a fresh Claude session to pick this up with zero prior context.

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
  Today / Yesterday / Last 7 days / Last 14 days / Last 30 days / This Month / Last Month / Year to date / Custom (los
  date pickers "From"/"To" solo se muestran con Custom). Account/Campaign/Ad Set
  (multi-select con checkboxes, cascada entre sí). Cada multi-select tiene un **buscador**
  (`buildMultiSelect()`, campo `.msel-search`) que filtra la lista en vivo mientras se
  escribe -- se agregó porque Campaign/Ad Set pueden tener muchas opciones y scrollear se
  hacía incómodo. Se enfoca solo al abrir el dropdown y se resetea al reabrir; "All"/"Clear"
  siempre operan sobre la lista completa, no sobre lo que está filtrado por el buscador.
- Comparación de períodos: checkbox "Compare" + modo "Previous period" o "Custom range"
  (con 2 date pickers propios). Deltas con color según si subir es bueno o malo. Aplica a
  **Big Numbers, la tabla Performance per y la tabla Creative Performance** (extendido 2026-08-21):
  cada celda numérica muestra su valor y debajo el delta % vs el período de comparación, matcheado
  por entidad (Performance per) / por ad (Creative Performance). Helpers compartidos:
  `getCompareRange()`, `cellDeltaHtml()`, `metricCell()`, `METRIC_DIRECTION` (dirección good/bad
  por métrica). Los handlers de Compare llaman `renderAll()` (no solo Big Numbers) para refrescar
  las tablas. Ad/entidad nueva en el período actual muestra "new"; Bounce Rate sin sesiones "—" sin delta.
- **Dark mode manual**: checkbox "Dark mode" en los filtros pisa `prefers-color-scheme`
  vía atributo `data-theme` en `<html>` (`:root[data-theme="dark"]`/`="light"` con mayor
  especificidad que la media query), persistido en `localStorage` (`ssw-dashboard-theme`).
- **Password gate**: pantalla de bloqueo antes de mostrar el dashboard (contraseña
  `AccountSSW2026`, hardcodeada en el JS). Desbloqueo persistido en `sessionStorage`
  (`ssw-dashboard-unlocked`) — se vuelve a pedir si se cierra el navegador/tab. Es
  protección liviana del lado del cliente, **no seguridad real** (la password queda
  visible en "view source", y la Google Sheet detrás sigue siendo pública vía link) —
  el usuario lo sabe, lo pidió igual como filtro contra "alguien abre el link al azar".
- Big Numbers: 12 tiles en 2 grupos con sub-header (`.bignum-group`), grid
  `auto-fit minmax(150px,1fr)`. **Media** (7): Spend, Clicks, CPM, CTR, Cost per 1000 Meta
  Accounts (estimated), Frequency (estimated), Funnel Conversion Rate. **Lead Quality
  (iClosed)** (5): Real MQLs, Spam, Cost per Real MQL, Qualified MQLs, Cost per Qualified
  MQL. Solo el valor numérico de cada tile usa el color de acento (`var(--accent)`, dorado)
  -- labels/headers/botones usan `--text-primary` (neutro), a propósito, para que no todo
  grite al mismo volumen (pedido de rediseño 2026-08-07).
  "Cost per 1000 Meta Accounts" es el mismo cálculo que Meta llama oficialmente "Cost per
  1,000 Accounts Center Accounts Reached" (renombre de "cost per 1000 people reached", no
  es una métrica nueva) — `spend / reach * 1000`, ya calculable con Meta_Raw, no requirió
  tocar Code.gs. **Frequency se había sacado de Big Numbers el 2026-08-07 por el sesgo de
  Reach sumado por día (ver §6), pero se volvió a agregar el mismo día** a pedido del equipo
  (Sam/Josh en Slack) -- el equipo prefiere tenerlo como estimado etiquetado antes que no
  tenerlo. **"Cost per 1000 Meta Accounts" sufre el mismo sesgo** (Sam reportó $57 vs ~$450
  calculado a mano) -- no es un bug de código, es la misma causa que Frequency. Se le agregó
  el sufijo "(estimated)" al label en vez de sacarlo, mismo criterio. **"Funnel Conversion
  Rate"** = `mqlYes / lpViews`, pedido por Josh (page views → booked appointments) -- ojo,
  **no es Registrations** (`mqlYes+mqlNo+mqlBlank`): se probó esa versión primero (con el
  label "LP View to Real MQL Rate") pero Manu aclaró que "booked appointment" en su negocio
  es específicamente Real MQL (Registrations incluye spam, que no es un booking real) --
  se corrigió la fórmula y se volvió a renombrar a "Funnel Conversion Rate". Todo lo de
  arriba (Cost per 1000/Frequency) sigue con el mismo sesgo en el chart-select/tabla/scatter,
  no solo en Big Numbers.
- **Tooltips de fórmula en Big Numbers**: los 7 tiles calculados (CPM, CTR, Cost per 1000
  Meta Accounts, Frequency, Funnel Conversion Rate, Cost per Real MQL, Cost per Qualified
  MQL) muestran su fórmula al pasar el mouse. **Usa un tooltip CSS propio** (`data-tooltip`
  + `::after`), NO el atributo `title` nativo del navegador -- se probó con `title` primero
  y no se veía consistente (el usuario confirmó que no le aparecía). Si se agregan más
  tiles calculados, seguir este mismo patrón (`data-tooltip="fórmula"` en el `.bignum-tile`).
- Spend chart: **es un solo chart combinado bar+line con doble eje** (`chart-spend`,
  `yAxisID: 'y'/'y1'`, `lineOnTopPlugin` para que la línea quede siempre visualmente
  arriba de las barras) -- se intentó partir en dos charts de un solo eje (mejor práctica
  de dataviz, ver `references/anti-patterns.md` de la skill `dataviz`) pero el usuario lo
  pidió de vuelta combinado explícitamente: quiere comparar 2 variables superpuestas para
  ver tendencias de un vistazo, prioriza eso por sobre la corrección de doble-eje. **No
  volver a proponer separarlo.** Sí se le bajó la opacidad al color de las barras (violeta
  con alpha, `s1 + '99'`) para que la línea se lea mejor por encima. Título con 2 `<select>`
  inline para elegir métrica de barra/línea, 11 métricas disponibles (incluye Qualified
  MQL/Cost per Qualified MQL). Daily/Weekly toggle.
- Tabla Creative Performance: columnas "Creative" (thumbnail) y "Ad" fijas al scrollear
  horizontalmente. `table-layout: fixed` con anchos explícitos (evita que nombres largos
  rompan el layout). Fila se resalta (`tr.row-highlighted`) cuando se llega desde un
  click en el scatter (ver abajo). Caveat chico (no bold) al lado del título con la fecha
  real desde la que hay data de PostHog para Bounce Rate, calculada dinámicamente.
- Scatter ("Choose your Metrics"): ejes X/Y elegibles (11 métricas, incluye Real MQL/
  Spam/Cost per Real MQL/Qualified MQL/Cost per Qualified MQL) + botón "Filter" (panel
  con Spend/Impressions/Clicks, mayor/menor que + valor). **Click en un punto** resalta
  esa fila en Creative Performance y hace scroll hasta ahí (compensando la altura de la
  barra de filtros sticky).
- Funnel: Impressions → Clicks → LP Views → Registrations (all MQLs, de iClosed) → Real MQL
  → **Booked** (paso agregado 2026-08-19, en verde `--series-2` para distinguirlo del gradiente
  violeta; Booked ⊆ Real MQL así que el funnel sigue monotónico). **El largo de barra es
  LOGARÍTMICO** (`log10`), no lineal (2026-08-21): el rango va de ~136k impresiones a ~12 bookings,
  y en lineal MQL/Booked quedaban slivers invisibles -- con log cada etapa se ve y sigue
  angostando. Barras centradas (`margin:0 auto`) para el look de embudo. Los conteos y el % de
  conversión al costado son los valores exactos; hay un caveat visible que aclara la escala log.
  **Resaltado qualified (2026-08-26)**: dentro de la barra Real MQL se resalta en CELESTE
  (`--qual-highlight`, pegado al borde DERECHO de la barra) la porción que son Real MQL **y**
  qualified (Lead Score A/B) -- `ic.realMqlQual`, que es la INTERSECCIÓN (mql yes && qualified), NO
  el `mqlQualified` standalone (que es independiente de Real MQL) -- con una aclaración al lado
  ("Qualified Lead: N (%)"). Ídem la barra Booked resalta los Qualified Bookings (`ic.qbooked` ->
  "Qualified Booking: N (%)"). El ancho del resaltado es fracción LINEAL de esa barra (qual/valor),
  no log. Clases: `.funnel-bar-qual` / `.funnel-qual-note`; color celeste `--qual-highlight` en los
  4 bloques de tema (#1f8fd0 light / #56b6e8 dark).
- **Qualified MQL**: `iClosed_Raw` pasó a 7 columnas (se agregó `Lead Score` como columna G,
  2026-08-06) — "Quality"/"High Quality"/similar = qualified, vacío o "Low Quality" no
  cuenta (ver §5 para el detalle exacto de la regla). Métrica independiente de Real MQL,
  no un subconjunto.
- **Bookings / Cost per Booking** (agregado 2026-08-19): métrica **por contacto** que sale de
  2 columnas nuevas de `iClosed_Raw` (H `Scheduling status`, I `Event` — ver §5). Un contacto
  cuenta como Booked si **Real MQL = Yes** Y **Scheduling status = DISCOVERY_CALL_BOOKED** Y
  el Event contiene "Call A" pero **NO** "Call B" (si agendó ambas, o solo la B, no cuenta).
  Real MQL=Yes es un gate estricto **por decisión explícita del usuario** (ver §4) -- deja
  afuera ~113 filas que cumplen las otras 2 condiciones pero tienen Real MQL en blanco (mayoría
  bookings anteriores al 14/6/2026, cuando no se trackeaba Real MQL) o en "No" (spam). Por eso
  Bookings se ve bajo en rangos largos/YTD; en Last 7/30 casi no se nota. Se agregó a Big Numbers
  (2 tiles en Lead Quality), al selector del Spend chart, a la tabla Creative Performance, a la
  tabla Performance per, al scatter, y como paso del funnel. Sigue la misma lógica dual que Real
  MQL: contactos deduplicados (`ICLOSED_CONTACTS`) en Big Numbers/Funnel/chart/Performance-per,
  por-ad (`aggregateByAd`) en Creative Performance/scatter. `booked` se lleva en cada contacto
  igual que `mql`/`qualified`.
- **Qualified Bookings / Cost per Qualified Booking** (agregado 2026-08-26): igual que Booking pero
  el contacto además tiene que ser qualified (Lead Score A o B) -- `qbooked = booked && qualified`
  (key `qbooked`/`cpqbooking`). Se agregó en TODOS los lugares donde está Booking (Big Numbers, Spend
  chart, Creative Performance, Performance per, scatter) y como resaltado del funnel (ver arriba).
  Misma lógica dual que Booking.
- **Tabla "Performance per"** (agregada 2026-08-19): card entre el Spend chart y Creative
  Performance. Selector inline en el título (Account/Campaign/Ad Set, default Account, mismo
  patrón que los selects del Spend chart) que desglosa TODOS los Big Numbers por la entidad
  elegida. Sigue los filtros de arriba y es ordenable por cualquier columna. Métricas de Meta
  se suman de `UNIFIED`; las de iClosed cuentan contactos deduplicados contándolos una vez por
  cada entidad tocada (por eso las filas pueden sumar más que Big Numbers, igual que Creative
  Performance). Fila `(unattributed)` = contactos de iClosed cuyo ad no matchea Meta_Raw.
  Funciones: `computePerfRows()`/`renderPerfTable()`/`setupPerfTable()` + `PERF_COLUMNS`.
- **Big Numbers en "burbujas"** (2026-08-19): cada `.bignum-tile` es una caja recesada
  (`background: var(--surface-2)` sobre el `--surface-1` de la card, borde `--border`, radio
  12px), con hover que la tiñe de violeta (`--highlight-bg`) + borde `--series-1` + sombra.
  Solo variables temáticas, sin colores nuevos.
- Branding: logo SSW arriba, paleta violeta/verde. El dorado (`--accent`, `#E6C301` dark /
  `#8a6a00` light) está **reservado** para el h1 y los valores de Big Numbers/chart-select
  -- no es el color de texto por default (eso cambió en el rediseño del 2026-08-07, antes
  todo el texto en dark mode era dorado).
- Apps Script: sync diario de Meta (10 días rolling) y PostHog (10 días rolling) vía
  triggers ya activos. Backfill histórico de Meta y de **PostHog** ya corridos (ver §6).
  `doGet()` (Web App vestigial) se eliminó de `Code.gs` el 2026-08-07 -- ya no existe.
- Deploy: repo + Vercel funcionando, confirmado en vivo.
- **Light mode**: verificado visualmente varias veces — se ve bien, no es un pendiente.

**No implementado (fuera de alcance, por decisión):**
- Meta Schedules como métrica separada — se intentó pero Meta no expone Schedule vs
  Contact vs 2ndCallBooked por separado en la API cruda sin Custom Conversions
  configuradas en Ads Manager (ver sección 6). Se descartó explícitamente por pedido
  del usuario; el dashboard usa solo Real MQL de iClosed.
- Hold Rate — no hay datos de video retention disponibles en la fuente actual.
- Automatización de iClosed — **en curso**, ver §7 (no es ya un "fuera de alcance", es un
  trabajo activo a mitad de camino).

## 4. Decisiones tomadas (no volver a discutir)

- **Grano de datos unificado**: Date × Account × Campaign × Ad Set × Ad. `Meta_Raw` es la
  tabla ancla; `PostHog_Raw` e `iClosed_Raw` se cruzan por Date+Ad.
- **Dos fuentes distintas para Real MQL/Spam/Qualified MQL, a propósito, NO es duplicación
  de código a limpiar**: `UNIFIED`/`icRows` (explotado por ad, un contacto multi-touch genera
  varias filas) alimenta **Creative Performance / scatter / `aggregateByAd()`**, donde cada
  ad tiene que recibir crédito. `ICLOSED_CONTACTS` (deduplicado por `icRowId`, un elemento
  por contacto real) alimenta **Big Numbers / Funnel / métricas de MQL del Spend chart**,
  donde lo que importa es "cuántos contactos reales hay", no "cuántas combinaciones
  contacto×ad hay". Sumar `UNIFIED` directo para un total de cuenta duplica cualquier
  contacto multi-touch (bug real, reportado y arreglado 2026-08-08 -- ver §6). Si se agrega
  una métrica nueva de Real MQL/Spam/Qualified MQL en cualquier lado, primero preguntarse:
  ¿es un total de cuenta (usar `ICLOSED_CONTACTS`/`sumIClosedContacts`) o es por-ad (usar
  `UNIFIED`/`aggregateByAd`)?
- **Atribución de cada touch = por SUS PROPIOS utm (utm_campaign / utm_medium=ad set), NO por
  ad name/date+ad** (REESCRITO 2026-08-21 -- reemplaza el enfoque date+ad anterior, que estaba
  MAL). Contexto: el tracking template pone `utm_campaign={{campaign.name}}`,
  `utm_medium={{adset.name}}`, `utm_content={{ad.name}}`, así que iClosed trae campaña/ad set/ad
  exactos por touch (comma-joined en multi-touch, alineados por posición). En `icRows` se parten
  las 3 columnas (`campaignCandidates`/`adsetCandidates`/`adCandidates`) y se resuelve cada touch
  con `resolveByCrosscheck` contra los nombres reales de Meta (`campaignCrosscheck`/`adsetCrosscheck`,
  que revierten el encoding "+"); account se deriva de la campaña (`campaignToAccount`). El
  `contactMap` usa directamente ese account/campaign/adset por-touch (ya NO existe `metaKeyMap`
  ni cruce date+ad). **Por qué cambió:** el enfoque viejo (resolver contra Meta_Raw por date+ad)
  fallaba porque **el mismo creative corre en varios ad sets/campañas** -- `metaKeyMap` keyed por
  date+ad elegía uno arbitrario (último gana) y mal-atribuía. Reportado por el usuario: 2 Real MQL
  que iClosed marca en `ACQ.COM_BestPerformers` aparecían bajo `EZELIST_BestPerformers`. Confirmado
  trazando los contactos y arreglado en vivo (EZELIST pasó de 2 a 0, los 2 se movieron a ACQ.COM).
  Esto TAMBIÉN cubre el viejo bug de "Big Numbers da 4, Creative da 6" (campaña multi-touch), ahora
  vía split de campaña + crosscheck en vez del workaround date+ad. Los touches sin utm resoluble
  (ej. ad con el macro `{{campaign.name}}` sin expandir, o sin utm) quedan como su propia fila --
  es un problema de setup del ad en Meta, se ve pero no se inventa atribución.
- **Join key = Ad Name (texto)**, no ID. Se aceptó ese riesgo explícitamente (ver §6 para
  el manejo de encoding).
- **"Schedules" = Real MQL de iClosed (Yes), no evento de Meta.** Meta trae el dato via
  CAPI pero no es confiable 1:1 por delay/sobre-atribución — decisión tomada al principio
  del proyecto y reconfirmada cuando se descubrió la limitación de Custom Conversions.
- **Booked exige Real MQL = Yes (gate estricto), NO cuenta blancos ni "No"** (decisión
  explícita del usuario 2026-08-19, tras mostrarle el trade-off con números). De las 128 filas
  que cumplen Discovery Call Booked + solo Call A, solo 15 tienen Real MQL=Yes; 16 son "No"
  (spam que agendó igual) y 97 están en blanco (95 de ellas anteriores al 14/6/2026, cuando no
  se trackeaba Real MQL). El usuario eligió el criterio estricto sabiendo que deja Bookings
  bajo en rangos largos. NO cambiar a "contar blancos" salvo pedido explícito. Se le ofrecieron
  3 variantes (solo-Yes / excluir-solo-spam / sin-chequeo) y eligió solo-Yes.
- **Registrations (funnel) = suma de Yes+No+Blank de iClosed**, no el campo `registrations`
  de Meta — se cambió a mitad de sesión porque con el campo de Meta el funnel quedaba
  no-monotónico (Real MQL > Registrations en algunos filtros).
- **Bounce Rate** = mismo cálculo que el nativo de PostHog Web Analytics (sesión con ≤1
  pageview, sin autocapture, <10s) — se llega a esto vía la queries `WebStatsTableQuery`
  (el mismo query kind que usa la UI de PostHog por dentro), NO reinventando la fórmula
  a mano (un intento anterior con HogQL manual daba resultados incorrectos).
- **Paleta**: violeta (`#4a3aa7` light / `#9085e9` dark) reemplaza al azul, verde (`#008300`)
  reemplaza al naranja/rojo — pedido explícito de branding SSW. Amarillo Pantone `#E6C301`
  (también pedido de branding) vive en `--accent`, **reservado** para el h1 y los valores
  numéricos de Big Numbers/chart-select -- NO es el color de texto por default (eso se
  corrigió en el rediseño del 2026-08-07: antes `--text-primary` era el amarillo y todo el
  texto de la UI en dark mode gritaba al mismo volumen; ahora `--text-primary` es un
  neutro casi-blanco y el amarillo quedó solo para lo que realmente es un dato destacado).
  Metodología de paleta categórica/secuencial sigue la skill `dataviz` del proyecto, con
  estos valores sobrescritos a mano para SSW (no se re-corrió el validador tras el cambio
  de marca, es un pedido estético puntual, no un rediseño completo del sistema de color).
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

**`iClosed_Raw`** (9 columnas, desde 2026-08-19): `Date, Account, Campaign, Ad Set, Ad,
Real MQL, Lead Score, Scheduling status, Event` — **manual, el usuario pega el export de
iClosed acá**. `Real MQL`
es texto `YES` / `NO` / vacío (vacío = contactos de antes del 14/6/2026 cuando no existía
el campo, o algún hueco posterior). `Lead Score` (columna G, agregada 2026-08-06) tiene 3
opciones reales confirmadas contra la Sheet: `"A: High Quality"`, `"B: Quality"`,
`"C: Low Quality"`. "Qualified" = empieza con `"A:"` o `"B:"` (lista explícita, no un filtro
de "no contiene LOW" -- se cambió a pedido del usuario 2026-08-08 para no depender de que
la palabra "Low" aparezca si en el futuro se agrega una opción nueva). Da la métrica "Qualified MQL",
**independiente de Real MQL** (no es un subconjunto de Real MQL=Yes) -- por eso en data
vieja hay filas con Lead Score de calidad y Real MQL vacío (la columna Real MQL no existía
antes del 14/6/2026), lo cual está documentado en un caveat visible en el dashboard, no es
un bug. `Account` casi siempre viene vacío (iClosed no lo trae) — el dashboard lo completa
automáticamente cruzando `Campaign` contra `Meta_Raw` cuando puede.

`Scheduling status` (columna H, `r.c[7]`, agregada 2026-08-19): texto tipo `DISCOVERY_CALL_BOOKED`,
`POTENTIAL`, `QUALIFIED` (mayúsculas con guiones bajos). `Event` (columna I, `r.c[8]`): nombre(s)
de la(s) call(s) agendada(s), varios separados por coma en un solo campo (ej. `SSW Assessment
Call B, SSW Assessment Call A`). Las dos alimentan la métrica **Booked** (ver §3): el parser
normaliza el status (`.toUpperCase().replace(/[\s_]+/g,' ')` → compara contra `DISCOVERY CALL
BOOKED`) y testea el Event con `/\bCALL A\b/` y `/\bCALL B\b/`. Booked = Real MQL Yes + status
booked + tiene Call A + NO tiene Call B. Confirmado con re-parse del sheet crudo (15 bookings,
matchea el modelo del dashboard).

**IMPORTANTE — posición fija de columnas**: el parser de `iClosed_Raw` lee por índice
(`r.c[6]` Lead Score, `r.c[7]` Scheduling status, `r.c[8]` Event), no por nombre de header.
Si en algún momento se agrega otra columna a este tab, tiene que ir **al final** (columna J en
adelante) — insertarla en el medio corre todo lo que viene después y rompe el join.

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
`POSTHOG_HOST` = `https://us.posthog.com`, `ICLOSED_API_KEY` (agregada 2026-08-07, para
la automatización en curso -- ver §7).

**Triggers activos en Apps Script**: `syncMeta` diario 3am, `syncPostHog` diario 4am
(creados con `createTriggers()`, ya corrido).

**iClosed API** (para la automatización en curso, ver §7 para el estado):
- Base URL: `https://public.api.iclosed.io`. Auth: header `Authorization: Bearer <key>`.
- Spec pública completa: `https://developer.iclosed.io/` (OpenAPI en
  `https://api-docs-iclosed.redocly.app/_bundle/openapi/v1/openapi.json`, es un Redoc SPA,
  para leerla de una hay que bajar el JSON directo, no funciona hacer WebFetch a la URL
  del Redoc porque el contenido se renderiza client-side).
- `GET /v1/eventCalls` (filtros `eventType=PAST`, `dateFrom`/`dateTo` sobre `dateTime`,
  `limit`/`page` paginado máx 100/page) da `contactId`, `dateTime`, y `utm` (array
  `{utmKey,utmValue}` -- filtrar por `utm_source`/`utm_medium`/`utm_campaign`/`utm_content`,
  el resto es ruido de tracking de Meta/browser). **OJO: esto NO es la fuente correcta para
  el sync** -- fechar por "cuándo ocurrió la llamada" undercuenta leads que todavía no
  tuvieron su call (ver §7, confirmado con data real: 17 vs 29 esperados en una ventana de
  prueba). También trae `task[].outcome` (WON/NO_SALE/QUALIFIED/UNQUALIFIED/PENDING/
  APPROVED/REJECTED/PENDING_OUTCOME) -- no se usa para Real MQL (es un custom field aparte),
  pero podría servir a futuro para "Show Rate" (ver pendiente en §7).
- **La fuente correcta es `GET /v1/contacts`** (lista, filtrable por `timeFrom`/`timeTo`
  sobre `joinedTime` -- esto sí matchea "Contact Creation Date" del export manual), y por
  cada contacto de esa lista pedir `/v1/contacts/detail?contactId=X` para sacar `referrerUrl`
  (UTM de un solo touch, hay que parsear el query string) + los custom fields. Ver §7 para
  el estado exacto de la reescritura.
- Endpoint para Real MQL / Lead Score: `GET /v1/contacts/detail?contactId=X` (un contacto
  a la vez, sin endpoint bulk) → `data.CustomFieldAssociation[]`, filtrar por
  `customField.identifier === 'real-mql'` / `'lead-score'` y leer `CustomFieldAnswer[0].answer`.
  Son campos a nivel **CONTACTO** (`customField.type: "CONTACT"`), no de la llamada -- por
  eso no aparecen en `/v1/eventCalls`. Detalle completo del mapeo y la implementación real
  en `syncIClosed()`/`fetchIClosedContactFields()`/`buildIClosedRow()` en `Code.gs` (§7).

## 6. Problemas conocidos / bugs abiertos

- **Atribución de Real MQL por ad set/campaña estaba MAL** (RESUELTO 2026-08-21): ver la
  decisión reescrita en §4. Se atribuía cada touch cruzando `date+ad` contra Meta_Raw, pero el
  mismo creative corre en varios ad sets/campañas, así que se elegía uno arbitrario. Ahora se
  atribuye por los utm propios de cada touch (utm_campaign/utm_medium). Reportado por el usuario
  (EZELIST mostraba 2 Real MQL que en realidad eran de ACQ.COM). NO revertir a date+ad.
- **`dataRows()` descartaba la primera fila real de cada Sheet** (RESUELTO 2026-08-21): hacía
  `.slice(1)` asumiendo que rows[0] era el header, pero gviz mete los headers en `cols` y devuelve
  rows[0] = dato real -- se perdía 1 fila por tab (1 ad de Meta_Raw, 1 contacto de iClosed, etc.).
  Ahora filtra por la columna Date (col 0 = `Date(...)` en datos, `"Date"` en el header), robusto a
  cómo gviz devuelva el header. Recuperó ~1 fila por Sheet.
- **Real MQL/Spam/Qualified MQL duplicaban contactos multi-touch** (RESUELTO 2026-08-08):
  el usuario reportó 37 Real + 35 Spam (72 total) en Big Numbers para un rango donde la
  Sheet tenía 61 filas reales. Causa: esos números salían de sumar `UNIFIED` (explotado por
  ad para atribución), así que un contacto que tocó 2 ads contaba 2 veces. Se agregó
  `ICLOSED_CONTACTS` (deduplicado, ver decisión en §4) y se migraron Big Numbers/Funnel/
  Spend chart a usarlo -- verificado en vivo con el rango exacto del reporte: ahora da
  28+29+4(blank)=61, matchea la Sheet. Creative Performance/scatter siguen mostrando 37/35
  a propósito (por-ad, no por-contacto), no es un bug si se ven distintos a Big Numbers.
- **Cobertura de PostHog** (RESUELTO 2026-08-07): antes solo ~17% de los ads tenían alguna
  fila en PostHog_Raw porque nunca se había corrido un backfill (solo existía la ventana
  rolling de 10 días de `syncPostHog`). Se agregó `backfillPostHog()` a Code.gs (mismo
  patrón que `backfillMeta`, troceado por mes) y se corrió: trajo 1,256 filas nuevas
  jun-ago 2026. Ene-may 2026 siguen en 0 filas porque genuinamente no había tráfico
  `utm_source=fb_ad` en PostHog en esos meses (no es un bug). El HTML ya distingue esto
  bien: la tabla muestra "—" (no "0%") cuando `sessions=0`, y hay un caveat chico al lado
  del título de "Creative Performance" con la fecha real desde la que hay data (calculado
  dinámicamente del mínimo `date` con `sessions>0`, no hardcodeado).
- **Frequency es un estimado sesgado a la baja para cualquier rango de más de 1 día**:
  `Frequency = Impressions/Reach`, pero Reach no es sumable entre días (Meta dedupea
  personas dentro de un rango, no día a día) — sumar el reach diario infla el denominador,
  así que Frequency calculado da sistemáticamente más bajo que el real, y cuanto más ancho
  el rango, peor (por eso da ~1.1-1.2 casi fijo sea 7 días o year-to-date). Es exacto solo
  a nivel Date×Ad sin ninguna agregación. Se sacó de Big Numbers por esto (pedido explícito
  del usuario 2026-08-07), pero sigue en el selector de métricas del Spend chart, la tabla
  de Creative Performance, y los ejes del scatter, con el mismo sesgo ahí también. No hay
  forma de arreglarlo con los datos ya guardados por día -- la única solución real sería
  traer Reach sin desglosar por día para rangos específicos (ver intercambio sobre esto,
  no implementado, el usuario solo pidió sacarlo de Big Numbers).
- **Meta "Schedules" no se puede aislar por API** sin crear Custom Conversions en Meta
  Ads Manager para "Schedule", "Contact" y "2ndCallBooked" (hoy los 3 vienen mezclados
  bajo `offsite_conversion.fb_pixel_custom`). Si en algún momento se crean esas Custom
  Conversions en Ads Manager, ahí sí se podría retomar "Meta Schedules" como métrica
  separada — hoy está deliberadamente sacada del dashboard.
- **Thumbnails de Creative Performance expiran (varios no cargan → 403).** `Code.gs`
  guarda `creative{thumbnail_url}` (URL de CDN de Meta, firmada y temporal) en la columna
  `Thumbnail URL` de Meta_Raw, por fila. `syncMeta` solo refresca los últimos 10 días, así que
  cualquier ad cuyas filas son todas > 10 días queda con URL vencida y la imagen no carga. NO
  es pérdida permanente del dato: `thumbnail_url` se re-firma en cada request, así que re-pedir
  por `ad_id` (mientras el ad exista en Meta) devuelve una URL nueva válida. Se implementaron 2
  mitigaciones (2026-08-19): (1) un **placeholder** neutro (ícono de imagen) vía `onerror` en el
  `<img>` para que las que fallan no se vean rotas (`thumbCell()` + `.creative-thumb-ph`), y (2)
  un **refresh diario de URLs** -- `syncCreatives()` en Code.gs enumera TODOS los ads de las 3
  cuentas (`/{account}/ads?fields=name,creative{thumbnail_url}`) y escribe `Ad → Thumbnail URL`
  fresca en un tab nuevo `Creatives`; el dashboard lo lee (`loadCreativeThumbs()` → `CREATIVE_THUMBS`)
  y esa URL pisa la guardada por fila en Meta_Raw (`thumbCell` usa `CREATIVE_THUMBS.get(r.ad) ||
  r.thumbnailUrl`). NO guarda los bytes: si un ad se borra de Meta o la URL vence entre corridas,
  esa imagen igual puede fallar (→ placeholder). La variante durable-total (bytes a Drive) sigue
  disponible como opción, ver §7. `fetchThumbnailsForAdIds()` es el pull viejo por-fila (sigue
  llenando la columna Thumbnail URL de Meta_Raw en syncMeta/backfill).
- **Encoding de iClosed**: el export de iClosed trae `Ad`/`Campaign`/`Ad Set` con espacios
  codificados como `+` (ej: `SSW_ADV+_ACQ.COM...+-+Copy+2`), y a veces varios ads separados
  por coma en una sola celda (multi-touch). Ya resuelto con un algoritmo de crosscheck
  (`buildAdCrosscheck`/`resolveAdName` en el HTML) que compara contra los nombres reales
  de Meta para decodificar sin romper "+" legítimos (ej "ADV+"). Con esto, de ~690 filas
  sin match, solo queda 1 genuina sin resolver (el resto son de fuera de la ventana de
  10 días de Meta_Raw, esperable) — pero si aparecen MUCHAS filas nuevas sin match al
  revisar `console.warn` del navegador, revisar si cambió el formato de export de iClosed.
- El panel de navegador usado para testing esta sesión (Claude Browser pane) tuvo
  screenshots en negro intermitentes — es un problema de la herramienta, no del código
  (se verificó todo por inspección JS/DOM directa como respaldo). Si se repite en la
  próxima sesión, no asumir que es un bug del dashboard sin verificar por consola/JS primero.

## 7. Próximos pasos

**ACTUALIZACIÓN 2026-08-21 — automatización de iClosed reescrita y EN VALIDACIÓN (tab aparte).**
Se descartó el `syncIClosed()` viejo (basado en `/v1/eventCalls`, roto). El nuevo enfoque está en
`Code.gs` como `syncIClosedAuto()` / `backfillIClosedAuto()` / `runIClosedAuto()` y **escribe a una
tab NUEVA `iClosed_Auto` (NO a `iClosed_Raw`)** para comparar contra el pegado manual antes de migrar.
Diseño confirmado con el usuario:
- Fuente: `/v1/contacts` filtrado por `joinedTime` (= "Contact Creation Date" del export manual) →
  por cada contacto `/v1/contacts/detail` (joinedTime + `referrerUrl` para utm single-touch + custom
  fields `real-mql`/`lead-score`) + `/v1/eventCalls?contactId=` (nombre de Call A/B = columna Event).
- **"Scheduling status" = el campo `status` del contacto** (enum confirmado en la spec:
  POTENTIAL/QUALIFIED/DISQUALIFIED/STRATEGY_CALL_BOOKED/DISCOVERY_CALL_BOOKED). "Event" = `event.name`
  de eventCalls. Real MQL/Lead Score = custom fields del detail.
- **Merge por Contact ID** (col J nueva en la tab), NO reemplazo de ventana: Date/utm se fijan una
  vez; Real MQL/Lead Score toman siempre el último (lag ~1 día); **status+Event se congelan apenas
  llegan a un `*_CALL_BOOKED`** para que un show/DQ posterior no borre el booking (regla explícita del
  usuario: "no sobreescribir el status una vez que está en discovery").
- Multi-touch: la API solo da `referrerUrl` (un touch) → se acepta perder el ~14% multi-touch (el
  usuario lo confirmó). No hay export programado en iClosed (el usuario verificó), por eso vía API.
- **Estado**: falta que el usuario corra `backfillIClosedAuto('<fecha>')`, compare `iClosed_Auto`
  vs `iClosed_Raw` sobre una ventana conocida, y AHÍ se decide migrar (repuntar el dashboard de
  `iClosed_Raw` a `iClosed_Auto`, que ignora la col J). NO activar trigger hasta que cierre. Ojo con:
  (a) formato de utm en `referrerUrl` (puede venir percent-encoded vs el "+"-encoded del manual --
  `parseUtmFromUrl` lo deja crudo, ver si el crosscheck lo resuelve igual); (b) `joinedTime` es UTC,
  el manual puede estar en TZ de la cuenta (posible off-by-one-day); (c) tiempo de ejecución en
  backfills largos (por eso `backfillIClosedAuto` va mes a mes y es idempotente).

--- (histórico, del intento viejo, dejado como referencia) ---

**Automatización de `iClosed_Raw`: el diseño VIEJO de `syncIClosed()` estaba ROTO,
no confiar en él ni activar su trigger.** Se escribió una primera versión basada en
`/v1/eventCalls` (commit `d46a8c1`) que el usuario corrió -- trajo **17 filas de 23 calls**
para una ventana donde el export manual (que el usuario compartió, un .xlsx real descargado
de iClosed llamado "Global Data - contacts") tiene **29 contactos de Meta genuinos**. No es
un bug menor, es un ~40% de undercounting.

**Causa raíz confirmada** (comparando el .xlsx real contra la API, no es especulación):
- El export manual sale de la vista de **Contactos** de iClosed, fechado por
  `Contact Creation Date` (cuándo entró el lead) -- incluye TODOS los leads, tengan o no una
  llamada todavía.
- `syncIClosed()` v1 usaba `/v1/eventCalls` (fechado por cuándo *ocurrió* la llamada) --
  se pierden todos los leads que crearon el contacto en la ventana pero cuya llamada cayó
  afuera (o no la tuvieron todavía). **La fuente correcta es Contactos, no Calls.**
- Segundo hallazgo, más difícil: el export manual junta **múltiples touches por lead**
  separados por coma en UTM Campaign/Medium/Content (ej. un lead que clickeó 2 ads distintos
  antes de agendar) -- eso sale de un reporte interno de iClosed. La API pública solo expone
  `referrerUrl` por contacto (`GET /v1/contacts/detail?contactId=X`, un solo touch, no un
  array). De los 29 leads de fb_ad en la ventana de prueba, **4 (14%) son multi-touch** --
  con la API se les asignaría un solo ad, no todos los que tocaron.
- El usuario está de acuerdo en aceptar esa pérdida del 14% (single-touch vía `referrerUrl`)
  a cambio de automatizar el resto -- **pero falta confirmar si `referrerUrl` es first-touch
  o last-touch** antes de decidir a qué ad exacto atribuir esos casos multi-touch. Se agregó
  `debugIClosedFindByEmail(email)` a `Code.gs` (busca por email vía `/v1/contacts?search=`,
  trae el contactId, y pide el detail) -- **falta que el usuario la corra** con un lead
  multi-touch conocido (ej. `gojohn@gmail.com`, que en el export tiene 2 ads) y comparta el
  log, comparando el orden real contra `referrerUrl`.
- Real MQL y Lead Score SÍ están confirmados y andan bien: son custom fields a nivel
  **CONTACTO** vía `GET /v1/contacts/detail?contactId=X` → `data.CustomFieldAssociation[]`,
  filtrando por `customField.identifier === 'real-mql'` / `'lead-score'`, leyendo
  `CustomFieldAnswer[0].answer`. Eso no cambia con el rediseño, sigue sirviendo igual.

**Qué falta hacer (en orden) para dejar esto realmente andando:**
1. Confirmar first-touch vs last-touch de `referrerUrl` (correr `debugIClosedFindByEmail`,
   ver arriba).
2. Reescribir `syncIClosed()` para que la fuente sea `GET /v1/contacts` (lista, filtrable por
   `timeFrom`/`timeTo` sobre `joinedTime`) en vez de `/v1/eventCalls` -- enumerar contactos
   creados en la ventana, y por cada uno pedir `/v1/contacts/detail` para sacar `referrerUrl`
   (parsear su query string para utm_campaign/utm_medium/utm_content) + Real MQL + Lead Score,
   todo en una sola llamada por contacto (ya no hace falta la llamada a `/v1/eventCalls` para
   nada, `contacts/detail` ya trae todo lo necesario).
3. Recién ahí volver a probar manualmente (correr, mirar la Sheet, comparar contra el export
   manual de una ventana conocida) antes de tocar `createTriggers()`.
4. **No activar el trigger de `syncIClosed`** hasta que el punto 3 esté confirmado en vivo --
   una vez activo, cada corrida reemplaza las filas de los últimos `WINDOW_DAYS` (10 días) en
   `iClosed_Raw`, así que si el diseño sigue mal, el trigger diario perpetuaría el problema
   solo, sin que nadie lo note hasta mirar los números.
- Si se retoma en sesión nueva: NO asumir que `syncIClosed()` funciona por más que el código
  ya esté en `Code.gs` -- este ítem viene marcado "en curso" desde hace varias sesiones y
  recién en la última se encontró que el diseño de origen (Calls) estaba mal. Preguntar
  primero en qué quedó antes de tocar nada.

**Pendiente, explícitamente pateado para después (pedido de Josh vía Slack, el usuario dijo
"hagámoslo después"):** agregar Show Rate (% de calls agendadas que efectivamente se
mostraron, no no-show) y Closes (deals ganados) al dashboard, pulled from iClosed. Ninguno de
los dos tiene datos en el pipeline hoy -- Show Rate necesitaría el outcome/no-show status de
la llamada (visto en `task[].outcome`/`noSaleReason` de `/v1/eventCalls`, valores tipo
NO_SHOW/REJECTED/WON, o el campo custom field "Call Outcome"/"No Sale Reason" que ya vimos en
`CustomFieldAssociation`), y Closes necesitaría datos de Deals/Transactions (endpoints
`/v1/deals`/`/v1/transactions` de la API, no explorados todavía). No arrancar esto sin que el
usuario lo pida explícitamente -- fue pateado a propósito.

Fuera de eso, no hay más pedidos pendientes del usuario a esta fecha — todo lo demás
solicitado está implementado, commiteado, y pusheado (repo `ssw-dashboard` está "up to date
with origin/main"). Si el usuario vuelve con más pedidos, el flujo es:

1. Leer este HANDOFF.md primero.
2. Editar `/Users/manueldorado/Claude Code/ssw-dashboard/index.html` directo (es el mismo
   archivo que sirve Vercel).
3. Probar en un servidor local (`python3 -m http.server` en esa carpeta) + Browser pane
   antes de dar por terminado cualquier cambio — este proyecto tiene antecedentes de bugs
   sutiles (table-layout, z-order de charts, encoding) que solo se detectaron probando en
   vivo, no revisando el código a ojo. Cuidado con el caché del Browser pane sobre
   `index.html` -- si un cambio no se refleja al navegar, agregar un query param
   (`?cb=<numero>`) a la URL para forzar recarga.
4. Hacer `git add`/`git commit` (esto lo hace Claude), y decirle al usuario que corra
   `git push` (él lo hace, ya tiene SSH configurado, no debería pedir nada) -- siempre con
   el `cd` completo al repo, no solo `git push` a secas (su terminal no arranca parado ahí).
5. Antes de que el usuario publique, mostrarle un preview en vivo (servidor local + Browser
   pane) para que lo revise -- no alcanza con decir "ya lo probé y anda".
6. Si el pedido es sobre `Code.gs` (Apps Script): recordar que la fuente de verdad vive
   en el editor de Apps Script (atado a la Sheet), no en este repo — pegale el nuevo
   código ahí primero (Cmd+A, borrar, pegar completo — el usuario tuvo problemas antes
   pegando parches parciales), y después traer la copia actualizada a este repo también.

Setup pendiente del usuario (thumbnails, 2026-08-19) -- el código ya está commiteado, falta
que el usuario haga la parte de Apps Script una sola vez:
1. Pegar el `Code.gs` actualizado en el editor de Apps Script (Cmd+A, borrar, pegar completo).
2. Correr `syncCreatives()` una vez a mano (autoriza Drive/Sheets si lo pide, crea el tab
   `Creatives` solo, lo llena). Verificar en la Sheet que el tab tenga `Ad | Thumbnail URL`.
3. Correr `createCreativesTrigger()` una vez para dejar el refresh diario (~2am). NO correr
   `createTriggers()` (ese recrea también el trigger de syncIClosed, que sigue roto -- ver arriba).
El dashboard ya lee el tab `Creatives` (`loadCreativeThumbs`/`CREATIVE_THUMBS`) y tolera que no
exista todavía (gviz devuelve Meta_Raw como fallback, y el loader lo valida por header). Incluso
antes del setup ya mejora (usa la URL más reciente guardada por ad).

Pendiente opcional (no pedido, solo sugerido si surge la oportunidad):
- **Persistencia TOTAL de thumbnails (bytes a Drive) -- NO implementada, es la alternativa a
  syncCreatives si el refresh de URLs no alcanza.** syncCreatives (implementado) refresca las
  URLs a diario, pero una URL puede vencer entre corridas y los ads borrados de Meta igual quedan
  sin imagen. Si eso molesta, la versión robusta: en `Code.gs`, bajar los BYTES de la imagen
  (`creative{image_url}` para más resolución) UNA vez por ad, guardarlos en una carpeta pública de
  Google Drive, y guardar `ad_name → driveFileId` (agregando una 3ra columna al tab `Creatives`);
  el dashboard usaría `https://drive.google.com/thumbnail?id=<id>&sz=w96`. Trade-offs: permisos de
  Drive, solo captura ads que aún existen en Meta, hotlink de Drive puede tener rate-limit (ok
  para uso interno). El usuario eligió el refresh de URLs (más liviano) 2026-08-19.
- Si el volumen de datos sigue creciendo mucho (Meta_Raw ya tiene ~9,500 filas), vigilar
  que Google Sheets no se ponga lento — no es un problema todavía.
- (RESUELTO) Qualified MQL / Cost per Qualified MQL: ya están en Big Numbers, la tabla
  Creative Performance, y el scatter (`METRIC_OPTIONS`) -- no queda nada pendiente acá.
- `Frequency` sigue siendo un estimado sesgado a la baja (ver §6) en todos lados donde
  aparece fuera de Big Numbers (de donde ya se sacó) -- selector de métricas del chart,
  tabla de Creative Performance, ejes del scatter. El usuario fue avisado, no pidió sacarlo
  de ahí también, pero si lo pide es el mismo tipo de cambio que ya se hizo en Big Numbers.

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

## 9. Columnas Email + Audit (iClosed) y stage de Audits — PENDIENTE de cablear al dash

**Contexto (2026-09-01):** se está agregando "Audit" como un stage más abajo en el funnel
(después de Booked): a algunos leads se les audita la cuenta. Esa instancia NO vive en
iClosed, así que se carga **manual** en la Sheet (pocos, ~3-4/semana). Cohorteado por lead
creation date por definición (misma fila del contacto).

**Ya hecho (backend, en `Code.gs` — ya en Apps Script):**
- Columna **`Email`** agregada a `ICLOSED_AUTO_HEADERS` (col K, después de Contact ID). Se
  llena desde la API vía el helper `pickEmail()` (prueba `email`/`contactEmail`/`emailAddress`/…
  y como fallback escanea cualquier key con "email" y un "@"). Confirmado que trae mails OK.
- Columna **`Audit`** agregada a `ICLOSED_AUTO_HEADERS` (col L, última). Es 100% manual: la
  API nunca la toca. **Crítico**: está en los headers a propósito para que `writeWholeSheet`
  la preserve POR Contact ID en cada rewrite (sino, al reordenarse las filas numéricamente
  por Contact ID cuando entra un contacto nuevo, el "YES" se pegaría a la fila equivocada).
- `readSheetAsObjects` ahora ubica Contact ID por nombre (`headers.indexOf('Contact ID')`),
  no como "última columna" (porque Email/Audit ahora van después).
- `writeWholeSheet` ahora reescribe el header siempre (idempotente) y agrega columnas
  físicas si faltan.
- Ambas columnas también agregadas MANUALMENTE al final de la tab histórica
  (`iClosed_historical_donotchange`) por el usuario. El dashboard ignora col ≥ 9 (lee hasta
  `c[8]`=Event), así que Email/Audit/Contact ID no afectan el parsing actual.

**Cómo se carga Audit:** el usuario pone `YES` en la fila del contacto que tuvo audit; la que
no, la deja vacía. En ambas tabs (histórica y auto).

**Stage de Audits en el dashboard — PENDIENTE (esperar a que haya data cargada):**
Decisiones ya confirmadas con el usuario (2026-09-01):
- **Definición**: un Audit = contacto con **Audit == "YES"** (case-insensitive), contado 1 vez
  por contacto, atribuido por sus UTMs (misma lógica que MQL/Booking), cohorteado por lead
  creation date. **Sin gates extra** (el YES ya implica que pasó — NO exige Real MQL=Yes).
- **Métricas**: solo **Audits** + **Cost per Audit**. **NO** hacer variante Qualified Audits
  (a diferencia de Bookings, que sí tiene Qualified).
- **Dónde va** (cuando se cablee, replicando el patrón de Booking): parsear col Audit en
  `loadAll` (índice depende del layout final de cada tab — validar por header/posición, no
  hardcodear ciegamente); agregar keys `audit` y `cpaudit` a sumRows, aggregateByAd,
  sumIClosedContacts, bucketIClosedContacts, mergeSources, renderSpendChart buckets,
  CHART_METRICS/CHART_METRIC_KEYS/METRIC_OPTIONS/METRIC_DIRECTION, CREATIVE_NUM_COLUMNS,
  PERF_COLUMNS, computePerfRows, ambos theads, 2 tiles nuevos en Big Numbers; y un step
  "Audit" en el funnel después de Booked (sin resaltado celeste, porque no hay Qualified Audit).
- El usuario eligió **esperar** a tener algunos YES cargados antes de cablearlo (así se ve
  con data real, no en 0).
