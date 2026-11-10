import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const boundaries = JSON.parse(await readFile(join(root, 'src/mapData/koreaFamilyBoundaries.json'), 'utf8'));
const provenance = JSON.parse(await readFile(join(root, 'src/mapData/boundaryProvenance.json'), 'utf8'));
const dataProvenance = JSON.parse(await readFile(join(root, 'src/mapData/dataProvenance.json'), 'utf8'));
const worldBorders = JSON.parse(await readFile(join(root, 'src/mapData/worldCountryBorders.json'), 'utf8'));
const worldBordersRaw = await readFile(join(root, 'src/mapData/worldCountryBorders.json'), 'utf8');
const householdConfigSource = await readFile(join(root, 'src/householdConfig.ts'), 'utf8');
const koreaOverlaySource = await readFile(join(root, 'src/koreaFamilyOverlay.ts'), 'utf8');
const mainSource = await readFile(join(root, 'src/main.ts'), 'utf8');
const globeRendererSource = await readFile(join(root, 'src/globeRenderer.ts'), 'utf8');
const assetsPolicySource = await readFile(join(root, 'src/assetsPolicy.ts'), 'utf8');
const packageLockSource = await readFile(join(root, 'package-lock.json'), 'utf8');
const packageManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const mapDataReadme = await readFile(join(root, 'src/mapData/README.md'), 'utf8');
const rootReadme = await readFile(join(root, 'README.md'), 'utf8');
const stylesSource = await readFile(join(root, 'src/styles.css'), 'utf8');

async function listFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(child));
    else files.push(child);
  }
  return files;
}



function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameMembers(actual, expected, label) {
  assert(Array.isArray(actual), `${label} must be an array`);
  const a = [...actual].sort();
  const e = [...expected].sort();
  assert(JSON.stringify(a) === JSON.stringify(e), `${label} mismatch`);
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(a, b, point) {
  return Math.abs(orientation(a, b, point)) <= 1e-9
    && point[0] >= Math.min(a[0], b[0]) - 1e-9
    && point[0] <= Math.max(a[0], b[0]) + 1e-9
    && point[1] >= Math.min(a[1], b[1]) - 1e-9
    && point[1] <= Math.max(a[1], b[1]) + 1e-9;
}

function segmentsProperlyIntersect(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < -1e-9 && cdA * cdB < -1e-9;
}


function polygonArea(points) {
  const doubledArea = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  return Math.abs(doubledArea) / 2;
}

function samePolygon(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((point, index) => point[0] === right[index][0] && point[1] === right[index][1]);
}

function primaryRing(feature) {
  return [...feature.rings].sort((left, right) => polygonArea(right) - polygonArea(left))[0];
}

function pointInPolygon(polygon, point) {
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointOnSegment(polygon[index], polygon[(index + 1) % polygon.length], point)) return true;
  }
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[previous];
    const crosses = (yi > point[1]) !== (yj > point[1]);
    if (crosses && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}


function pointInFeature(feature, point) {
  const rings = feature.rings?.length ? feature.rings : [feature.polygon];
  return rings.reduce((inside, ring) => pointInPolygon(ring, point) ? !inside : inside, false);
}

function polygonHasSelfIntersection(feature) {
  const points = feature.polygon;
  for (let a = 0; a < points.length; a += 1) {
    const aNext = (a + 1) % points.length;
    for (let b = a + 1; b < points.length; b += 1) {
      const bNext = (b + 1) % points.length;
      if (a === b || aNext === b || bNext === a) continue;
      if (segmentsProperlyIntersect(points[a], points[aNext], points[b], points[bNext])) return true;
    }
  }
  return false;
}

function firstLevelPolygonsOverlap(a, b) {
  for (let aIndex = 0; aIndex < a.polygon.length; aIndex += 1) {
    const aNext = (aIndex + 1) % a.polygon.length;
    for (let bIndex = 0; bIndex < b.polygon.length; bIndex += 1) {
      const bNext = (bIndex + 1) % b.polygon.length;
      if (segmentsProperlyIntersect(a.polygon[aIndex], a.polygon[aNext], b.polygon[bIndex], b.polygon[bNext])) return true;
    }
  }
  return pointInFeature(a, b.centroid) || pointInFeature(b, a.centroid);
}

const expectedRegionNames = [
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시', '세종특별자치시',
  '경기도', '강원특별자치도', '충청북도', '충청남도', '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도',
];
const firstLevelIds = new Set([
  'kr-seoul', 'kr-busan', 'kr-daegu', 'kr-incheon', 'kr-gwangju', 'kr-daejeon', 'kr-ulsan', 'kr-sejong',
  'kr-gyeonggi', 'kr-gangwon', 'kr-chungbuk', 'kr-chungnam', 'kr-jeonbuk', 'kr-jeonnam', 'kr-gyeongbuk', 'kr-gyeongnam', 'kr-jeju',
]);
const familyTargetIds = new Set(['kr-seoul-mapo', 'kr-busan-haeundae', 'kr-gyeongnam-gimhae', 'kr-gimhae-bonghwang']);
const requiredIds = new Set([...firstLevelIds, ...familyTargetIds]);
const expectedTiers = new Map([
  ['kr-seoul', 'special-city'], ['kr-busan', 'metropolitan-city'], ['kr-daegu', 'metropolitan-city'], ['kr-incheon', 'metropolitan-city'],
  ['kr-gwangju', 'metropolitan-city'], ['kr-daejeon', 'metropolitan-city'], ['kr-ulsan', 'metropolitan-city'], ['kr-sejong', 'special-self-governing-city'],
  ['kr-gyeonggi', 'province'], ['kr-gangwon', 'special-self-governing-province'], ['kr-chungbuk', 'province'], ['kr-chungnam', 'province'],
  ['kr-jeonbuk', 'special-self-governing-province'], ['kr-jeonnam', 'province'], ['kr-gyeongbuk', 'province'], ['kr-gyeongnam', 'province'], ['kr-jeju', 'special-self-governing-province'],
  ['kr-seoul-mapo', 'district'], ['kr-busan-haeundae', 'district'], ['kr-gyeongnam-gimhae', 'city'], ['kr-gimhae-bonghwang', 'neighborhood'],
]);

assert(boundaries.schemaVersion === 3, 'Korea boundary schemaVersion must be 3 for projected real-coordinate rings');
assert(boundaries.assetId === 'korea-real-coordinate-boundaries-v3', 'Korea map must use the real-coordinate boundary asset id');
assert(boundaries.coordinateSystem === 'normalized-static-vector-viewbox-0-100-derived-from-wgs84-epsg4326', 'boundary coordinate system must describe the normalized vector-only viewBox');
assert(boundaries.geometryKind === 'static-projected-geojson-rings', 'Korea map must use projected static GeoJSON rings');
assert(boundaries.sourceClassification === 'official-derived', 'boundary sourceClassification must be official-derived');
assert(boundaries.provenanceId === provenance.id, 'boundary provenanceId must match provenance document');
assert(provenance.committedAssetStrategy.assetId === boundaries.assetId, 'provenance asset id must match boundary asset');
assert(dataProvenance.koreaBoundaries.committedAssetId === boundaries.assetId, 'data provenance must lock boundary asset id');
assert(dataProvenance.koreaBoundaries.committedProvenanceId === provenance.id, 'data provenance must lock boundary provenance id');

assert(boundaries.officialSourceSnapshot?.firstLevelRegionCount === 17, 'official source snapshot must document 17 first-level Korea regions');
assert(/vector-only|satellite-inspired/i.test(boundaries.officialSourceSnapshot?.note ?? ''), 'official source snapshot must document the static vector-only satellite-inspired treatment');
assert(boundaries.firstLevelRegionPolicy?.expectedOfficialRegionCount === 17, 'boundary data must document expected 17 first-level regions');
sameMembers(boundaries.firstLevelRegionPolicy.expectedOfficialRegionsKo, expectedRegionNames, 'boundary official first-level region names');
assert(dataProvenance.koreaBoundaries.officialFirstLevelRegionContract?.expectedCount === 17, 'data provenance must lock expected 17 first-level regions');
sameMembers(dataProvenance.koreaBoundaries.officialFirstLevelRegionContract.expectedRegionsKo, expectedRegionNames, 'data provenance first-level region names');

assert(Array.isArray(boundaries.features), 'features must be an array');
assert(boundaries.features.length === 21, 'expected 17 first-level regions plus 4 family drilldown targets');
const ids = new Set();
for (const feature of boundaries.features) {
  assert(requiredIds.has(feature.id), `unexpected feature id: ${feature.id}`);
  assert(!ids.has(feature.id), `duplicate feature id: ${feature.id}`);
  ids.add(feature.id);
  assert(feature.interactive === true, `${feature.id} must be interactive`);
  assert(feature.tier === expectedTiers.get(feature.id), `${feature.id} must keep approved tier`);
  assert(Array.isArray(feature.polygon) && feature.polygon.length >= 4, `${feature.id} needs a bounded polygon`);
  assert(Array.isArray(feature.rings) && feature.rings.length >= 1, `${feature.id} needs projected geometry rings`);
  assert(samePolygon(feature.polygon, primaryRing(feature)), `${feature.id} polygon must be the primary/largest renderable landmass ring`);
  assert(Array.isArray(feature.centroid) && feature.centroid.length === 2, `${feature.id} needs a centroid`);
  for (const ring of feature.rings) {
    assert(Array.isArray(ring) && ring.length >= 4, `${feature.id} ring must be bounded`);
    for (const [x, y] of ring) {
      assert(Number.isFinite(x) && x >= 0 && x <= 100, `${feature.id} x coordinate out of normalized range`);
      assert(Number.isFinite(y) && y >= 0 && y <= 100, `${feature.id} y coordinate out of normalized range`);
    }
  }
  for (const [x, y] of [feature.centroid]) {
    assert(Number.isFinite(x) && x >= 0 && x <= 100, `${feature.id} centroid x coordinate out of normalized range`);
    assert(Number.isFinite(y) && y >= 0 && y <= 100, `${feature.id} centroid y coordinate out of normalized range`);
  }
  if (firstLevelIds.has(feature.id)) {
    assert(feature.adminLevel === 1, `${feature.id} must be adminLevel 1`);
    assert(feature.officialRegionClass === 'first-level-administrative-division', `${feature.id} must be first-level region`);
  }
  if (familyTargetIds.has(feature.id)) {
    assert(feature.adminLevel >= 2 || feature.id === 'kr-gimhae-bonghwang', `${feature.id} must be below first level`);
    assert(feature.officialRegionClass === 'family-target-drilldown', `${feature.id} must be family target drilldown`);
  }
}
assert(ids.size === requiredIds.size, 'missing required Korea boundary-guide feature ids');
sameMembers(boundaries.features.filter((feature) => feature.adminLevel === 1).map((feature) => feature.nameKo), expectedRegionNames, 'rendered first-level region names');

const firstLevelFeatures = boundaries.features.filter((feature) => feature.adminLevel === 1);
assert(firstLevelFeatures.length === firstLevelIds.size, 'expected exactly 17 first-level Korea polygons for clickability validation');
for (const feature of firstLevelFeatures) {
  assert(!polygonHasSelfIntersection(feature), `${feature.id} primary polygon must be simple enough for SVG hit testing`);
  assert(pointInFeature(feature, feature.centroid), `${feature.id} centroid must be inside its first-level fill area`);
}
for (let leftIndex = 0; leftIndex < firstLevelFeatures.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < firstLevelFeatures.length; rightIndex += 1) {
    const left = firstLevelFeatures[leftIndex];
    const right = firstLevelFeatures[rightIndex];
    assert(!firstLevelPolygonsOverlap(left, right), `${left.id} and ${right.id} first-level polygons must not overlap or capture each other's safe click point`);
  }
}

assert(Array.isArray(boundaries.islandReferences), 'boundary data must declare an islandReferences array for explicit removal policy');
assert(boundaries.islandReferences.length === 0, 'boundary data must not render decorative 제주도/울릉도/독도 island references');
assert(Array.isArray(dataProvenance.koreaBoundaries.requiredIslandReferencesKo) && dataProvenance.koreaBoundaries.requiredIslandReferencesKo.length === 0, 'data provenance must lock decorative island references as removed');
assert(Object.keys(dataProvenance.koreaBoundaries.islandAdministrativeContext ?? {}).length === 0, 'data provenance must not keep decorative island administrative contexts');
assert((provenance.committedAssetStrategy.islandReferencePolicy?.requiredIslandReferencesKo ?? []).length === 0, 'boundary provenance must lock decorative island references as removed');
assert(/Do not render separate decorative island markers/i.test(provenance.committedAssetStrategy.islandReferencePolicy?.renderingDecision ?? ''), 'boundary provenance must document that islands are not separate decorative markers');
assert(!koreaOverlaySource.includes('korea-island-reference'), 'Korea overlay must not render decorative island reference groups');
assert(!koreaOverlaySource.includes('korea-island-label') && !koreaOverlaySource.includes('island.nameKo'), 'Korea overlay must not render decorative island reference labels');
assert(!koreaOverlaySource.includes('data-island-hit-target') && !koreaOverlaySource.includes('dataset.islandHitTarget'), 'Korea overlay must not render island click/touch targets');
assert(koreaOverlaySource.includes('울릉도') && koreaOverlaySource.includes('독도'), 'Korea overlay must label Ulleungdo and Dokdo on the province map');
assert(!koreaOverlaySource.includes('제주도 정적'), 'Korea overlay must not restore the old extra Jeju decorative copy');
assert(!koreaOverlaySource.includes('decorativeNorthSilhouettePath') && !koreaOverlaySource.includes('dataset.decorativeNorthSilhouette'), 'Korea overlay must not render the deleted decorative northern peninsula silhouette');
assert(koreaOverlaySource.includes('KOREA_MAP_SOURCE_VIEWBOX') && koreaOverlaySource.includes("const KOREA_MAP_SOURCE_VIEWBOX = '0 0 100 100'"), 'Korea overlay must keep a named normalized source SVG viewBox contract');
assert(koreaOverlaySource.includes('KOREA_MAP_RENDER_VIEWBOX') && koreaOverlaySource.includes("const KOREA_MAP_RENDER_VIEWBOX = '0 0 100 124'"), 'Korea overlay must keep a named rectangular render viewBox contract');
assert(koreaOverlaySource.includes('KOREA_MAP_RENDER_HEIGHT') && koreaOverlaySource.includes('KOREA_MAP_RENDER_WIDTH'), 'Korea overlay must size render background layers from render constants');
assert(koreaOverlaySource.includes('KOREA_VECTOR_FIT_CONFIG') && koreaOverlaySource.includes('geometry-auto-fit') && koreaOverlaySource.includes('bboxForFeatures') && koreaOverlaySource.includes('renderedFeaturePoints'), 'Korea overlay must keep a named shared geometry-derived vector fit transform from rendered geometry');
assert(koreaOverlaySource.includes('ISLAND_RING_MIN_AREA') && koreaOverlaySource.includes('visibleRings') && koreaOverlaySource.includes('closedRingPath'), 'Korea overlay must draw significant coastline and island rings while dropping speck clutter');
assert(koreaOverlaySource.includes('normalized in the 0..100') && koreaOverlaySource.includes('geometry-derived fit'), 'Korea overlay alignment comment must document source-vs-render geometry auto-fit composition contract');
assert(!koreaOverlaySource.includes('korea-static-grain') && !koreaOverlaySource.includes('korea-terrain-contours'), 'Korea overlay must not render grain/wave texture layers over the ocean');
assert(!stylesSource.includes('.korea-island-reference') && !stylesSource.includes('.korea-island-hit-target'), 'Korea styles must not retain decorative island marker styling');
assert(!stylesSource.includes('.korea-north-silhouette'), 'Korea styles must remove the deleted north silhouette styling');

const pathEnds = boundaries.familyPathOrder.map((path) => path.at(-1)).sort();
sameMembers(pathEnds, ['kr-busan-haeundae', 'kr-gimhae-bonghwang', 'kr-seoul-mapo'], 'family path terminal regions');
const expectedTargets = new Map([
  ['busan-haeundae', { terminalFeatureId: 'kr-busan-haeundae', pathKo: ['부산광역시', '해운대구'] }],
  ['seoul-mapo', { terminalFeatureId: 'kr-seoul-mapo', pathKo: ['서울특별시', '마포구'] }],
  ['gyeongnam-gimhae-bonghwang', { terminalFeatureId: 'kr-gimhae-bonghwang', pathKo: ['경상남도', '김해시', '봉황동'] }],
]);
assert(Array.isArray(boundaries.familyTargetCoverage), 'boundary data must declare family target coverage');
assert(boundaries.familyTargetCoverage.length === expectedTargets.size, 'boundary data must cover exactly required family targets');
for (const target of boundaries.familyTargetCoverage) {
  const expected = expectedTargets.get(target.targetId);
  assert(expected, `unexpected family target coverage id: ${target.targetId}`);
  assert(target.terminalFeatureId === expected.terminalFeatureId, `${target.targetId} terminal feature mismatch`);
  assert(JSON.stringify(target.pathKo) === JSON.stringify(expected.pathKo), `${target.targetId} path labels mismatch`);
}

for (const requiredConstraint of ['No legal-boundary accuracy claims', 'No live map tiles, live map APIs, backend services, auth, or runtime API keys']) {
  assert(boundaries.usageConstraints.includes(requiredConstraint), `missing boundary usage constraint: ${requiredConstraint}`);
}
assert(provenance.committedAssetStrategy.status === 'official-source-documented-static', 'committed strategy must be official-source-documented-static');
assert(/decorative/i.test(provenance.committedAssetStrategy.accuracyNotice), 'provenance must keep decorative-only accuracy notice');
assert(provenance.verifiedSourceCandidates.some((source) => source.id === 'data-go-kr-molit-daily-legal-district-shp'), 'Korean official legal-boundary source candidate is required');
assert(provenance.verifiedSourceCandidates.some((source) => source.id === 'committed-natural-earth-110m-country-border-lines'), 'Natural Earth world border source is required');
assert(provenance.excludedSources.some((source) => source.id === 'live-map-tiles-or-client-api'), 'live map/API exclusion is required');
for (const source of provenance.verifiedSourceCandidates) {
  assert(source.url?.startsWith('https://'), `source ${source.id} must keep an https provenance URL`);
  assert(source.licenseSummary && source.permittedUseDecision && source.implementationNote, `source ${source.id} must keep license, decision, and implementation notes`);
}

assert(dataProvenance.schemaVersion === 1, 'data provenance schemaVersion must be 1');
assert(dataProvenance.staticFirstPolicy.runtimeDataFetchesRequired === false, 'core data must not require runtime fetches');
assert(dataProvenance.staticFirstPolicy.backendRequired === false, 'core data must not require a backend');
assert(dataProvenance.staticFirstPolicy.apiKeyRequired === false, 'core data must not require API keys');
assert(dataProvenance.koreaBoundaries.approvedSources.some((source) => source.id === 'data-go-kr-molit-daily-legal-district-shp'), 'Korea boundary source lock must include MOLIT daily legal district SHP');
for (const target of ['부산광역시/해운대구', '서울특별시/마포구', '경상남도/김해시/봉황동']) {
  assert(dataProvenance.koreaBoundaries.requiredFamilyTargets.includes(target), `missing family target ${target}`);
}
assert(dataProvenance.koreaBoundaries.excludedSources.includes('live-map-tiles-or-client-api'), 'Korea boundary source lock must forbid live map tiles/client APIs');

for (const [sourcePath, source] of [['src/main.ts', mainSource], ['src/koreaFamilyOverlay.ts', koreaOverlaySource], ['src/globeRenderer.ts', globeRendererSource]]) {
  assert(!/fetch\s*\(/.test(source), `${sourcePath} must not fetch Korea/map/weather data at runtime`);
  assert(!/open-?meteo|weather|forecast/i.test(source), `${sourcePath} must not reintroduce weather/forecast runtime UI`);
  assert(!/kakao|naver\s*map|google\s*maps|mapbox|leaflet|vworld\s*(?:api|sdk|tile|tiles)|vworld\.(?:kr|com)/i.test(source), `${sourcePath} must not depend on runtime map API`);
}

assert(assetsPolicySource.includes('NASA_GIBS_BLUE_MARBLE'), 'Earth imagery policy must declare the NASA GIBS Blue Marble source metadata');
assert(assetsPolicySource.includes('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi'), 'NASA GIBS imagery must use the official EPSG:4326 best WMS endpoint');
assert(assetsPolicySource.includes("layer: 'BlueMarble_NextGeneration'"), 'NASA GIBS imagery must lock the BlueMarble_NextGeneration layer');
assert(assetsPolicySource.includes("REQUEST: 'GetMap'"), 'NASA GIBS imagery URL builder must use a GetMap image request');
assert(assetsPolicySource.includes("BBOX: (request.bbox ?? NASA_GIBS_BLUE_MARBLE.bbox).join(',')"), 'NASA GIBS image helper must preserve explicit global bbox parameters');
assert(assetsPolicySource.includes('Earth imagery: NASA Global Imagery Browse Services (GIBS), BlueMarble_NextGeneration.'), 'NASA GIBS attribution text must stay with the imagery metadata');
assert(assetsPolicySource.includes('loadImageViaGet'), 'NASA GIBS primary imagery must keep an explicit browser image GET load helper');
assert(assetsPolicySource.includes('url: buildNasaGibsBlueMarbleWmsUrl()'), 'primary day asset must use the NASA GIBS URL builder');
assert(assetsPolicySource.includes('required: true'), 'NASA GIBS day imagery must remain required primary Earth imagery');
assert(assetsPolicySource.includes('shouldForcePrimaryTextureFailure'), 'fallback QA failure hook must remain available');
assert(assetsPolicySource.includes('shouldForcePrimaryTextureTimeout'), 'fallback QA timeout hook must remain available');
assert(globeRendererSource.includes('loadPrimaryEarthTexture'), 'globe renderer must use the primary Earth image helper for day imagery');
assert(globeRendererSource.includes('loadPrimaryEarthTexture(EARTH_ASSETS.day.url, EARTH_ASSETS.day.label)'), 'globe renderer must load primary Earth imagery with configured day asset url and label');
assert(globeRendererSource.includes('FALLBACK_ATTRIBUTION'), 'globe renderer must retain fallback attribution when primary Earth imagery fails');
assert(!/"(leaflet|mapbox-gl|@googlemaps\/[^\"]+|ol|kakao)"/.test(packageLockSource), 'package lock must not include runtime map API dependencies');

assert(stylesSource.includes('@font-face') && stylesSource.includes('Great Vibes Self Hosted'), 'hero script title must declare a self-hosted premium script font');
assert(stylesSource.includes('./assets/fonts/great-vibes-v21-latin-regular.woff2'), 'hero script title font must be bundled from src/assets/fonts');
assert(!/fonts\.(?:googleapis|gstatic)\.com/i.test(stylesSource), 'runtime CSS must not load the title font from Google/CDN hosts');
assert(!/@import\s+url\(https?:/i.test(stylesSource), 'runtime CSS must not import remote font stylesheets');
assert(worldBorders.schemaVersion === 1, 'world border schemaVersion must be 1');
assert(worldBorders.assetId === 'natural-earth-110m-admin0-country-border-lines-v1', 'world border asset id must be stable');
assert(Array.isArray(worldBorders.lines) && worldBorders.lines.length >= 150, 'world border asset must include broad country line coverage');
assert(worldBorders.lines.length <= 320, 'world border line count must stay inside static budget');
assert(Buffer.byteLength(worldBordersRaw, 'utf8') <= 220_000, 'world border JSON must stay below raw-size budget');

const expectedHouseholds = {
  parents: { label: '한가네 본가', location: '부산광역시 해운대구', names: ['한봉수', '이은주'], slots: 2, terminalRegion: 'kr-busan-haeundae' },
  sister: { label: '건희민하찬희네', location: '부산광역시 해운대구', names: ['한유진', '박재춘', '박건희', '박민하', '박찬희'], slots: 3, terminalRegion: 'kr-busan-haeundae' },
  brother: { label: '진주네', location: '서울특별시 마포구', names: ['한동석', '김혜리', '한진주'], slots: 1, terminalRegion: 'kr-seoul-mapo' },
  home: { label: '은하네', location: '경상남도 김해시 봉황동', names: ['한영석', '서혜빈', '한은하'], slots: 1, terminalRegion: 'kr-gimhae-bonghwang' },
};
for (const [householdId, expectation] of Object.entries(expectedHouseholds)) {
  assert(householdConfigSource.includes(`id: '${householdId}'`), `missing household config for ${householdId}`);
  assert(householdConfigSource.includes(`label: '${expectation.label}'`), `missing household label ${expectation.label}`);
  assert(householdConfigSource.includes(`locationLabel: '${expectation.location}'`), `missing household location ${expectation.location}`);
  for (const name of expectation.names) assert(householdConfigSource.includes(`'${name}'`), `missing accepted name ${name}`);
  const slotMatches = householdConfigSource.match(new RegExp(`householdId: '${householdId}'`, 'g')) ?? [];
  assert(slotMatches.length === expectation.slots, `${householdId} must have ${expectation.slots} Naver Band slot(s)`);
  assert(koreaOverlaySource.includes(expectation.terminalRegion), `Korea overlay must retain terminal region ${expectation.terminalRegion}`);
}
assert(koreaOverlaySource.includes('renderHouseholdCards'), 'Korea overlay must retain terminal household-card rendering');
assert(koreaOverlaySource.includes('nameGateState') && koreaOverlaySource.includes('암구호를 대시오!') && koreaOverlaySource.includes('암구호 틀림'), 'Korea overlay must retain terminal family passphrase gate flow');
assert(koreaOverlaySource.includes('setHighlightedRegion') && koreaOverlaySource.includes('data-region-id'), 'Korea overlay must cross-highlight route list and map regions');
assert(koreaOverlaySource.includes('highlightedHouseholdId') && koreaOverlaySource.includes('data-household-id') && koreaOverlaySource.includes('setHighlightedHousehold'), 'Korea overlay must cross-highlight household cards and map markers by household id');
assert(koreaOverlaySource.includes('pointerenter') && koreaOverlaySource.includes('focus'), 'Korea overlay cross-highlight must support pointer and keyboard focus');
assert(koreaOverlaySource.includes("dataset.mapStyle = 'vector-satellite-inspired'"), 'Korea overlay must expose the vector-only map style marker');
assert(!koreaOverlaySource.includes('korea-raster-layer') && !koreaOverlaySource.includes('korea-raster-image'), 'Korea overlay must not render raster layers or images');
assert(!koreaOverlaySource.includes('dataset.imageryState') && !koreaOverlaySource.includes('__KOREA_IMAGERY_FORCE_FALLBACK__'), 'Korea overlay must not retain raster imagery telemetry or fallback hooks');
assert(!assetsPolicySource.includes('KOREA_GIBS_BLUE_MARBLE'), 'Korea-specific GIBS raster constants must be removed while global Earth imagery remains');
assert(/grid-template-columns:\s*minmax\([^)]*1fr\)\s+minmax\([^)]*1fr\)/.test(stylesSource), 'Korea CSS must keep equal flexible PC map/detail columns');
assert(/@media \(max-width: 430px\)[\s\S]*\.korea-map-canvas[\s\S]*align-self:\s*center/.test(stylesSource), 'Korea CSS must center the smallest-mobile map canvas');
assert(stylesSource.includes('vector-satellite-inspired') && stylesSource.includes('.korea-map-canvas::before') && stylesSource.includes('.korea-map-canvas::after') && stylesSource.includes('aspect-ratio: 5 / 6.2'), 'Korea CSS must provide vector-only blue-ocean/green-land rectangular texture hooks');
const declaredSlotIds = householdConfigSource.match(/\{ id: '[^']+-band-\d+'/g) ?? [];
assert(declaredSlotIds.length === 7, 'household config must declare exactly 7 Band slot ids');
assert(new Set(declaredSlotIds).size === declaredSlotIds.length, 'declared household Band slot ids must be unique');
assert((householdConfigSource.match(/href: 'https:\/\/band\.us\/band\/[^']+'/g) ?? []).length === 7, 'household config must expose exactly 7 active band.us links');
assert((householdConfigSource.match(/, status: 'active' }/g) ?? []).length === 7, 'all household link slots must be active status');
assert(!householdConfigSource.includes('placeholder'), 'household config must not retain placeholder link semantics after real Band links are supplied');
assert(householdConfigSource.includes('validateHouseholdConfig(householdConfig)'), 'household config validation must remain exported');

assert(packageManifest.scripts?.['verify:data']?.includes('node scripts/verify-boundary-data.mjs'), 'npm verify:data must run boundary verifier');
assert(packageManifest.scripts?.['verify:data']?.includes('node scripts/verify-city-data.mjs'), 'npm verify:data must run city-data verifier');
assert(packageManifest.scripts?.verify?.includes('npm run verify:data'), 'npm verify must include boundary/provenance verification');
assert(rootReadme.includes('npm run verify'), 'root README must document npm verification');
assert(rootReadme.includes('src/mapData/boundaryProvenance.json'), 'root README must link provenance document');
assert(mapDataReadme.includes('worldCountryBorders.json'), 'map data README must document bundled world border asset');
assert(mapDataReadme.includes('npm run verify:data'), 'map data README must document verification command');
assert(mapDataReadme.includes('No live map API calls'), 'map data README must preserve no-live-map runtime constraint');
assert(rootReadme.includes('responsive scroll') || rootReadme.includes('same-stage morph'), 'root README must preserve responsive Korea overlay guidance');


const runtimeSourceFiles = [
  join(root, 'index.html'),
  join(root, 'package.json'),
  ...(await listFiles(join(root, 'src'))).filter((file) => /\.(ts|tsx|js|jsx|css)$/.test(file)),
];
const forbiddenRuntimePatterns = [
  { pattern: /fetch\s*\(/i, label: 'runtime fetch call' },
  { pattern: /XMLHttpRequest/i, label: 'runtime XMLHttpRequest' },
  { pattern: /open-?meteo|forecast|weather/i, label: 'weather/forecast runtime surface' },
  { pattern: /api[_-]?key|apikey|secret[_-]?key|access[_-]?token/i, label: 'runtime API key or secret token surface' },
  { pattern: /https?:\/\/(?:www\.)?(?:vworld\.kr|data\.go\.kr)|@?mapbox|google\.maps|kakao\.maps|naver\.maps/i, label: 'runtime map API/provider surface' },
  { pattern: /\blogin\b|\bauth\b|oauth|firebase|supabase/i, label: 'runtime auth/login/backend surface' },
];
for (const file of runtimeSourceFiles) {
  const source = await readFile(file, 'utf8');
  for (const { pattern, label } of forbiddenRuntimePatterns) {
    assert(!pattern.test(source), `${label} must not be introduced in runtime source: ${file.replace(root + '/', '')}`);
  }
}
assert(!runtimeSourceFiles.some((file) => file.replace(root + '/', '').startsWith('.omx/')), 'runtime source scan must not include .omx/ultragoal artifacts');


console.log('PASS boundary/provenance/household validation');
