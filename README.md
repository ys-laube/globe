# The Globe

A premium, shareable 3D globe gift for the whole family.

## Korea family map zoom data notes

The Korea family map zoom stays fully static and client-side. The current
committed family-map overlay is `korea-real-coordinate-boundaries-v3`: 17
first-level Korea regions plus Busan/Haeundae, Seoul/Mapo, and
Gyeongnam/Gimhae/Bonghwang family drilldowns. Coastlines and islands, including
Jeju, Ulleungdo, and a legibility-scaled Dokdo symbol, come from the static
southkorea-maps KOSTAT rings. It is a simplified vector guide, not a legal boundary.
Do not add live map APIs, backend services, auth flows, runtime API keys, or
legal-boundary accuracy claims. The geometry lives in
`src/mapData/koreaFamilyBoundaries.json`, its provenance/source strategy lives in
`src/mapData/boundaryProvenance.json`, and the decorative globe border asset
lives in `src/mapData/worldCountryBorders.json`.

The static data contract is locked in `src/mapData/dataProvenance.json` and
validated by `npm run verify:data`: Korea boundary candidates are build-time
public-data/VWorld static snapshots or documented metadata only, the capital dataset must contain the locked 193 UN member-state capital markers, and TOP100 city data must contain exactly 100 contiguous ranked rows from
the Euromonitor Top 100 City Destinations 2018 source with ranking-date/license notes. The app does not include a runtime forecast layer or forecast API.

The household configuration is intended to stay in one static file. Accepted
family display names and the seven active Naver Band links live in
`src/householdConfig.ts`: 한가네 본가 has two Band links, 건희민하찬희네 has
three, 진주네 has one, and 은하네 has one. The name gate is a light,
client-only family cue; it is not authentication and does not store names.

Korea must be handled as its own family-map destination, not by reusing the
existing Seoul city card. Existing city content should remain unchanged unless a
separate city-content task explicitly owns that edit.

## Typography asset notes

The hero script title uses a bundled self-hosted `Great Vibes` font asset at
`src/assets/fonts/great-vibes-v21-latin-regular.ttf`. Runtime CSS must not import
Google Fonts, gstatic, or any other font CDN; the system script stack remains only
as fallback if the local asset cannot render.

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

## Verification notes

For full local verification, run:

```bash
npm run verify
```

This runs TypeScript checking, bundled boundary/provenance validation, and the
production Vite build. The boundary/provenance step is `npm run verify:data`; it
checks the static map JSON contracts, provenance exclusions, README provenance
notes, forbidden runtime map/auth/API-key/weather source patterns, and that the aggregate `npm run verify` command still includes the data verification gate. The app has no backend, login dependency, or required live API dependency.
On macOS with Google Chrome installed, run `npm run smoke:korea` to build and then exercise the exploration mode, globe auto-rotation, Korea same-stage morph, 17-region vector satellite-inspired Korea map with Jeju/Ulleungdo/Dokdo references, Busan → Haeundae drilldown, Seoul/Jeju marker priority, family marker, removed forecast UI guard, and household name-gate path in headless Chrome.

## Shareable URL

Deploy this Vite app to any static host such as Vercel, Netlify, Cloudflare Pages, or GitHub Pages. The app is fully client-side and does not require login or live API keys.


## Current verification evidence

Latest local final gate evidence should include:

- `npm run verify` — TypeScript, static data/provenance validators, production build.
- `npm run smoke:korea` — production build plus headless Chrome smoke covering 193-UN-member-state-capitals/TOP100 exploration, globe auto-rotation, Korea same-stage morph, 17-region official/static vector satellite-inspired overlay with Jeju/Ulleungdo/Dokdo references, Haeundae drilldown, Seoul/Jeju marker priority, glowing household markers, removed forecast UI guard, and the 건희민하찬희네 name gate.
- `git diff --check` — whitespace/static diff hygiene.

The production build isolates Three.js as a vendor chunk and lazy-loads dense exploration/Korea/world-border data chunks. If first-load size becomes visible on the final hosting target, the next performance step is deeper route-level preloading or optional asset compression.
