import * as THREE from 'three';
import type { ExplorationOverlay } from './explorationOverlay';
import { createGlobeRenderer } from './globeRenderer';
import type { KoreaFamilyOverlay } from './koreaFamilyOverlay';
import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app');

app.innerHTML = `
  <main class="shell">
    <section class="hero" aria-label="선물 소개">
      <p class="eyebrow">A family constellation on Earth</p>
      <h1><span class="script-title">Where every journey begins with family</span></h1>
      <p class="message">Across oceans, cities, and time, our hearts always find the same light — home.</p>
      <div class="actions">
        <button class="primary" data-action="start">지구본 열기</button>
        <button class="ghost" data-action="explore">탐험 모드 열기</button>
      </div>
    </section>

    <section class="globe-stage" aria-label="인터랙티브 3D 지구본" data-earth-state="boot">
      <canvas id="globe" aria-label="마우스나 터치로 회전 가능한 실제 지구 느낌의 3D 지구본"></canvas>
      <div class="halo"></div>
      <div class="earth-status" aria-live="polite">
        <strong data-state-label>Our Earth</strong>
        <span data-state-copy>where are you? where do you want to go?</span>
      </div>
      <div class="hint">드래그해서 지구를 돌리고, 탐험 모드에서 세계의 수도와 인기 도시를 만나보세요</div>
      <button type="button" class="korea-tap-hint" data-korea-hint hidden>한국을 눌러 보세요</button>
      <section class="korea-map-host" aria-label="한국 가족 지도"></section>
    </section>

    <aside class="panel" aria-label="탐색 상태">
      <div>
        <p class="panel-label">Discovery mode</p>
        <h2 data-tier-title>세계의 수도</h2>
        <p data-tier-copy>탐험 모드를 켜면 검증된 수도들이 지구 위에 빛납니다.</p>
      </div>
      <p class="discovery-count"><strong data-visible-count>0</strong><span> places ready</span></p>
      <button class="ghost wide" data-action="toggle-tier" disabled>TOP 100 인기 도시 보기</button>
      <article class="city-card" data-empty="true" aria-live="polite"></article>
      <div class="region-list" data-region-list></div>
    </aside>

    <section class="top100-bottom-list" data-top100-bottom-list hidden aria-label="TOP 100 인기 도시 목록"></section>
  </main>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#globe')!;
const stage = document.querySelector<HTMLElement>('.globe-stage')!;
const startButton = document.querySelector<HTMLButtonElement>('[data-action="start"]')!;
const explorationButton = document.querySelector<HTMLButtonElement>('[data-action="explore"]')!;
const tierButton = document.querySelector<HTMLButtonElement>('[data-action="toggle-tier"]')!;
const stateLabel = document.querySelector<HTMLElement>('[data-state-label]')!;
const stateCopy = document.querySelector<HTMLElement>('[data-state-copy]')!;
const koreaMapHost = document.querySelector<HTMLElement>('.korea-map-host')!;

let koreaFamilyEntryRequested = false;
let koreaFamilyOverlay: KoreaFamilyOverlay | null = null;
let koreaOverlayLoad: Promise<KoreaFamilyOverlay> | null = null;
let overlay: ExplorationOverlay | null = null;
let explorationOverlayLoad: Promise<ExplorationOverlay> | null = null;

type GlobeQaSnapshot = {
  globeRotation: { x: number; y: number; z: number };
  [key: string]: unknown;
};

const QA_ROTATION_INTERVAL_MS = 200;
let lastQaRotationAt = 0;

function qaSnapshot(): GlobeQaSnapshot | undefined {
  return (window as Window & { __GLOBE_QA__?: GlobeQaSnapshot }).__GLOBE_QA__;
}

function updateQaState() {
  const selectedCity = overlay?.getSelectedCity() ?? null;
  const lastFocus = overlay?.getLastFocus() ?? null;
  const overlayQa = overlay?.getQaState() ?? {
    selectedCityMarkerGlowVisible: false,
    selectedMarkerGlowCityId: null,
    selectedCityListHighlighted: false,
  };
  lastQaRotationAt = performance.now();
  (window as Window & { __GLOBE_QA__?: GlobeQaSnapshot }).__GLOBE_QA__ = {
    state: globe.getState(),
    viewMode: globe.getViewMode(),
    globeRotation: globe.getRotation(),
    explorationMode: overlay?.getExplorationMode() ?? false,
    selectedCity: selectedCity ? {
      id: selectedCity.id,
      city: selectedCity.city,
      rank: selectedCity.rank ?? null,
    } : null,
    selectedCityId: selectedCity?.id ?? null,
    selectedCityName: selectedCity?.city ?? null,
    selectedCityRank: selectedCity?.rank ?? null,
    selectedCityCardOpen: Boolean(selectedCity),
    selectedCityMarkerGlowVisible: overlayQa.selectedCityMarkerGlowVisible,
    selectedMarkerGlowCityId: overlayQa.selectedMarkerGlowCityId,
    selectedCityListHighlighted: overlayQa.selectedCityListHighlighted,
    lastFocusedCityId: lastFocus?.cityId ?? null,
    lastFocusRotationDelta: lastFocus?.delta ?? 0,
    koreaFamilyEntryRequested,
    koreaOverlayOpen: koreaFamilyOverlay?.getState().open ?? false,
    koreaTier: koreaFamilyOverlay?.getState().tier ?? null,
    selectedRegion: koreaFamilyOverlay?.getState().selectedRegion ?? null,
    selectedHousehold: koreaFamilyOverlay?.getState().selectedHousehold ?? null,
    highlightedHouseholdId: koreaFamilyOverlay?.getState().highlightedHouseholdId ?? null,
    nameGateState: koreaFamilyOverlay?.getState().nameGateState ?? 'closed',
    unlockedLinkCount: koreaFamilyOverlay?.getState().unlockedLinkCount ?? 0,
    forcedTextureMode: new URLSearchParams(window.location.search).get('earthTexture'),
  };
}

const globe = createGlobeRenderer(canvas, stage);
(window as Window & { __GLOBE_QA_PROJECT_LOCATION__?: (lat: number, lng: number) => { clientX: number; clientY: number; visible: boolean } | null }).__GLOBE_QA_PROJECT_LOCATION__ = (lat: number, lng: number) => globe.projectLocation(lat, lng, canvas);

function ensureExplorationOverlay() {
  if (overlay) return Promise.resolve(overlay);
  if (!explorationOverlayLoad) {
    explorationOverlayLoad = import('./explorationOverlay').then(({ createExplorationOverlay }) => {
      overlay = createExplorationOverlay(globe, {
        card: document.querySelector<HTMLElement>('.city-card')!,
        explorationButton,
        tierButton,
        tierTitle: document.querySelector<HTMLElement>('[data-tier-title]')!,
        tierCopy: document.querySelector<HTMLElement>('[data-tier-copy]')!,
        visibleCount: document.querySelector<HTMLElement>('[data-visible-count]')!,
        regionList: document.querySelector<HTMLElement>('[data-region-list]')!,
        top100BottomList: document.querySelector<HTMLElement>('[data-top100-bottom-list]')!,
      });
      overlay.updateState(globe.getState());
      updateQaState();
      return overlay;
    });
  }
  return explorationOverlayLoad;
}

function ensureKoreaFamilyOverlay() {
  if (koreaFamilyOverlay) return Promise.resolve(koreaFamilyOverlay);
  if (!koreaOverlayLoad) {
    koreaOverlayLoad = import('./koreaFamilyOverlay').then(({ createKoreaFamilyOverlay }) => {
      koreaFamilyOverlay = createKoreaFamilyOverlay({
        host: koreaMapHost,
        onStateChange: updateQaState,
        onClose: () => {
          koreaFamilyEntryRequested = false;
          globe.setKoreaFocus(false);
        },
      });
      updateQaState();
      return koreaFamilyOverlay;
    });
  }
  return koreaOverlayLoad;
}

(window as Window & { __GLOBE_QA_FOCUS_CITY__?: (cityId: string, mode: 'capitals' | 'top100') => Promise<boolean> }).__GLOBE_QA_FOCUS_CITY__ = async (cityId, mode) => {
  const loadedOverlay = await ensureExplorationOverlay();
  loadedOverlay.setCityMode(mode);
  loadedOverlay.setExplorationMode(true);
  return loadedOverlay.focusCityById(cityId);
};
(window as Window & { __GLOBE_QA_SET_CITY_MODE__?: (mode: 'capitals' | 'top100') => Promise<boolean> }).__GLOBE_QA_SET_CITY_MODE__ = async (mode) => {
  const loadedOverlay = await ensureExplorationOverlay();
  loadedOverlay.setCityMode(mode);
  loadedOverlay.setExplorationMode(true);
  updateQaState();
  return true;
};

globe.onViewChange(updateQaState);

async function enterKoreaFamilyMap() {
  koreaFamilyEntryRequested = true;
  overlay?.setExplorationMode(false);
  globe.setMarkerLayerVisible(false);
  globe.setKoreaFocus(true);
  const loadedKoreaOverlay = await ensureKoreaFamilyOverlay();
  loadedKoreaOverlay.open();
  dismissKoreaHint();
  updateQaState();
}

function handleGlobeTap(event: PointerEvent) {
  const hit = globe.pickVisibleObject(event, canvas);
  if (hit?.userData.koreaHotspot) {
    void enterKoreaFamilyMap();
    return true;
  }
  return false;
}

window.addEventListener('korea-family-map-request', () => { void enterKoreaFamilyMap(); });

const koreaHintKey = 'theglobe-korea-hint-seen';
const koreaHintButton = document.querySelector<HTMLButtonElement>('[data-korea-hint]');
function koreaHintSeen() {
  try {
    return localStorage.getItem(koreaHintKey) === '1';
  } catch {
    return true;
  }
}
function dismissKoreaHint() {
  try {
    localStorage.setItem(koreaHintKey, '1');
  } catch {
    // Private mode can block storage; hiding the hint is enough.
  }
  if (koreaHintButton) koreaHintButton.hidden = true;
}
if (koreaHintButton && !koreaHintSeen()) koreaHintButton.hidden = false;
koreaHintButton?.addEventListener('click', dismissKoreaHint);

const friendlyStateLabels: Record<string, string> = {
  boot: 'Preparing Earth',
  'loading-earth': 'Preparing Earth',
  'earth-ready': 'Our Earth',
  'fallback-earth': 'Our Earth',
  'asset-enhancement-ready': 'Our Earth',
};

globe.onStateChange((state, message, credit) => {
  stateLabel.textContent = friendlyStateLabels[state] ?? 'Our Earth';
  stateCopy.textContent = message;
  overlay?.updateState(state);
  updateQaState();
});

let isDragging = false;
let lastX = 0;
let lastY = 0;
let downX = 0;
let downY = 0;
let movedDistance = 0;
let velocityX = 0.0018;
let velocityY = 0;

canvas.addEventListener('pointerdown', (event) => {
  isDragging = true;
  lastX = event.clientX;
  lastY = event.clientY;
  downX = event.clientX;
  downY = event.clientY;
  movedDistance = 0;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (isDragging) {
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    movedDistance = Math.max(movedDistance, Math.hypot(event.clientX - downX, event.clientY - downY));
    if (movedDistance > 6) {
      globe.rotateBy(dx * 0.006, dy * 0.0035);
      velocityX = dx * 0.00018;
      velocityY = dy * 0.00008;
    }
    lastX = event.clientX;
    lastY = event.clientY;
  }
  if (!koreaFamilyOverlay?.getState().open) overlay?.handlePointerMove(event, isDragging);
});

canvas.addEventListener('pointerup', (event) => {
  isDragging = false;
  if (movedDistance <= 6 && !koreaFamilyOverlay?.getState().open) {
    if (handleGlobeTap(event)) return;
  }
  if (!koreaFamilyOverlay?.getState().open) overlay?.handlePointerUp(event, movedDistance);
});

canvas.addEventListener('pointercancel', () => {
  isDragging = false;
  document.body.style.cursor = '';
});

canvas.addEventListener('pointerleave', () => {
  isDragging = false;
  document.body.style.cursor = '';
});

startButton.addEventListener('click', () => stage.scrollIntoView({ behavior: 'smooth', block: 'center' }));
explorationButton.addEventListener('click', () => {
  if (!overlay) {
    void ensureExplorationOverlay().then((loadedOverlay) => {
      loadedOverlay.setExplorationMode(true);
      updateQaState();
    });
    return;
  }
  window.setTimeout(updateQaState, 0);
});
tierButton.addEventListener('click', () => {
  if (!overlay) {
    void ensureExplorationOverlay().then(updateQaState);
    return;
  }
  window.setTimeout(updateQaState, 0);
});
window.addEventListener('city-selection-change', () => window.setTimeout(updateQaState, 0));

function resize() {
  globe.resize();
}
window.addEventListener('resize', resize);
resize();

globe.loadEarth();

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reduceMotion = reducedMotionQuery.matches;
reducedMotionQuery.addEventListener('change', () => {
  reduceMotion = reducedMotionQuery.matches;
});

function publishQaRotation(now: number) {
  const snapshot = qaSnapshot();
  if (!snapshot || now - lastQaRotationAt < QA_ROTATION_INTERVAL_MS) return;
  lastQaRotationAt = now;
  snapshot.globeRotation = globe.getRotation();
}

function animate() {
  requestAnimationFrame(animate);
  if (!isDragging && globe.getViewMode() === 'earth' && !reduceMotion) {
    globe.drift(velocityX, velocityY);
    velocityX = THREE.MathUtils.lerp(velocityX, 0.0016, 0.006);
    velocityY *= 0.96;
  }
  const now = performance.now();
  globe.animateMarkers(now);
  publishQaRotation(now);
  globe.render();
}
animate();
