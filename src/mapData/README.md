# Static map and data provenance

This directory owns the bounded static data/provenance slice for the Korea family map and the globe city data contract.

## Canonical contract

`dataProvenance.json` is the current source-of-truth contract for static app data. `src/data/worldCapitals.json`, `src/data/top100Cities.json`, and `src/data/cityContent.json` are the bounded static city assets that satisfy the current capital/TOP100 model. It locks:

- **Korea boundaries**: the committed app asset is `korea-real-coordinate-boundaries-v3`, backed by `boundaryProvenance.json`. It uses static WGS84 KOSTAT-derived GeoJSON rings from `southkorea/southkorea-maps`, normalized into a vector-only satellite-inspired viewBox: 17 first-level Korea regions plus Busan/Haeundae, Seoul/Mapo, and Gyeongnam/Gimhae/Bonghwang family drilldowns. Never use live map APIs, GADM, or NC/ND census derivatives.
- **Capitals**: the committed dataset is `world-capitals-un-member-states-static-2026-06-16`, containing exactly 193 UN member-state capital markers. It uses the official United Nations Member States page for inclusion semantics, removes non-member/observer/dependency entries such as Vatican City, and joins to a static capital-coordinate CSV with no runtime query/API dependency.
- **TOP100 cities**: the UI-facing ranked dataset must contain exactly 100 contiguous ranks. The locked exact-100 source is the public Euromonitor Top 100 City Destinations 2018 white paper (`2018-11-01`, 2017 international arrivals metric). Partial Agoda posts, incomplete previews, and Mastercard GDCI 2019 top-20-only tables are not enough for the exact-100 contract.
- **City card content**: `cityContent.json` provides explicit city-level Landmark/Food overrides for every visible UN193 capital and every TOP100 city; missing content is a verification/build failure. It stores short original labels and source URLs, not copied prose.

`npm run verify:data` validates these provenance contracts, scans runtime source for forbidden map/auth/API-key/weather dependencies, and delegates to `scripts/verify-city-data.mjs` before downstream UI work can rely on the datasets.

## Committed Korea geometry

`koreaFamilyBoundaries.json` is a static vector SVG overlay. The UI draws each province's significant rings, including coastal islands, the Gwangju hole inside Jeollanam-do, Jeju, and Ulleungdo. Dokdo is a small symbol centered on its real projected point and slightly enlarged so it stays visible on a phone. Tiny speck rings stay hidden. The geometry is simplified WGS84 administrative data normalized into the app viewBox; it is still not a legal, cadastral, survey, routing, emergency, or address dataset.

`worldCountryBorders.json` is the separate bundled Natural Earth 110m country-border extraction used for non-pickable decorative globe context. It is static app data, not a live service dependency.

It is not legal, cadastral, survey, routing, emergency, or address data.

## Boundary provenance strategy

`boundaryProvenance.json` records the permissive boundary-source strategy:

- committed geometry: 17-region KOSTAT-derived static projected boundary rings normalized for the vector-only Korea family map;
- future world/country boundary candidate: Natural Earth Admin 0 boundary/country layers, which Natural Earth describes as public-domain map data;
- Korea legal-boundary source metadata: `국토교통부_일별법정구역정보 SHP` and VWorld legal-boundary download surfaces, processed/documented only as static simplified data;
- excluded: GADM and NC/ND census-boundary layers for this public/static app.

Sources reviewed during implementation:

- Natural Earth: https://www.naturalearthdata.com/
- Natural Earth 110m cultural vectors / Admin 0 boundary lines: https://www.naturalearthdata.com/downloads/110m-cultural-vectors/
- 국토교통부_일별법정구역정보: https://www.data.go.kr/data/15045881/fileData.do?recommendDataYn=Y
- 법정구역경계_시군구: https://www.data.go.kr/data/28846482/linkedData.do
- VWorld legal-boundary download surfaces: https://www.vworld.kr/dtmk/dtmk_ntads_s002.do
- United Nations Member States: https://www.un.org/en/about-us/member-states
- Capital latitude/longitude CSV: https://gist.github.com/ofou/df09a6834a8421b4f376c875194915c9
- Euromonitor Top 100 City Destinations 2018: https://go.euromonitor.com/white-paper-travel-2018-100-cities
- Mastercard Global Destination Cities Index 2019 top-20 corroborating source: https://www.mastercard.com/news/media/wexffu4b/gdci-global-report-final-1.pdf
- southkorea/southkorea-maps KOSTAT 2013 simplified GeoJSON source: https://github.com/southkorea/southkorea-maps

## Verification

Run the data/provenance gate directly with:

```bash
npm run verify:data
```

The aggregate project gate `npm run verify` also runs this verifier before the production build, so provenance drift or removed npm wiring fails local verification.

## Runtime constraints preserved

- No live map API calls.
- No backend, auth, login, or secret key dependency.
- No route through the existing Seoul capital card.
- Capitals remain exact-193 UN member-state static data; no runtime capital/city API fetch.
