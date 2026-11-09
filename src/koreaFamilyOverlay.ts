import koreaFamilyBoundaries from './mapData/koreaFamilyBoundaries.json';
import { getHouseholdLinks, householdConfig, isAcceptedHouseholdName, type Household, type HouseholdId } from './householdConfig';

type BoundaryFeature = {
  readonly id: string;
  readonly nameKo: string;
  readonly nameEn: string;
  readonly tier: string;
  readonly familyPathRole: string;
  readonly interactive: boolean;
  readonly polygon: readonly (readonly [number, number])[];
  readonly rings?: readonly (readonly (readonly [number, number])[])[];
  readonly centroid: readonly [number, number];
};

type ReferenceLine = {
  readonly id: string;
  readonly label: string;
  readonly points: readonly (readonly [number, number])[];
};

type OverlayData = {
  readonly features: readonly BoundaryFeature[];
  readonly worldReferenceLines: readonly ReferenceLine[];
};

const KOREA_MAP_SOURCE_VIEWBOX = '0 0 100 100';
const KOREA_MAP_RENDER_VIEWBOX = '0 0 100 124';
const KOREA_MAP_RENDER_WIDTH = 100;
const KOREA_MAP_RENDER_HEIGHT = 124;
// Vector-only contract: boundary coordinates stay normalized in the 0..100
// static source space while the render viewBox is taller. The visual layer uses
// a geometry-derived fit from the official overview regions instead of breakpoint
// specific manual offsets, so PC and mobile share one stable composition.
type BBox = { minX: number; minY: number; maxX: number; maxY: number };

const KOREA_VECTOR_FIT_CONFIG = {
  paddingLeft: 3,
  paddingRight: 3,
  paddingTop: 13,
  paddingBottom: 3,
} as const;

type KoreaVectorFit = {
  readonly strategy: 'geometry-auto-fit';
  readonly scale: number;
  readonly translateX: number;
  readonly translateY: number;
  readonly bounds: BBox;
  readonly fittedBounds: BBox;
};

let cachedKoreaVectorFit: KoreaVectorFit | null = null;

function roundFitValue(value: number) {
  return Math.round(value * 1000) / 1000;
}

function koreaVectorTransform() {
  const { translateX, translateY, scale } = getKoreaVectorFit();
  return `translate(${translateX} ${translateY}) scale(${scale})`;
}

type RegionId =
  | 'kr-korea-overview'
  | 'kr-seoul'
  | 'kr-busan'
  | 'kr-daegu'
  | 'kr-incheon'
  | 'kr-gwangju'
  | 'kr-daejeon'
  | 'kr-ulsan'
  | 'kr-sejong'
  | 'kr-gyeonggi'
  | 'kr-gangwon'
  | 'kr-chungbuk'
  | 'kr-chungnam'
  | 'kr-jeonbuk'
  | 'kr-jeonnam'
  | 'kr-gyeongbuk'
  | 'kr-gyeongnam'
  | 'kr-jeju'
  | 'kr-seoul-mapo'
  | 'kr-busan-haeundae'
  | 'kr-gyeongnam-gimhae'
  | 'kr-gimhae-bonghwang';

type OverlayState = {
  open: boolean;
  tier: string | null;
  selectedRegion: RegionId | null;
  selectedHousehold: HouseholdId | null;
  highlightedHouseholdId: HouseholdId | null;
  nameGateState: 'closed' | 'locked' | 'invalid' | 'unlocked';
  unlockedLinkCount: number;
};

type RouteNode = {
  readonly id: RegionId;
  readonly label: string;
  readonly next: readonly RegionId[];
  readonly parent?: RegionId;
  readonly households?: readonly HouseholdId[];
};

type RegionInfo = {
  readonly namuUrl: string;
  readonly landmark: string;
  readonly food: string;
  readonly fact: string;
};

type FamilyRouteSegment = {
  readonly id: string;
  readonly from: RegionId;
  readonly to: RegionId;
  readonly label: string;
};

export type KoreaFamilyOverlay = {
  open: () => void;
  close: () => void;
  getState: () => OverlayState;
};

type CreateOptions = {
  host: HTMLElement;
  onStateChange: () => void;
  onClose?: () => void;
};

const firstLevelRegionOrder = [
  'kr-seoul',
  'kr-busan',
  'kr-daegu',
  'kr-incheon',
  'kr-gwangju',
  'kr-daejeon',
  'kr-ulsan',
  'kr-sejong',
  'kr-gyeonggi',
  'kr-gangwon',
  'kr-chungbuk',
  'kr-chungnam',
  'kr-jeonbuk',
  'kr-jeonnam',
  'kr-gyeongbuk',
  'kr-gyeongnam',
  'kr-jeju',
] as const satisfies readonly RegionId[];

const routeNodes: Record<RegionId, RouteNode> = {
  'kr-korea-overview': {
    id: 'kr-korea-overview',
    label: '대한민국',
    next: firstLevelRegionOrder,
  },
  'kr-seoul': { id: 'kr-seoul', label: '서울특별시', next: ['kr-seoul-mapo'], parent: 'kr-korea-overview' },
  'kr-busan': { id: 'kr-busan', label: '부산광역시', next: ['kr-busan-haeundae'], parent: 'kr-korea-overview' },
  'kr-daegu': { id: 'kr-daegu', label: '대구광역시', next: [], parent: 'kr-korea-overview' },
  'kr-incheon': { id: 'kr-incheon', label: '인천광역시', next: [], parent: 'kr-korea-overview' },
  'kr-gwangju': { id: 'kr-gwangju', label: '광주광역시', next: [], parent: 'kr-korea-overview' },
  'kr-daejeon': { id: 'kr-daejeon', label: '대전광역시', next: [], parent: 'kr-korea-overview' },
  'kr-ulsan': { id: 'kr-ulsan', label: '울산광역시', next: [], parent: 'kr-korea-overview' },
  'kr-sejong': { id: 'kr-sejong', label: '세종특별자치시', next: [], parent: 'kr-korea-overview' },
  'kr-gyeonggi': { id: 'kr-gyeonggi', label: '경기도', next: [], parent: 'kr-korea-overview' },
  'kr-gangwon': { id: 'kr-gangwon', label: '강원특별자치도', next: [], parent: 'kr-korea-overview' },
  'kr-chungbuk': { id: 'kr-chungbuk', label: '충청북도', next: [], parent: 'kr-korea-overview' },
  'kr-chungnam': { id: 'kr-chungnam', label: '충청남도', next: [], parent: 'kr-korea-overview' },
  'kr-jeonbuk': { id: 'kr-jeonbuk', label: '전북특별자치도', next: [], parent: 'kr-korea-overview' },
  'kr-jeonnam': { id: 'kr-jeonnam', label: '전라남도', next: [], parent: 'kr-korea-overview' },
  'kr-gyeongbuk': { id: 'kr-gyeongbuk', label: '경상북도', next: [], parent: 'kr-korea-overview' },
  'kr-gyeongnam': { id: 'kr-gyeongnam', label: '경상남도', next: ['kr-gyeongnam-gimhae'], parent: 'kr-korea-overview' },
  'kr-jeju': { id: 'kr-jeju', label: '제주특별자치도', next: [], parent: 'kr-korea-overview' },
  'kr-busan-haeundae': { id: 'kr-busan-haeundae', label: '해운대구', next: [], parent: 'kr-busan', households: ['sister', 'parents'] },
  'kr-seoul-mapo': { id: 'kr-seoul-mapo', label: '마포구', next: [], parent: 'kr-seoul', households: ['brother'] },
  'kr-gyeongnam-gimhae': { id: 'kr-gyeongnam-gimhae', label: '김해시', next: ['kr-gimhae-bonghwang'], parent: 'kr-gyeongnam' },
  'kr-gimhae-bonghwang': { id: 'kr-gimhae-bonghwang', label: '봉황동', next: [], parent: 'kr-gyeongnam-gimhae', households: ['home'] },
};


const regionInfoById: Partial<Record<RegionId, RegionInfo>> = {
  'kr-seoul': { namuUrl: 'https://namu.wiki/w/서울특별시', landmark: '남산서울타워', food: '떡볶이', fact: '대한민국의 수도예요. 남산서울타워가 서 있고, 한강이 도시를 가로질러요.' },
  'kr-busan': { namuUrl: 'https://namu.wiki/w/부산광역시', landmark: '해운대해수욕장', food: '돼지국밥', fact: '인구로 보면 대한민국에서 두 번째로 큰 도시예요. 해운대 바다가 유명해요.' },
  'kr-gyeongnam': { namuUrl: 'https://namu.wiki/w/경상남도', landmark: '진해 경화역', food: '진주냉면', fact: '남해 바다와 지리산 자락이 만나요. 김해는 우리 가족이 사는 동네예요.' },
  'kr-daegu': { namuUrl: 'https://namu.wiki/w/대구광역시', landmark: '서문시장', food: '막창구이', fact: '산으로 둘러싸인 분지라 여름이 덥기로 유명해요. 사과도 많이 나요.' },
  'kr-incheon': { namuUrl: 'https://namu.wiki/w/인천광역시', landmark: '인천 차이나타운', food: '짜장면', fact: '서해로 나가는 관문 도시예요. 큰 국제공항과 차이나타운이 있어요.' },
  'kr-gwangju': { namuUrl: 'https://namu.wiki/w/광주광역시', landmark: '국립아시아문화전당', food: '광주 상추튀김', fact: '무등산이 곁에 있는 예술의 도시예요.' },
  'kr-daejeon': { namuUrl: 'https://namu.wiki/w/대전광역시', landmark: '엑스포과학공원', food: '칼국수', fact: '과학 연구가 많이 모인 도시예요. 엑스포과학공원이 있어요.' },
  'kr-ulsan': { namuUrl: 'https://namu.wiki/w/울산광역시', landmark: '대왕암공원', food: '언양불고기', fact: '대왕암과 고래 이야기로 이름난 바다 도시예요.' },
  'kr-sejong': { namuUrl: 'https://namu.wiki/w/세종특별자치시', landmark: '세종호수공원', food: '복숭아 디저트', fact: '정부 기관이 모여 있는 계획도시예요. 호수공원이 넓어요.' },
  'kr-gyeonggi': { namuUrl: 'https://namu.wiki/w/경기도', landmark: '수원화성', food: '수원 왕갈비', fact: '서울을 둘러싼 도이고, 광역자치단체 가운데 인구가 가장 많아요. 수원 화성이 있어요.' },
  'kr-gangwon': { namuUrl: 'https://namu.wiki/w/강원특별자치도', landmark: '설악산', food: '막국수', fact: '설악산과 동해 바다가 함께 있는 높은 산의 고장이에요.' },
  'kr-chungbuk': { namuUrl: 'https://namu.wiki/w/충청북도', landmark: '속리산 법주사', food: '올갱이국', fact: '나라의 한가운데에 있어요. 속리산 법주사가 유명해요.' },
  'kr-chungnam': { namuUrl: 'https://namu.wiki/w/충청남도', landmark: '공주 공산성', food: '게국지', fact: '서해와 맞닿아 있어요. 공주에는 백제 때의 공산성이 있어요.' },
  'kr-jeonbuk': { namuUrl: 'https://namu.wiki/w/전북특별자치도', landmark: '전주 한옥마을', food: '전주비빔밥', fact: '전주 한옥마을과 비빔밥으로 유명해요.' },
  'kr-jeonnam': { namuUrl: 'https://namu.wiki/w/전라남도', landmark: '순천만습지', food: '떡갈비', fact: '섬이 많은 남쪽 도예요. 순천만에는 넓은 갈대밭이 있어요.' },
  'kr-gyeongbuk': { namuUrl: 'https://namu.wiki/w/경상북도', landmark: '불국사', food: '안동찜닭', fact: '불국사와 석굴암이 있어요. 울릉도와 독도도 경상북도에 속해요.' },
  'kr-jeju': { namuUrl: 'https://namu.wiki/w/제주특별자치도', landmark: '성산일출봉', food: '흑돼지구이', fact: '우리나라에서 가장 큰 섬이에요. 한라산과 돌하르방이 있어요.' },
};

type OverviewPlace = {
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
  readonly dx: number;
  readonly dy: number;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly tier: 'major' | 'minor';
  readonly dot: boolean;
};

const overviewPlaces: readonly OverviewPlace[] = [
  { name: '서울', lon: 126.978, lat: 37.5665, dx: 1.35, dy: -1.55, anchor: 'start', tier: 'major', dot: true },
  { name: '인천', lon: 126.7052, lat: 37.4563, dx: -1.15, dy: 0.15, anchor: 'end', tier: 'major', dot: true },
  { name: '수원', lon: 127.0286, lat: 37.2636, dx: 1.2, dy: 1.15, anchor: 'start', tier: 'minor', dot: true },
  { name: '춘천', lon: 127.7298, lat: 37.8813, dx: 1.15, dy: -0.85, anchor: 'start', tier: 'minor', dot: true },
  { name: '강릉', lon: 128.8761, lat: 37.7519, dx: 1.2, dy: -0.7, anchor: 'start', tier: 'minor', dot: true },
  { name: '대전', lon: 127.3845, lat: 36.3504, dx: 1.25, dy: 0.95, anchor: 'start', tier: 'major', dot: true },
  { name: '전주', lon: 127.148, lat: 35.8242, dx: 1.2, dy: -0.9, anchor: 'start', tier: 'minor', dot: true },
  { name: '광주', lon: 126.8526, lat: 35.1595, dx: -1.2, dy: 0.15, anchor: 'end', tier: 'major', dot: true },
  { name: '목포', lon: 126.3922, lat: 34.8118, dx: -1.15, dy: 0.85, anchor: 'end', tier: 'minor', dot: true },
  { name: '여수', lon: 127.6622, lat: 34.7604, dx: 1.15, dy: 0.7, anchor: 'start', tier: 'minor', dot: true },
  { name: '대구', lon: 128.6014, lat: 35.8714, dx: -1.25, dy: -0.95, anchor: 'end', tier: 'major', dot: true },
  { name: '포항', lon: 129.3435, lat: 36.019, dx: 1.15, dy: -0.55, anchor: 'start', tier: 'minor', dot: true },
  { name: '울산', lon: 129.3114, lat: 35.5384, dx: 1.2, dy: -0.15, anchor: 'start', tier: 'major', dot: true },
  { name: '부산', lon: 129.0756, lat: 35.1796, dx: 1.25, dy: 0.95, anchor: 'start', tier: 'major', dot: true },
  { name: '제주', lon: 126.5312, lat: 33.4996, dx: 0, dy: 2.15, anchor: 'middle', tier: 'major', dot: true },
];

const seaLabels = [
  { name: '서해', lon: 125.05, lat: 36.2 },
  { name: '남해', lon: 126.55, lat: 34.05 },
  { name: '동해', lon: 130.45, lat: 37.35 },
] as const;

const selectedLabelNudge: Partial<Record<RegionId, readonly [number, number]>> = {
  'kr-jeju': [8.4, 1.1],
  'kr-seoul': [0, -2.6],
  'kr-gwangju': [0, 2.4],
  'kr-daejeon': [4.2, 0.2],
  'kr-ulsan': [3.6, -0.2],
  'kr-busan': [3.8, 1.1],
};

const householdMarkers: readonly { readonly householdId: HouseholdId; readonly regionId: RegionId; readonly dx: number; readonly dy: number }[] = [
  { householdId: 'parents', regionId: 'kr-busan-haeundae', dx: -0.55, dy: -0.38 },
  { householdId: 'sister', regionId: 'kr-busan-haeundae', dx: 0.55, dy: 0.38 },
  { householdId: 'brother', regionId: 'kr-seoul-mapo', dx: 0, dy: -0.34 },
  { householdId: 'home', regionId: 'kr-gimhae-bonghwang', dx: 0, dy: 0.18 },
];

const familyRouteSegments: readonly FamilyRouteSegment[] = [
  { id: 'route-country-busan', from: 'kr-korea-overview', to: 'kr-busan', label: '대한민국에서 부산광역시로 이어지는 가족 경로' },
  { id: 'route-busan-haeundae', from: 'kr-busan', to: 'kr-busan-haeundae', label: '부산광역시에서 해운대구 가족 자리로 확대' },
  { id: 'route-country-seoul', from: 'kr-korea-overview', to: 'kr-seoul', label: '대한민국에서 서울특별시로 이어지는 가족 경로' },
  { id: 'route-seoul-mapo', from: 'kr-seoul', to: 'kr-seoul-mapo', label: '서울특별시에서 마포구 가족 자리로 확대' },
  { id: 'route-country-gyeongnam', from: 'kr-korea-overview', to: 'kr-gyeongnam', label: '대한민국에서 경상남도로 이어지는 가족 경로' },
  { id: 'route-gyeongnam-gimhae', from: 'kr-gyeongnam', to: 'kr-gyeongnam-gimhae', label: '경상남도에서 김해시로 확대' },
  { id: 'route-gimhae-bonghwang', from: 'kr-gyeongnam-gimhae', to: 'kr-gimhae-bonghwang', label: '김해시에서 봉황동 가족 자리로 확대' },
];

function buildActiveRouteSegmentIdsByRegion() {
  const segmentByTarget = new Map<RegionId, FamilyRouteSegment>(familyRouteSegments.map((segment) => [segment.to, segment]));
  const activeEntries = (Object.keys(routeNodes) as RegionId[]).map((region) => {
    const routeIds: string[] = [];
    let cursor: RegionId | undefined = region;
    while (cursor) {
      const segment = segmentByTarget.get(cursor);
      if (!segment) break;
      routeIds.unshift(segment.id);
      cursor = segment.from;
    }
    return [region, routeIds] as const;
  });
  return Object.fromEntries(activeEntries) as unknown as Record<RegionId, readonly string[]>;
}

const activeRouteSegmentIdsByRegion = buildActiveRouteSegmentIdsByRegion();
const renderableRegionSet = new Set<RegionId>(
  (Object.keys(routeNodes) as RegionId[]).filter((id) => id !== 'kr-korea-overview')
);

function visibleRegionIdsFor(region: RegionId): readonly RegionId[] {
  const ids = new Set<RegionId>(firstLevelRegionOrder);
  if (region === 'kr-korea-overview') return [...ids];

  ids.add(region);
  routeNodes[region].next.forEach((nextId) => ids.add(nextId));

  // Keep the active ancestor path available for context/toggle behavior, but
  // never leak unrelated family drilldown polygons into the first overview.
  let parent = routeNodes[region].parent;
  while (parent && parent !== 'kr-korea-overview') {
    ids.add(parent);
    parent = routeNodes[parent].parent;
  }

  return [...ids].filter((id) => renderableRegionSet.has(id));
}

function polygonArea(points: readonly (readonly [number, number])[]) {
  const doubledArea = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  return Math.abs(doubledArea) / 2;
}

function appendText<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tagName: K, text: string, className?: string) {
  const element = document.createElement(tagName);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function closedRingPath(points: readonly (readonly [number, number])[]) {
  return `${points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')} Z`;
}

// Rings smaller than this are speck-level clutter at phone size. Larger detached
// rings are real islands (Incheon archipelago, south-coast islands, Ulleungdo)
// and administrative holes such as Gwangju inside Jeollanam-do.
const ISLAND_RING_MIN_AREA = 0.2;
const ULLEUNG_LEGIBILITY_SCALE = 1.85;
const KOREA_LON_LAT_FRAME = { minLon: 124, minLat: 33, maxLon: 132, maxLat: 39 } as const;

function ringSignedArea(points: readonly (readonly [number, number])[]) {
  const doubled = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  return doubled / 2;
}

function ringCentroid(points: readonly (readonly [number, number])[]): readonly [number, number] {
  const [x, y] = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]);
  return [x / points.length, y / points.length];
}

function projectLonLat(lon: number, lat: number): readonly [number, number] {
  const { minLon, minLat, maxLon, maxLat } = KOREA_LON_LAT_FRAME;
  return [
    ((lon - minLon) / (maxLon - minLon)) * 100,
    ((maxLat - lat) / (maxLat - minLat)) * 100,
  ];
}

function scaleRing(points: readonly (readonly [number, number])[], factor: number) {
  const [cx, cy] = ringCentroid(points);
  return points.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor] as const);
}

function dokdoSymbolRing() {
  // Dokdo (Liancourt Rocks) center, WGS84. The islet is enlarged around that
  // true projected point so children can see it; it is not a survey outline.
  const [cx, cy] = projectLonLat(131.865, 37.242);
  const shape = [
    [-1.05, -0.28],
    [-0.28, -0.7],
    [0.72, -0.22],
    [1.05, 0.28],
    [0.32, 0.72],
    [-0.62, 0.5],
  ] as const;
  return shape.map(([dx, dy]) => [cx + dx, cy + dy] as const);
}

function visibleRings(feature: BoundaryFeature) {
  const source = feature.rings?.length ? feature.rings : [feature.polygon];
  const kept = source.filter((ring) => Math.abs(ringSignedArea(ring)) >= ISLAND_RING_MIN_AREA);
  const rings = (kept.length ? kept : [feature.polygon]).map((ring) => {
    const [cx] = ringCentroid(ring);
    const area = Math.abs(ringSignedArea(ring));
    if (feature.id === 'kr-gyeongbuk' && cx > 80 && area < 4) return scaleRing(ring, ULLEUNG_LEGIBILITY_SCALE);
    return ring;
  });
  if (feature.id === 'kr-gyeongbuk') rings.push(dokdoSymbolRing());
  return rings;
}

function featurePath(feature: BoundaryFeature) {
  return visibleRings(feature).map((ring) => closedRingPath(ring)).join(' ');
}

function pathPoints(points: readonly (readonly [number, number])[]) {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
}

function featureById(id: RegionId) {
  const data = koreaFamilyBoundaries as unknown as OverlayData;
  const feature = data.features.find((candidate) => candidate.id === id);
  if (!feature) throw new Error(`Missing Korea family boundary feature: ${id}`);
  return feature;
}

function renderedFeaturePoints(feature: BoundaryFeature) {
  // Fit the same coastline and island rings that `featurePath()` draws, so
  // Jeju, Ulleungdo, Dokdo, and the west-coast islands stay inside the frame.
  return visibleRings(feature).flat();
}

function bboxForFeatures(regionIds: readonly RegionId[]): BBox {
  const points = regionIds.flatMap((id) => [...renderedFeaturePoints(featureById(id))]);
  if (points.length === 0) throw new Error('Cannot fit Korea map without boundary points');
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function fitBounds(bounds: BBox): KoreaVectorFit {
  const availableWidth = KOREA_MAP_RENDER_WIDTH - KOREA_VECTOR_FIT_CONFIG.paddingLeft - KOREA_VECTOR_FIT_CONFIG.paddingRight;
  const availableHeight = KOREA_MAP_RENDER_HEIGHT - KOREA_VECTOR_FIT_CONFIG.paddingTop - KOREA_VECTOR_FIT_CONFIG.paddingBottom;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const scale = Math.min(availableWidth / width, availableHeight / height);
  const targetCenterX = KOREA_VECTOR_FIT_CONFIG.paddingLeft + availableWidth / 2;
  const targetCenterY = KOREA_VECTOR_FIT_CONFIG.paddingTop + availableHeight / 2;
  const sourceCenterX = bounds.minX + width / 2;
  const sourceCenterY = bounds.minY + height / 2;
  const translateX = targetCenterX - scale * sourceCenterX;
  const translateY = targetCenterY - scale * sourceCenterY;
  return {
    strategy: 'geometry-auto-fit',
    scale: roundFitValue(scale),
    translateX: roundFitValue(translateX),
    translateY: roundFitValue(translateY),
    bounds,
    fittedBounds: {
      minX: roundFitValue(translateX + scale * bounds.minX),
      minY: roundFitValue(translateY + scale * bounds.minY),
      maxX: roundFitValue(translateX + scale * bounds.maxX),
      maxY: roundFitValue(translateY + scale * bounds.maxY),
    },
  };
}

function getKoreaVectorFit() {
  cachedKoreaVectorFit ??= fitBounds(bboxForFeatures(firstLevelRegionOrder));
  return cachedKoreaVectorFit;
}

function balanceRenderedVectorLayer(vectorLayer: SVGGElement, mapCanvas: HTMLElement, fit: KoreaVectorFit) {
  const canvasRect = mapCanvas.getBoundingClientRect();
  const regionRects = [...vectorLayer.querySelectorAll<SVGPathElement>('.korea-region')].map((region) => region.getBoundingClientRect());
  if (!canvasRect.width || !canvasRect.height || regionRects.length === 0) return fit;

  const rendered = {
    left: Math.min(...regionRects.map((rect) => rect.left)),
    right: Math.max(...regionRects.map((rect) => rect.right)),
    top: Math.min(...regionRects.map((rect) => rect.top)),
  };
  const renderedCenterX = (rendered.left + rendered.right) / 2;
  const targetCenterX = canvasRect.left + canvasRect.width / 2;
  const targetTop = canvasRect.top + canvasRect.height * (KOREA_VECTOR_FIT_CONFIG.paddingTop / KOREA_MAP_RENDER_HEIGHT);
  const xUnitsPerPixel = KOREA_MAP_RENDER_WIDTH / canvasRect.width;
  const yUnitsPerPixel = KOREA_MAP_RENDER_HEIGHT / canvasRect.height;
  const translateX = roundFitValue(fit.translateX + (targetCenterX - renderedCenterX) * xUnitsPerPixel);
  const translateY = roundFitValue(fit.translateY + (targetTop - rendered.top) * yUnitsPerPixel);
  const balancedFit = {
    ...fit,
    translateX,
    translateY,
    fittedBounds: {
      minX: roundFitValue(translateX + fit.scale * fit.bounds.minX),
      minY: roundFitValue(translateY + fit.scale * fit.bounds.minY),
      maxX: roundFitValue(translateX + fit.scale * fit.bounds.maxX),
      maxY: roundFitValue(translateY + fit.scale * fit.bounds.maxY),
    },
  };
  vectorLayer.setAttribute('transform', `translate(${balancedFit.translateX} ${balancedFit.translateY}) scale(${balancedFit.scale})`);
  return balancedFit;
}

function centroidOf(id: RegionId) {
  if (id === 'kr-korea-overview') return [52, 50] as const;
  return featureById(id).centroid;
}


function routePath(segment: FamilyRouteSegment) {
  const [x1, y1] = centroidOf(segment.from);
  const [x2, y2] = centroidOf(segment.to);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2 - Math.max(3, Math.abs(x2 - x1) * 0.12);
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

function householdById(id: HouseholdId) {
  const household = householdConfig.households.find((candidate) => candidate.id === id);
  if (!household) throw new Error(`Missing household config: ${id}`);
  return household;
}

export function createKoreaFamilyOverlay({ host, onStateChange, onClose }: CreateOptions): KoreaFamilyOverlay {
  let openState = false;
  let selectedRegion: RegionId = 'kr-korea-overview';
  let selectedHousehold: HouseholdId | null = null;
  let highlightedRegion: RegionId | null = null;
  let highlightedHouseholdId: HouseholdId | null = null;
  let nameGateState: OverlayState['nameGateState'] = 'closed';
  let unlockedHousehold: HouseholdId | null = null;

  const header = document.createElement('div');
  header.className = 'korea-map-header';
  const mapMount = document.createElement('div');
  mapMount.className = 'korea-map-canvas';
  const routePanel = document.createElement('div');
  routePanel.className = 'korea-route-panel';

  const closeButton = document.createElement('button');
  closeButton.className = 'ghost korea-close';
  closeButton.type = 'button';
  closeButton.textContent = '지구본으로 돌아가기';

  host.classList.add('korea-map-overlay');
  host.dataset.mapStyle = 'vector-satellite-inspired';
  host.dataset.mapPalette = 'deep-ocean-vector';
  host.dataset.mapContract = 'geometry-auto-fit';
  host.dataset.islandCoverage = 'province-rings';
  host.dataset.familyTraces = 'hidden';
  mapMount.dataset.mapStyle = 'vector-satellite-inspired';
  mapMount.dataset.familyTraces = 'hidden';
  host.hidden = true;
  host.setAttribute('aria-hidden', 'true');
  host.append(header, mapMount, routePanel);

  function state(): OverlayState {
    return {
      open: openState,
      tier: openState ? routeNodes[selectedRegion].label : null,
      selectedRegion: openState ? selectedRegion : null,
      selectedHousehold,
      highlightedHouseholdId: openState ? highlightedHouseholdId : null,
      nameGateState: openState ? nameGateState : 'closed',
      unlockedLinkCount: openState && selectedHousehold && unlockedHousehold === selectedHousehold ? getHouseholdLinks(selectedHousehold).length : 0,
    };
  }

  function syncHighlightState() {
    const suppressSelectedParentLabel = Boolean(
      highlightedHouseholdId || (highlightedRegion && highlightedRegion !== selectedRegion)
    );
    host.querySelectorAll<HTMLElement | SVGElement>('[data-region-id]').forEach((element) => {
      element.classList.toggle('is-highlighted', Boolean(highlightedRegion && element.dataset.regionId === highlightedRegion));
      element.classList.toggle(
        'is-suppressed',
        element.classList.contains('is-parent-label') && element.dataset.regionId === selectedRegion && suppressSelectedParentLabel
      );
    });
    host.querySelectorAll<HTMLElement | SVGElement>('[data-household-id]').forEach((element) => {
      const householdId = element.dataset.householdId as HouseholdId | undefined;
      const isHighlighted = Boolean(highlightedHouseholdId && householdId === highlightedHouseholdId);
      const isSelected = Boolean(selectedHousehold && householdId === selectedHousehold);
      element.classList.toggle('is-highlighted', isHighlighted);
      element.classList.toggle('is-selected-household', isSelected);
    });
  }

  function setHighlightedRegion(region: RegionId | null) {
    highlightedRegion = region;
    syncHighlightState();
    onStateChange();
  }

  function setHighlightedHousehold(householdId: HouseholdId | null) {
    highlightedHouseholdId = householdId;
    syncHighlightState();
    onStateChange();
  }

  function setRegion(region: RegionId) {
    highlightedRegion = null;
    highlightedHouseholdId = null;
    selectedRegion = region;
    selectedHousehold = null;
    nameGateState = 'closed';
    unlockedHousehold = null;
    render();
    onStateChange();
  }

  function activateRegion(region: RegionId) {
    if (region === selectedRegion && routeNodes[region].parent) {
      setRegion(routeNodes[region].parent);
      return;
    }
    setRegion(region);
  }

  function setHousehold(householdId: HouseholdId) {
    selectedHousehold = householdId;
    highlightedHouseholdId = householdId;
    nameGateState = 'locked';
    unlockedHousehold = null;
    renderHouseholdDetail(householdById(householdId));
    syncHighlightState();
    onStateChange();
  }

  function renderHeader() {
    header.replaceChildren();
    const copy = document.createElement('div');
    appendText(copy, 'h2', routeNodes[selectedRegion].label);
    const factLine = appendText(
      copy,
      'p',
      regionInfoById[selectedRegion]?.fact ?? '지역을 눌러 이름과 짧은 이야기를 들어 봐요.',
      'korea-fact-line',
    );
    factLine.dataset.regionFact = selectedRegion;
    const breadcrumbs = document.createElement('div');
    breadcrumbs.className = 'korea-breadcrumbs';
    const rootButton = document.createElement('button');
    rootButton.type = 'button';
    rootButton.textContent = '대한민국';
    rootButton.disabled = selectedRegion === 'kr-korea-overview';
    rootButton.addEventListener('click', () => setRegion('kr-korea-overview'));
    breadcrumbs.append(rootButton);
    if (selectedRegion !== 'kr-korea-overview') {
      const current = appendText(breadcrumbs, 'span', `› ${routeNodes[selectedRegion].label}`);
      current.setAttribute('aria-current', 'page');
    }
    copy.append(breadcrumbs);
    header.append(copy, closeButton);
  }

  function renderMap() {
    mapMount.replaceChildren();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', KOREA_MAP_RENDER_VIEWBOX);
    svg.dataset.sourceViewbox = KOREA_MAP_SOURCE_VIEWBOX;
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '가족 경로 중심의 한국 지도');

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <radialGradient id="korea-map-glow" cx="50%" cy="45%" r="70%">
        <stop offset="0%" stop-color="#0ea5e9" stop-opacity="0.12"/>
        <stop offset="64%" stop-color="#075985" stop-opacity="0.08"/>
        <stop offset="100%" stop-color="#03152f" stop-opacity="0.06"/>
      </radialGradient>
      <linearGradient id="korea-land-terrain" x1="18%" y1="10%" x2="86%" y2="92%">
        <stop offset="0%" stop-color="#bbf7d0" stop-opacity="0.64"/>
        <stop offset="43%" stop-color="#4ade80" stop-opacity="0.50"/>
        <stop offset="72%" stop-color="#16a34a" stop-opacity="0.42"/>
        <stop offset="100%" stop-color="#14532d" stop-opacity="0.34"/>
      </linearGradient>
      <linearGradient id="korea-selected-terrain" x1="16%" y1="8%" x2="86%" y2="92%">
        <stop offset="0%" stop-color="#ecfccb" stop-opacity="0.78"/>
        <stop offset="58%" stop-color="#86efac" stop-opacity="0.60"/>
        <stop offset="100%" stop-color="#22c55e" stop-opacity="0.46"/>
      </linearGradient>
      <radialGradient id="korea-map-vignette" cx="50%" cy="48%" r="68%">
        <stop offset="58%" stop-color="#0f172a" stop-opacity="0"/>
        <stop offset="100%" stop-color="#020617" stop-opacity="0.74"/>
      </radialGradient>
      <linearGradient id="korea-land-sheen" x1="20%" y1="0%" x2="80%" y2="100%">
        <stop offset="0%" stop-color="#fff7e8" stop-opacity="0.55"/>
        <stop offset="42%" stop-color="#ffffff" stop-opacity="0.05"/>
        <stop offset="100%" stop-color="#123524" stop-opacity="0.28"/>
      </linearGradient>
      <filter id="korea-land-soft-shadow" x="-18%" y="-18%" width="136%" height="136%">
        <feDropShadow dx="0" dy="0.35" stdDeviation="0.42" flood-color="#020617" flood-opacity="0.55"/>
        <feDropShadow dx="0" dy="-0.12" stdDeviation="0.18" flood-color="#dcfce7" flood-opacity="0.16"/>
      </filter>`;
    svg.append(defs);
    const oceanGlow = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    oceanGlow.setAttribute('x', '0');
    oceanGlow.setAttribute('y', '0');
    oceanGlow.setAttribute('width', String(KOREA_MAP_RENDER_WIDTH));
    oceanGlow.setAttribute('height', String(KOREA_MAP_RENDER_HEIGHT));
    oceanGlow.setAttribute('fill', 'url(#korea-map-glow)');
    svg.append(oceanGlow);
    const selectedNode = routeNodes[selectedRegion];
    const nextIds = new Set(selectedNode.next);
    const householdTarget = new Set<RegionId>(selectedNode.households ? [selectedRegion] : []);
    const familyTraceState = selectedNode.households?.length ? 'terminal' : 'hidden';
    host.dataset.familyTraces = familyTraceState;
    mapMount.dataset.familyTraces = familyTraceState;

    const vectorLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    vectorLayer.setAttribute('class', 'korea-vector-layer');
    vectorLayer.setAttribute('transform', koreaVectorTransform());
    svg.append(vectorLayer);

    const paintOrder = [...visibleRegionIdsFor(selectedRegion)].sort((a, b) => polygonArea(featureById(b).polygon) - polygonArea(featureById(a).polygon));
    const landmass = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    landmass.setAttribute('class', 'korea-landmass');
    vectorLayer.append(landmass);
    for (const id of paintOrder) {
      const feature = featureById(id);
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      polygon.setAttribute('d', featurePath(feature));
      const isSelected = id === selectedRegion;
      const isNext = nextIds.has(id);
      const isHouseholdTarget = householdTarget.has(id);
      polygon.setAttribute('class', ['korea-region', isSelected ? 'is-selected' : '', isNext ? 'is-next' : '', isHouseholdTarget ? 'has-households' : ''].filter(Boolean).join(' '));
      polygon.dataset.regionId = id;
      polygon.setAttribute('aria-label', isNext ? `${feature.nameKo}로 확대` : isSelected ? `${feature.nameKo} 선택됨` : feature.nameKo);
      const isToggleTarget = isSelected && Boolean(selectedNode.parent);
      if (isNext || isToggleTarget) {
        polygon.setAttribute('tabindex', '0');
        polygon.setAttribute('role', 'button');
        polygon.addEventListener('pointerenter', () => setHighlightedRegion(id));
        polygon.addEventListener('pointerleave', () => setHighlightedRegion(null));
        polygon.addEventListener('focus', () => setHighlightedRegion(id));
        polygon.addEventListener('blur', () => setHighlightedRegion(null));
        polygon.addEventListener('click', () => activateRegion(id));
        polygon.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activateRegion(id);
          }
        });
      }
      landmass.append(polygon);

      const shouldPinSelectedLabel = isSelected && selectedRegion !== 'kr-korea-overview';
      if (shouldPinSelectedLabel || isNext) {
        const [x, y] = feature.centroid;
        const [nudgeX, nudgeY] = shouldPinSelectedLabel ? selectedLabelNudge[id] ?? [0, 0] : [0, 0];
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', String(x + nudgeX));
        label.setAttribute('y', String(y + nudgeY));
        label.setAttribute('class', ['korea-map-label', shouldPinSelectedLabel ? 'is-selected-label' : 'is-next-label', shouldPinSelectedLabel ? 'is-parent-label' : ''].filter(Boolean).join(' '));
        label.dataset.regionId = id;
        label.textContent = feature.nameKo;
        vectorLayer.append(label);
      }
    }
    const sheen = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    sheen.setAttribute('class', 'korea-land-sheen');
    sheen.setAttribute('aria-hidden', 'true');
    for (const id of paintOrder) {
      if (id === selectedRegion) continue;
      const shine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      shine.setAttribute('d', featurePath(featureById(id)));
      shine.setAttribute('fill-rule', 'evenodd');
      sheen.append(shine);
    }
    vectorLayer.insertBefore(sheen, landmass.nextSibling);

    if (selectedRegion === 'kr-korea-overview') {
      const places = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      places.setAttribute('class', 'korea-place-layer');
      places.setAttribute('aria-hidden', 'true');
      for (const place of overviewPlaces) {
        const [x, y] = projectLonLat(place.lon, place.lat);
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', `korea-place is-${place.tier}`);
        if (place.dot) {
          const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot.setAttribute('class', 'korea-place-dot');
          dot.setAttribute('cx', String(x));
          dot.setAttribute('cy', String(y));
          dot.setAttribute('r', place.tier === 'major' ? '0.62' : '0.46');
          group.append(dot);
        }
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'korea-place-label');
        text.setAttribute('x', String(x + place.dx));
        text.setAttribute('y', String(y + place.dy));
        text.setAttribute('text-anchor', place.anchor);
        text.textContent = place.name;
        group.append(text);
        places.append(group);
      }
      const [ulleungX, ulleungY] = projectLonLat(130.905, 37.484);
      const ulleung = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      ulleung.setAttribute('class', 'korea-place-label is-island');
      ulleung.setAttribute('x', String(ulleungX));
      ulleung.setAttribute('y', String(ulleungY - 2.15));
      ulleung.setAttribute('text-anchor', 'middle');
      ulleung.textContent = '울릉도';
      places.append(ulleung);
      const [dokdoX, dokdoY] = projectLonLat(131.865, 37.242);
      const dokdo = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      dokdo.setAttribute('class', 'korea-place-label is-island');
      dokdo.setAttribute('x', String(dokdoX - 1.45));
      dokdo.setAttribute('y', String(dokdoY - 0.15));
      dokdo.setAttribute('text-anchor', 'end');
      dokdo.textContent = '독도';
      places.append(dokdo);
      for (const sea of seaLabels) {
        const [x, y] = projectLonLat(sea.lon, sea.lat);
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'korea-sea-label');
        text.setAttribute('x', String(x));
        text.setAttribute('y', String(y));
        text.setAttribute('text-anchor', 'middle');
        text.textContent = sea.name;
        places.append(text);
      }
      vectorLayer.append(places);
    }

    if (familyTraceState === 'terminal') {
      householdMarkers.forEach((markerModel) => {
        const feature = featureById(markerModel.regionId);
        const household = householdById(markerModel.householdId);
        const [cx, cy] = feature.centroid;
        const x = cx + markerModel.dx;
        const y = cy + markerModel.dy;
        const activeRegion = selectedRegion === markerModel.regionId;
        const isSelectedHousehold = selectedHousehold === markerModel.householdId;
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', ['household-marker', activeRegion ? 'is-active' : '', isSelectedHousehold ? 'is-selected-household' : ''].filter(Boolean).join(' '));
        group.dataset.householdId = markerModel.householdId;
        group.setAttribute('tabindex', '0');
        group.setAttribute('role', 'button');
        group.setAttribute('aria-label', `${household.label} 지도 포인트`);
        const openMarker = () => {
          if (selectedRegion !== markerModel.regionId) setRegion(markerModel.regionId);
          setHousehold(markerModel.householdId);
        };
        group.addEventListener('pointerenter', () => setHighlightedHousehold(markerModel.householdId));
        group.addEventListener('pointerleave', () => setHighlightedHousehold(null));
        group.addEventListener('focus', () => setHighlightedHousehold(markerModel.householdId));
        group.addEventListener('blur', () => setHighlightedHousehold(null));
        group.addEventListener('click', openMarker);
        group.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openMarker();
          }
        });

        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', String(x));
        dot.setAttribute('cy', String(y));
        dot.setAttribute('r', activeRegion ? '0.72' : '0.58');
        dot.setAttribute('class', 'household-marker-dot');
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', String(x));
        label.setAttribute('y', String(y - 4.2));
        label.setAttribute('class', 'household-marker-label');
        label.textContent = household.label;
        group.append(dot, label);
        vectorLayer.append(group);
      });
    }

    const vignette = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    vignette.setAttribute('x', '0');
    vignette.setAttribute('y', '0');
    vignette.setAttribute('width', String(KOREA_MAP_RENDER_WIDTH));
    vignette.setAttribute('height', String(KOREA_MAP_RENDER_HEIGHT));
    vignette.setAttribute('class', 'korea-map-vignette');
    vignette.setAttribute('fill', 'url(#korea-map-vignette)');
    vignette.setAttribute('aria-hidden', 'true');
    svg.append(vignette);

    const fit = getKoreaVectorFit();
    mapMount.append(svg);
    const balancedFit = balanceRenderedVectorLayer(vectorLayer, mapMount, fit);
    mapMount.dataset.mapPalette = host.dataset.mapPalette ?? 'deep-ocean-vector';
    mapMount.dataset.mapContract = host.dataset.mapContract ?? 'geometry-auto-fit';
    mapMount.dataset.islandCoverage = host.dataset.islandCoverage ?? 'province-rings';
    mapMount.dataset.hasSelection = selectedRegion === 'kr-korea-overview' ? 'false' : 'true';
    mapMount.dataset.fitStrategy = balancedFit.strategy;
    mapMount.dataset.fitScale = String(balancedFit.scale);
    mapMount.dataset.fitBounds = `${balancedFit.fittedBounds.minX},${balancedFit.fittedBounds.minY},${balancedFit.fittedBounds.maxX},${balancedFit.fittedBounds.maxY}`;
  }

  function renderRegionInfo(node: RouteNode, regionInfo: RegionInfo) {
    const section = document.createElement('section');
    section.className = 'region-info-section';
    appendText(section, 'p', '이 고장의 이야기', 'map-kicker');
    appendText(section, 'h3', node.label);
    appendText(section, 'p', regionInfo.fact, 'region-fun-fact');
    const details = document.createElement('dl');
    details.className = 'region-info-list';
    appendText(details, 'dt', 'Landmark');
    appendText(details, 'dd', regionInfo.landmark);
    appendText(details, 'dt', 'Food');
    appendText(details, 'dd', regionInfo.food);
    const link = document.createElement('a');
    link.href = regionInfo.namuUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.className = 'region-info-link';
    link.textContent = '나무위키에서 더 보기 ↗';
    section.append(details, link);
    routePanel.append(section);
  }

  function renderNextStep(node: RouteNode) {
    appendText(routePanel, 'p', selectedRegion === 'kr-korea-overview' ? '17 광역자치단체' : 'Next stop', 'map-kicker');
    appendText(routePanel, 'h3', selectedRegion === 'kr-korea-overview' ? '대한민국 17개 광역 행정구역' : '가족이 있는 지역으로 한 단계 더 들어가기');
    if (selectedRegion === 'kr-korea-overview') {
      appendText(routePanel, 'p', '색이 다른 지역을 누르면 이름과 짧은 이야기가 나와요. 서울, 부산, 경상남도는 가족 집까지 한 단계 더 들어갈 수 있어요.');
    }
    const choices = document.createElement('div');
    choices.className = 'route-choice-grid';
    node.next.forEach((nextId) => {
      const feature = featureById(nextId);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'route-choice';
      button.dataset.regionId = nextId;
      button.addEventListener('pointerenter', () => setHighlightedRegion(nextId));
      button.addEventListener('pointerleave', () => setHighlightedRegion(null));
      button.addEventListener('focus', () => setHighlightedRegion(nextId));
      button.addEventListener('blur', () => setHighlightedRegion(null));
      appendText(button, 'strong', feature.nameKo);
      appendText(button, 'span', feature.nameEn);
      button.addEventListener('click', () => activateRegion(nextId));
      choices.append(button);
    });
    routePanel.append(choices);
    syncHighlightState();
  }

  function renderHouseholdCards(node: RouteNode) {
    appendText(routePanel, 'p', 'Family homes', 'map-kicker');
    appendText(routePanel, 'h3', `${node.label}에 있는 가족`);
    const cards = document.createElement('div');
    cards.className = 'household-card-grid';
    node.households?.forEach((householdId) => {
      const household = householdById(householdId);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = ['household-card', selectedHousehold === household.id ? 'is-selected-household' : ''].filter(Boolean).join(' ');
      card.dataset.householdId = household.id;
      card.addEventListener('pointerenter', () => setHighlightedHousehold(household.id));
      card.addEventListener('pointerleave', () => setHighlightedHousehold(null));
      card.addEventListener('focus', () => setHighlightedHousehold(household.id));
      card.addEventListener('blur', () => setHighlightedHousehold(null));
      appendText(card, 'strong', household.label);
      appendText(card, 'span', household.locationLabel);
      card.addEventListener('click', () => setHousehold(household.id));
      cards.append(card);
    });
    routePanel.append(cards);
  }

  function renderRoutePanel() {
    routePanel.replaceChildren();
    const node = routeNodes[selectedRegion];
    const regionInfo = regionInfoById[selectedRegion];
    if (regionInfo) renderRegionInfo(node, regionInfo);
    if (node.next.length) {
      renderNextStep(node);
      return;
    }
    if (node.households?.length) {
      renderHouseholdCards(node);
      return;
    }
    if (!regionInfo) {
      appendText(routePanel, 'p', '관할 기초자치단체', 'map-kicker');
      appendText(routePanel, 'h3', node.label);
      appendText(routePanel, 'p', '가족 목적지가 있는 곳만 더 깊게 열립니다.');
    }
  }

  function renderHouseholdDetail(household: Household) {
    routePanel.replaceChildren();
    appendText(routePanel, 'p', 'Selected family', 'map-kicker');
    appendText(routePanel, 'h3', household.label);
    appendText(routePanel, 'p', household.locationLabel);

    const gate = document.createElement('form');
    gate.className = 'name-gate';
    gate.setAttribute('aria-label', `${household.label} 암구호 확인`);

    const label = document.createElement('label');
    label.textContent = '암구호를 대시오!';
    label.setAttribute('for', `name-gate-${household.id}`);
    const input = document.createElement('input');
    input.id = `name-gate-${household.id}`;
    input.name = 'family-passphrase';
    input.type = 'text';
    input.autocomplete = 'off';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'primary';
    submit.textContent = '암구호 확인';
    label.append(input);
    gate.prepend(label);
    gate.append(submit);

    const feedback = document.createElement('p');
    feedback.className = 'name-gate-feedback';
    feedback.setAttribute('aria-live', 'polite');
    if (nameGateState === 'invalid') feedback.textContent = '암구호 틀림';
    routePanel.append(gate, feedback);

    const links = document.createElement('div');
    links.className = 'band-link-grid';
    if (unlockedHousehold === household.id) {
      feedback.textContent = '암구호 확인 완료';
      getHouseholdLinks(household.id).forEach((slot) => {
        const link = document.createElement('a');
        link.href = slot.href;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.className = 'band-link';
        appendText(link, 'strong', slot.label);
        appendText(link, 'span', '가족 밴드 열기 ↗');
        links.append(link);
      });
      routePanel.append(links);
    }

    gate.addEventListener('submit', (event) => {
      event.preventDefault();
      if (isAcceptedHouseholdName(household.id, input.value)) {
        unlockedHousehold = household.id;
        nameGateState = 'unlocked';
      } else {
        unlockedHousehold = null;
        nameGateState = 'invalid';
      }
      renderHouseholdDetail(household);
      onStateChange();
    });

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'ghost wide';
    back.textContent = '다른 가족 카드 보기';
    back.addEventListener('click', () => {
      setRegion('kr-korea-overview');
    });
    routePanel.append(back);
  }

  function render() {
    host.hidden = !openState;
    host.setAttribute('aria-hidden', String(!openState));
    if (!openState) {
      host.dataset.familyTraces = 'hidden';
      mapMount.dataset.familyTraces = 'hidden';
      return;
    }
    renderHeader();
    renderMap();
    renderRoutePanel();
  }

  closeButton.addEventListener('click', () => {
    openState = false;
    selectedRegion = 'kr-korea-overview';
    selectedHousehold = null;
    highlightedHouseholdId = null;
    nameGateState = 'closed';
    unlockedHousehold = null;
    render();
    onClose?.();
    onStateChange();
  });

  return {
    open: () => {
      openState = true;
      selectedRegion = 'kr-korea-overview';
      highlightedRegion = null;
      highlightedHouseholdId = null;
      selectedHousehold = null;
      nameGateState = 'closed';
      unlockedHousehold = null;
      render();
      onStateChange();
    },
    close: () => {
      openState = false;
      highlightedRegion = null;
      highlightedHouseholdId = null;
      nameGateState = 'closed';
      unlockedHousehold = null;
      render();
      onClose?.();
      onStateChange();
    },
    getState: state,
  };
}
