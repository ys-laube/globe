import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const appPort = Number(process.env.SMOKE_APP_PORT ?? 4175);
const debugPort = Number(process.env.SMOKE_CHROME_DEBUG_PORT ?? 9225);
const chromeBin = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const appUrl = `http://127.0.0.1:${appPort}/?earthTexture=fail`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry while the local preview server starts.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function spawnProcess(command, args) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

function terminate(child) {
  if (!child || child.killed || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once('exit', done);
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null && !child.killed) child.kill('SIGKILL');
      done();
    }, 1200);
  });
}

async function cdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  return {
    send(method, params = {}) {
      const callId = ++id;
      socket.send(JSON.stringify({ id: callId, method, params }));
      return new Promise((resolve, reject) => pending.set(callId, { resolve, reject }));
    },
    close() {
      socket.close();
    },
  };
}

let preview;
let chrome;
let profileDir;

try {
  preview = spawnProcess('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(appPort), '--strictPort', '--base', '/']);
  await waitForHttp(appUrl);

  profileDir = await mkdtemp(join(tmpdir(), 'theglobe-chrome-'));
  chrome = spawnProcess(chromeBin, [
    '--headless=new',
    '--disable-gpu',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ]);
  await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`);

  const newPageResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const page = await newPageResponse.json();
  const client = await cdp(page.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Page.navigate', { url: appUrl });
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression: `new Promise((resolve) => {
      if (document.readyState === 'complete') resolve(true);
      else window.addEventListener('load', () => resolve(true), { once: true });
    })`,
  });
  await delay(1000);

  const explorationSmoke = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: String.raw`
      (async () => {
        const waitFor = async (predicate, label) => {
          const deadline = Date.now() + 12000;
          while (Date.now() < deadline) {
            const value = predicate();
            if (value) return value;
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
          throw new Error('Timed out waiting for ' + label + ': ' + JSON.stringify({
            href: location.href,
            readyState: document.readyState,
            qaState: window.__GLOBE_QA__?.state,
            earthState: document.querySelector('.globe-stage')?.getAttribute('data-earth-state'),
            appText: document.body.textContent?.slice(0, 160),
          }));
        };
        const readyStates = new Set(['earth-ready', 'fallback-earth', 'asset-enhancement-ready']);
        await waitFor(() => readyStates.has(window.__GLOBE_QA__?.state), 'earth ready state');
        const initialRotationX = window.__GLOBE_QA__?.globeRotation?.x;
        const initialRotationY = window.__GLOBE_QA__?.globeRotation?.y;
        await waitFor(
          () => Math.abs((window.__GLOBE_QA__?.globeRotation?.y ?? initialRotationY) - initialRotationY) > 0.006,
          'earth auto rotation'
        );
        const clickButtonByStrong = async (text) => {
          const button = await waitFor(
            () => [...document.querySelectorAll('button')].find((candidate) => candidate.querySelector('strong')?.textContent?.trim() === text || candidate.textContent?.includes(text)),
            'button ' + text
          );
          button.click();
        };

        const bodyText = document.body.textContent ?? '';
        const rejectedCopy = [
          'Earth-first gift mode',
          '첫 화면은 건희, 민하, 찬희를 위한 진짜 지구',
          '6 region',
          'Korea family map',
          '더 많은 수도 보기',
          'The globe is glowing with its final details.',
          'Official static region',
          'official static region',
          '17 first-level regions',
          '17-first-level region',
          '우리 가족이 이어지는 지도',
          '빛나는 길을 따라',
          '가족 이름',
          '예: 한유진',
          '로그인이나 개인정보 저장 없이',
          '초대 링크 열기',
          '이름을 다시 확인해 주세요',
          '이름 확인 후 가족 밴드로 연결됩니다',
        ].filter((text) => bodyText.includes(text));
        const koreaButtonPresent = Boolean(document.querySelector('[data-action="korea-family"]'));

        const exploreButton = await waitFor(() => document.querySelector('[data-action="explore"]:not(:disabled)'), 'exploration button');
        exploreButton.click();
        await waitFor(() => document.querySelector('[data-visible-count]')?.textContent?.trim() === '193', 'all UN member-state capitals visible');
        const capitalsTitle = document.querySelector('[data-tier-title]')?.textContent?.trim();
        const capitalsCopy = document.querySelector('[data-tier-copy]')?.textContent?.trim();
        const capitalFocusOk = await window.__GLOBE_QA_FOCUS_CITY__?.('capital-seoul', 'capitals');
        await waitFor(() => window.__GLOBE_QA__?.selectedCityId === 'capital-seoul', 'capital Seoul rendered card');
        const capitalCardText = document.querySelector('.city-card')?.textContent ?? '';
        const capitalCardTitle = document.querySelector('.city-card h2')?.textContent?.trim();
        const capitalCardDetails = [...document.querySelectorAll('.city-card dd')].map((node) => node.textContent?.trim()).filter(Boolean);
        const approvedFirstScreenCopyPresent = bodyText.includes('where are you? where do you want to go?');
        const top100Toggle = await waitFor(() => document.querySelector('[data-action="toggle-tier"]:not(:disabled)'), 'TOP100 tier toggle enabled');
        const toggleLabelBefore = top100Toggle?.textContent?.trim();
        top100Toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        if (document.querySelector('[data-tier-title]')?.textContent?.trim() !== 'TOP 100 인기 도시') {
          await window.__GLOBE_QA_FOCUS_CITY__?.('top100-hong-kong', 'top100');
        }
        await waitFor(() => document.querySelector('[data-tier-title]')?.textContent?.trim() === 'TOP 100 인기 도시' && document.querySelector('[data-visible-count]')?.textContent?.trim() === '10', 'TOP100 visible');
        const top100Title = document.querySelector('[data-tier-title]')?.textContent?.trim();
        const toggleLabelAfter = top100Toggle?.textContent?.trim();
        const top100Count = document.querySelector('[data-visible-count]')?.textContent?.trim();
        const top100BottomList = document.querySelector('[data-top100-bottom-list]');
        const top100PanelList = document.querySelector('[data-region-list]');
        const top100BottomListVisible = Boolean(top100BottomList && !top100BottomList.hidden && getComputedStyle(top100BottomList).display !== 'none');
        const top100PanelListHidden = Boolean(top100PanelList && getComputedStyle(top100PanelList).display === 'none');
        const top100GroupCount = top100BottomList?.querySelectorAll('[data-rank-group]').length ?? 0;
        const top100ListEntryCount = top100BottomList?.querySelectorAll('[data-rank-group] li[data-city-id]').length ?? 0;
        const top100RankGroups = [...(top100BottomList?.querySelectorAll('[data-rank-group]') ?? [])].map((group) => group.getAttribute('data-rank-group'));
        const top100PageControlCount = top100BottomList?.querySelectorAll('[data-action="top100-page"]').length ?? 0;
        const top100PageLabels = [...(top100BottomList?.querySelectorAll('[data-action="top100-page"]') ?? [])].map((button) => button.textContent?.trim()).filter(Boolean);
        const rotationBeforeCityFocus = window.__GLOBE_QA__?.globeRotation ?? { x: initialRotationX, y: initialRotationY, z: 0 };
        const top100HongKongButton = top100BottomList?.querySelector('[data-action="focus-city"][data-city-id="top100-hong-kong"]') ?? document.querySelector('[data-action="focus-city"][data-city-id="top100-hong-kong"]');
        top100HongKongButton?.click();
        await waitFor(() => window.__GLOBE_QA__?.selectedCityId === 'top100-hong-kong', 'TOP100 Hong Kong selected from list');
        await waitFor(() => window.__GLOBE_QA__?.selectedCityMarkerGlowVisible, 'TOP100 Hong Kong selected marker glow');
        await waitFor(() => window.__GLOBE_QA__?.selectedCityListHighlighted, 'TOP100 Hong Kong selected list highlight');
        await waitFor(() => window.__GLOBE_QA__?.lastFocusRotationDelta > 0.006, 'TOP100 list city focus target delta');
        await waitFor(() => Math.abs((window.__GLOBE_QA__?.globeRotation?.y ?? rotationBeforeCityFocus.y) - rotationBeforeCityFocus.y) > 0.08, 'TOP100 list city focus rotation');
        const focusedCityCardTitle = document.querySelector('.city-card h2')?.textContent?.trim();
        const focusedCityCardKicker = document.querySelector('.city-card .card-kicker')?.textContent?.trim();
        const focusedCityCardOpen = Boolean(document.querySelector('.city-card[data-empty="false"]:not([hidden])'));
        const focusedCityCardLink = document.querySelector('.city-card a[href^="https://"]')?.href;
        const listFocusRotationDeltaY = Math.abs((window.__GLOBE_QA__?.globeRotation?.y ?? rotationBeforeCityFocus.y) - rotationBeforeCityFocus.y);
        const selectedCityFromQa = window.__GLOBE_QA__?.selectedCity;
        const listSelectedGlowVisible = window.__GLOBE_QA__?.selectedCityMarkerGlowVisible;
        const listSelectedHighlighted = window.__GLOBE_QA__?.selectedCityListHighlighted;

        const canvas = document.querySelector('#globe');
        const clickProjectedCity = async (cityId, lat, lng, label) => {
          await window.__GLOBE_QA_FOCUS_CITY__?.(cityId, 'top100');
          const bottomList = document.querySelector('[data-top100-bottom-list]');
          const button = bottomList?.querySelector('[data-action=\"focus-city\"][data-city-id=\"' + cityId + '\"]') ?? document.querySelector('[data-action=\"focus-city\"][data-city-id=\"' + cityId + '\"]');
          button?.click();
          await waitFor(() => window.__GLOBE_QA__?.selectedCityId === cityId, label + ' selected from list');
          let point = null;
          await waitFor(() => {
            point = window.__GLOBE_QA_PROJECT_LOCATION__?.(lat, lng) ?? null;
            return point?.visible === true && Number.isFinite(point.clientX) && Number.isFinite(point.clientY);
          }, label + ' projected on visible globe');
          canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: point.clientX, clientY: point.clientY, pointerId: 77, pointerType: 'mouse' }));
          await waitFor(() => window.__GLOBE_QA__?.selectedCityId === cityId && window.__GLOBE_QA__?.viewMode === 'earth', label + ' marker click priority');
          await waitFor(() => window.__GLOBE_QA__?.selectedCityMarkerGlowVisible, label + ' selected marker glow');
          await waitFor(() => window.__GLOBE_QA__?.selectedCityListHighlighted, label + ' selected TOP100 list highlight');
          return document.querySelector('.city-card h2')?.textContent?.trim();
        };
        const seoulMarkerCardTitle = await clickProjectedCity('top100-seoul', 37.5665, 126.978, 'Seoul');
        const seoulMarkerGlowVisible = window.__GLOBE_QA__?.selectedCityMarkerGlowVisible;
        const seoulListHighlighted = window.__GLOBE_QA__?.selectedCityListHighlighted;
        const jejuMarkerCardTitle = await clickProjectedCity('top100-jeju', 33.4996, 126.5312, 'Jeju');
        const jejuMarkerGlowVisible = window.__GLOBE_QA__?.selectedCityMarkerGlowVisible;
        const jejuListHighlighted = window.__GLOBE_QA__?.selectedCityListHighlighted;

        return {
          qa: window.__GLOBE_QA__,
          rejectedCopy,
          approvedFirstScreenCopyPresent,
          koreaButtonPresent,
          capitalsTitle,
          capitalsCopy,
          capitalFocusOk,
          capitalCardTitle,
          capitalCardDetails,
          capitalCardText,
          toggleLabelBefore,
          top100Title,
          toggleLabelAfter,
          count: top100Count,
          top100BottomListVisible,
          top100PanelListHidden,
          top100GroupCount,
          top100ListEntryCount,
          top100RankGroups,
          top100PageControlCount,
          top100PageLabels,
          focusedCityCardTitle,
          focusedCityCardKicker,
          focusedCityCardOpen,
          focusedCityCardLink,
          listFocusRotationDeltaY,
          selectedCityFromQa,
          listSelectedGlowVisible,
          listSelectedHighlighted,
          seoulMarkerCardTitle,
          seoulMarkerGlowVisible,
          seoulListHighlighted,
          jejuMarkerCardTitle,
          jejuMarkerGlowVisible,
          jejuListHighlighted,
          panelHasStatsLanguage: /regions|visible capitals|Premium highlights/.test(bodyText),
          cityCardPresent: Boolean(document.querySelector('.city-card')),
          rotationDeltaY: Math.abs((window.__GLOBE_QA__?.globeRotation?.y ?? initialRotationY) - initialRotationY),
          weatherCopyPresent: /weather|날씨|Open-Meteo|simulated weather/i.test(bodyText),
          weatherCardPresent: Boolean(document.querySelector('[data-weather-card], .weather-card, .weather-layer')),
        };
      })()
    `,
  });

  if (explorationSmoke.exceptionDetails) {
    throw new Error(`Browser exploration smoke failed: ${explorationSmoke.exceptionDetails.text ?? JSON.stringify(explorationSmoke.exceptionDetails)}`);
  }
  const explorationResult = explorationSmoke.result.value;
  if (!explorationResult) throw new Error(`Browser exploration smoke returned no serializable result: ${JSON.stringify(explorationSmoke)}`);

  await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await delay(250);

  const koreaSmoke = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: String.raw`
      (async () => {
        const waitFor = async (predicate, label) => {
          const deadline = Date.now() + 12000;
          while (Date.now() < deadline) {
            const value = predicate();
            if (value) return value;
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
          throw new Error('Timed out waiting for ' + label);
        };
        const clickButtonByStrong = async (text) => {
          const button = await waitFor(
            () => [...document.querySelectorAll('button')].find((candidate) => candidate.querySelector('strong')?.textContent?.trim() === text || candidate.textContent?.includes(text)),
            'button ' + text
          );
          button.click();
        };
        const closestRegion = (node) => {
          let current = node;
          while (current && current !== document) {
            if (current.classList?.contains('korea-region')) return current;
            current = current.parentElement ?? current.parentNode;
          }
          return null;
        };
        const findViewportHitForRegion = (regionId) => {
          const region = document.querySelector('.korea-region[data-region-id="' + regionId + '"]');
          if (!region) throw new Error('Missing SVG polygon for ' + regionId);
          const rect = region.getBoundingClientRect();
          const samples = [];
          for (let yi = 1; yi <= 11; yi += 1) {
            for (let xi = 1; xi <= 11; xi += 1) {
              samples.push([xi / 12, yi / 12]);
            }
          }
          samples.unshift([0.5, 0.5], [0.35, 0.35], [0.65, 0.65], [0.35, 0.65], [0.65, 0.35]);
          const misses = [];
          for (const [fx, fy] of samples) {
            const clientX = rect.left + rect.width * fx;
            const clientY = rect.top + rect.height * fy;
            const hit = document.elementFromPoint(clientX, clientY);
            const stackRegion = [...document.elementsFromPoint(clientX, clientY)]
              .map((node) => closestRegion(node))
              .find((candidate) => candidate?.getAttribute('data-region-id') === regionId);
            const hitRegion = closestRegion(hit);
            if (hitRegion?.getAttribute('data-region-id') === regionId) {
              return { clientX, clientY, hitTag: hit.tagName.toLowerCase(), hitRegionId: hitRegion.getAttribute('data-region-id'), elementFromPointVerified: true };
            }
            if (stackRegion) {
              misses.push({ clientX, clientY, top: hit?.tagName?.toLowerCase(), topClass: hit?.getAttribute?.('class') ?? '', coveredRegionId: regionId });
            } else if (misses.length < 6) {
              misses.push({ clientX, clientY, top: hit?.tagName?.toLowerCase(), topClass: hit?.getAttribute?.('class') ?? '', topRegion: hitRegion?.getAttribute('data-region-id') ?? null });
            }
          }
          throw new Error('No document.elementFromPoint hit inside SVG polygon for ' + regionId + ': ' + JSON.stringify(misses.slice(0, 8)));
        };
        window.dispatchEvent(new CustomEvent('korea-family-map-request'));
        await waitFor(() => window.__GLOBE_QA__?.viewMode === 'korea-focus', 'Korea focus view mode');
        await waitFor(() => window.__GLOBE_QA__?.koreaOverlayOpen === true && document.querySelector('.korea-map-overlay .korea-map-canvas'), 'same-stage Korea map');
        document.querySelector('.korea-map-canvas')?.scrollIntoView({ block: 'center', inline: 'center' });
        await new Promise((resolve) => setTimeout(resolve, 120));
        const readRect = (selector) => {
          const node = document.querySelector(selector);
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          return {
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          };
        };
        const mobileLayout = (() => {
          const stage = readRect('.globe-stage');
          const overlay = readRect('.korea-map-overlay');
          const canvasRect = readRect('.korea-map-canvas');
          const panel = readRect('.korea-route-panel');
          const header = readRect('.korea-map-header');
          return {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            documentScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            stage,
            overlay,
            header,
            canvas: canvasRect,
            panel,
            overlayDisplay: document.querySelector('.korea-map-overlay') ? getComputedStyle(document.querySelector('.korea-map-overlay')).display : null,
            overlayOverflowY: document.querySelector('.korea-map-overlay') ? getComputedStyle(document.querySelector('.korea-map-overlay')).overflowY : null,
            overlayScrollHeight: document.querySelector('.korea-map-overlay')?.scrollHeight ?? null,
            overlayClientHeight: document.querySelector('.korea-map-overlay')?.clientHeight ?? null,
            overlayGridColumns: document.querySelector('.korea-map-overlay') ? getComputedStyle(document.querySelector('.korea-map-overlay')).gridTemplateColumns : null,
            canvasAspectRatio: canvasRect ? canvasRect.width / canvasRect.height : null,
            canvasPanelGap: canvasRect && panel ? panel.top - canvasRect.bottom : null,
            panelOverlayBottomGap: overlay && panel ? overlay.bottom - panel.bottom : null,
            routePanelBottomGap: overlay && panel ? overlay.bottom - panel.bottom : null,
          };
        })();
        const vectorMapTelemetry = {
          style: document.querySelector('.korea-map-canvas')?.getAttribute('data-map-style'),
          hostStyle: document.querySelector('.korea-map-overlay')?.getAttribute('data-map-style'),
          rasterLayerPresent: Boolean(document.querySelector('.korea-raster-layer')),
          rasterImagePresent: Boolean(document.querySelector('.korea-raster-image')),
          imageryStatePresent: document.querySelector('.korea-map-canvas')?.hasAttribute('data-imagery-state') ?? false,
          fitStrategy: document.querySelector('.korea-map-canvas')?.getAttribute('data-fit-strategy'),
          fitScale: Number.parseFloat(document.querySelector('.korea-map-canvas')?.getAttribute('data-fit-scale') || '0'),
          fitBounds: (document.querySelector('.korea-map-canvas')?.getAttribute('data-fit-bounds') || '').split(',').map(Number),
        };
        const officialFirstLevelLabels = ['서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시','세종특별자치시','경기도','강원특별자치도','충청북도','충청남도','전북특별자치도','전라남도','경상북도','경상남도','제주특별자치도'];
        const officialFirstLevelRegions = [
          ['kr-seoul', '서울특별시'],
          ['kr-busan', '부산광역시'],
          ['kr-daegu', '대구광역시'],
          ['kr-incheon', '인천광역시'],
          ['kr-gwangju', '광주광역시'],
          ['kr-daejeon', '대전광역시'],
          ['kr-ulsan', '울산광역시'],
          ['kr-sejong', '세종특별자치시'],
          ['kr-gyeonggi', '경기도'],
          ['kr-gangwon', '강원특별자치도'],
          ['kr-chungbuk', '충청북도'],
          ['kr-chungnam', '충청남도'],
          ['kr-jeonbuk', '전북특별자치도'],
          ['kr-jeonnam', '전라남도'],
          ['kr-gyeongbuk', '경상북도'],
          ['kr-gyeongnam', '경상남도'],
          ['kr-jeju', '제주특별자치도'],
        ];
        await waitFor(() => officialFirstLevelLabels.every((label) => [...document.querySelectorAll('.route-choice strong, .korea-region')].some((node) => (node.textContent ?? node.getAttribute('aria-label') ?? '').includes(label))), 'all 17 first-level Korea labels rendered');
        const renderedFirstLevelCount = officialFirstLevelLabels.filter((label) => [...document.querySelectorAll('.route-choice strong, .korea-region')].some((node) => (node.textContent ?? node.getAttribute('aria-label') ?? '').includes(label))).length;
        const familyTraceState = () => ({
          overlay: document.querySelector('.korea-map-overlay')?.getAttribute('data-family-traces'),
          canvas: document.querySelector('.korea-map-canvas')?.getAttribute('data-family-traces'),
          routeLayerPresent: Boolean(document.querySelector('.korea-family-route-layer')),
          activeRouteCount: document.querySelectorAll('.korea-family-route.is-active').length,
        });
        const overviewTraceState = familyTraceState();
        const openRoot = async () => {
          await clickButtonByStrong('대한민국');
          await waitFor(() => window.__GLOBE_QA__?.selectedRegion === 'kr-korea-overview', 'Korea overview tier');
        };
        const clickFirstLevelRegionByViewportHit = async ([regionId, label]) => {
          await waitFor(() => window.__GLOBE_QA__?.selectedRegion === 'kr-korea-overview', 'overview before coordinate click ' + regionId);
          const hitPoint = findViewportHitForRegion(regionId);
          const hitElement = document.elementFromPoint(hitPoint.clientX, hitPoint.clientY);
          if (closestRegion(hitElement)?.getAttribute('data-region-id') !== regionId) throw new Error('Coordinate hit drifted before click for ' + regionId);
          hitElement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: hitPoint.clientX, clientY: hitPoint.clientY, pointerId: 301, pointerType: 'mouse' }));
          hitElement.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: hitPoint.clientX, clientY: hitPoint.clientY, pointerId: 301, pointerType: 'mouse' }));
          hitElement.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: hitPoint.clientX, clientY: hitPoint.clientY }));
          await waitFor(() => window.__GLOBE_QA__?.selectedRegion === regionId, 'coordinate click selected ' + label);
          const firstLevelTraceState = familyTraceState();
          await openRoot();
          return { regionId, label, ...hitPoint, selected: true, firstLevelTraceState };
        };
        const firstLevelCoordinateHits = [];
        const coordinateHitTestSkippedForMobile = window.innerWidth <= 430;
        if (!coordinateHitTestSkippedForMobile) {
          for (const regionEntry of officialFirstLevelRegions) {
            firstLevelCoordinateHits.push(await clickFirstLevelRegionByViewportHit(regionEntry));
          }
        }
        await waitFor(() => document.querySelector('.route-choice[data-region-id="kr-busan"]') && document.querySelector('.korea-region[data-region-id="kr-busan"]'), 'Busan route choice and map region rendered');
        const busanChoice = document.querySelector('.route-choice[data-region-id="kr-busan"]');
        const busanRegion = document.querySelector('.korea-region[data-region-id="kr-busan"]');
        busanChoice?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
        await waitFor(() => busanRegion?.classList.contains('is-highlighted'), 'Busan list hover highlights map');
        const listHoverHighlightsMap = busanRegion?.classList.contains('is-highlighted');
        busanChoice?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
        busanRegion?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
        await waitFor(() => busanChoice?.classList.contains('is-highlighted'), 'Busan map hover highlights list');
        const mapHoverHighlightsList = busanChoice?.classList.contains('is-highlighted');
        busanRegion?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
        const koreaRegionCount = document.querySelectorAll('.korea-region').length;
        const koreaRegionIds = [...document.querySelectorAll('.korea-region')].map((node) => node.getAttribute('data-region-id')).filter(Boolean);
        const overviewFamilyTargetRegionIds = koreaRegionIds.filter((id) => ['kr-seoul-mapo', 'kr-busan-haeundae', 'kr-gyeongnam-gimhae', 'kr-gimhae-bonghwang'].includes(id));
        const koreaRegionLabels = [...document.querySelectorAll('.korea-region')].map((node) => node.getAttribute('aria-label') || node.textContent?.trim() || '').filter(Boolean);
        const renderedRegionRects = [...document.querySelectorAll('.korea-region')].map((node) => node.getBoundingClientRect());
        const currentCanvasRect = document.querySelector('.korea-map-canvas')?.getBoundingClientRect();
        const renderedFootprint = currentCanvasRect && renderedRegionRects.length ? {
          left: Math.min(...renderedRegionRects.map((rect) => rect.left)) - currentCanvasRect.left,
          right: Math.max(...renderedRegionRects.map((rect) => rect.right)) - currentCanvasRect.left,
          top: Math.min(...renderedRegionRects.map((rect) => rect.top)) - currentCanvasRect.top,
          bottom: Math.max(...renderedRegionRects.map((rect) => rect.bottom)) - currentCanvasRect.top,
          canvasWidth: currentCanvasRect.width,
          canvasHeight: currentCanvasRect.height,
        } : null;
        await clickButtonByStrong('대구광역시');
        await waitFor(() => window.__GLOBE_QA__?.selectedRegion === 'kr-daegu', 'Daegu non-family region tier');
        const daeguInfoText = document.querySelector('.korea-route-panel')?.textContent ?? '';
        const daeguInfoHref = document.querySelector('.region-info-link')?.href ?? '';
        const daeguSelectedRegion = document.querySelector('.korea-region[data-region-id="kr-daegu"]');
        daeguSelectedRegion?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await waitFor(() => window.__GLOBE_QA__?.selectedRegion === 'kr-korea-overview', 'Daegu selected-region toggle-up');
        const selectedRegionToggleUpOk = window.__GLOBE_QA__?.selectedRegion === 'kr-korea-overview';
        const overviewHouseholdMarkerCount = document.querySelectorAll('.household-marker').length;
        const overviewHouseholdMarkerLabels = [...document.querySelectorAll('.household-marker-label')].map((node) => node.textContent?.trim()).filter(Boolean);
        const northSilhouette = document.querySelector('[data-decorative-north-silhouette="true"], .korea-north-silhouette');
        const decorativeNorthSilhouette = {
          present: Boolean(northSilhouette),
        };
        const islandReferenceCount = document.querySelectorAll('.korea-island-reference').length;
        const islandReferenceLabels = [...document.querySelectorAll('.korea-island-label')].map((node) => node.textContent?.trim()).filter(Boolean);
        const islandLabelDefaultVisibility = [...document.querySelectorAll('.korea-island-label')].map((node) => ({
          label: node.textContent?.trim(),
          opacity: Number.parseFloat(getComputedStyle(node).opacity || '1'),
        }));
        const islandHitTargets = [...document.querySelectorAll('[data-island-hit-target="true"]')].map((node) => ({ islandId: node.getAttribute('data-island-id'), regionId: node.getAttribute('data-region-id'), label: node.getAttribute('aria-label') }));
        const dokdoHit = document.querySelector('[data-island-hit-target="true"][data-island-id*="dokdo"], [data-island-hit-target="true"][aria-label*="독도"]');
        dokdoHit?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
        const dokdoHighlightsGyeongbuk = document.querySelector('.korea-region[data-region-id="kr-gyeongbuk"]')?.classList.contains('is-highlighted') ?? false;
        dokdoHit?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
        const vectorTextureLayerPresent = Boolean(
          document.querySelector('.korea-static-texture')
          || document.querySelector('#korea-static-grain')
          || document.querySelector('.korea-terrain-contours')
          || document.querySelector('#korea-terrain-contours')
        );
        const vectorPremiumStyle = {
          palette: document.querySelector('.korea-map-overlay')?.getAttribute('data-map-palette'),
          canvasPalette: document.querySelector('.korea-map-canvas')?.getAttribute('data-map-palette'),
          mapContract: document.querySelector('.korea-map-canvas')?.getAttribute('data-map-contract'),
          hostMapContract: document.querySelector('.korea-map-overlay')?.getAttribute('data-map-contract'),
          islandCoverage: document.querySelector('.korea-map-overlay')?.getAttribute('data-island-coverage'),
          terrainGradientPresent: Boolean(document.querySelector('#korea-land-terrain') && document.querySelector('#korea-selected-terrain')),
          terrainContoursPresent: Boolean(document.querySelector('.korea-terrain-contours') && document.querySelector('#korea-terrain-contours')),
        };
        const removedSatelliteCopyAbsent = !/static satellite-style Korea family map|공식 공공데이터 경계 데이터셋|위성풍/.test(document.body.textContent ?? '');
        const routeNodesFallback = { '해운대구': 'kr-busan-haeundae', '마포구': 'kr-seoul-mapo', '김해시': 'kr-gimhae' };
        const labelOpacity = (selector) => {
          const node = document.querySelector(selector);
          return node ? Number.parseFloat(getComputedStyle(node).opacity || '1') : null;
        };
        const checkFamilyRegionInfo = async ({ label, region, nextLabel, landmark, food }) => {
          await openRoot();
          await clickButtonByStrong(label);
          await waitFor(() => window.__GLOBE_QA__?.selectedRegion === region, region + ' first-level info tier');
          const panelText = document.querySelector('.korea-route-panel')?.textContent ?? '';
          const href = document.querySelector('.region-info-link')?.href ?? '';
          const routeChoices = [...document.querySelectorAll('.route-choice')];
          const routeChoiceLabels = routeChoices.map((node) => node.querySelector('strong')?.textContent?.trim()).filter(Boolean);
          const householdCardLabels = [...document.querySelectorAll('.household-card strong')].map((node) => node.textContent?.trim()).filter(Boolean);
          const selectedParentLabelSelector = '.korea-map-label.is-selected-label.is-parent-label[data-region-id="' + region + '"]';
          const selectedParentLabel = document.querySelector(selectedParentLabelSelector);
          const parentLabelPinned = Boolean(selectedParentLabel) && labelOpacity(selectedParentLabelSelector) > 0.35;
          const nextChoice = routeChoices.find((node) => (node.querySelector('strong')?.textContent?.trim() ?? '').includes(nextLabel));
          const nextRegionId = nextChoice?.getAttribute('data-region-id') ?? routeNodesFallback[nextLabel] ?? null;
          let parentSuppressedForChildHover = false;
          let childLabelHighlighted = false;
          if (nextChoice && nextRegionId) {
            nextChoice.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerId: 711, pointerType: 'mouse' }));
            nextChoice.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, pointerId: 711, pointerType: 'mouse' }));
            nextChoice.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            nextChoice.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
            await waitFor(() => (document.querySelector('.korea-map-label[data-region-id="' + nextRegionId + '"]')?.classList.contains('is-highlighted') ?? false), nextLabel + ' child label highlight');
            await waitFor(() => (labelOpacity(selectedParentLabelSelector) ?? 1) < 0.12 && (labelOpacity('.korea-map-label[data-region-id="' + nextRegionId + '"]') ?? 0) > 0.35, nextLabel + ' child label opacity transition');
            parentSuppressedForChildHover = (labelOpacity(selectedParentLabelSelector) ?? 1) < 0.12;
            childLabelHighlighted = (labelOpacity('.korea-map-label[data-region-id="' + nextRegionId + '"]') ?? 0) > 0.35;
            nextChoice.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerId: 711, pointerType: 'mouse' }));
            nextChoice.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, pointerId: 711, pointerType: 'mouse' }));
          }
          return {
            label,
            region,
            selectedRegion: window.__GLOBE_QA__?.selectedRegion,
            panelText,
            href,
            routeChoiceLabels,
            householdCardLabels,
            parentLabelPinned,
            parentSuppressedForChildHover,
            childLabelHighlighted,
            nextRegionId,
            routeChoiceCount: routeChoices.length,
            hasLandmark: panelText.includes('Landmark') && panelText.includes(landmark),
            hasFood: panelText.includes('Food') && panelText.includes(food),
            hasNextStep: panelText.includes('가족이 있는 지역으로 한 단계 더 들어가기') && routeChoiceLabels.includes(nextLabel),
            householdCardCount: householdCardLabels.length,
          };
        };
        const unlockFamilyPath = async ({ labels, terminalRegion, householdLabel, householdId, acceptedName }) => {
          for (const label of labels) await clickButtonByStrong(label);
          await waitFor(() => window.__GLOBE_QA__?.selectedRegion === terminalRegion, terminalRegion + ' tier');
          const routeChoiceLabels = [...document.querySelectorAll('.route-choice strong, .household-card strong')].map((node) => node.textContent?.trim()).filter(Boolean);
          const terminalHouseholdMarkerCount = document.querySelectorAll('.household-marker').length;
          const terminalHouseholdMarkerLabels = [...document.querySelectorAll('.household-marker-label')].map((node) => node.textContent?.trim()).filter(Boolean);
          const householdCard = document.querySelector('.household-card[data-household-id="' + householdId + '"]');
          const householdMarker = document.querySelector('.household-marker[data-household-id="' + householdId + '"]');
          if (!householdCard || !householdMarker) throw new Error('Missing household card/marker data-household-id pair for ' + householdId);
          const householdMarkerDot = householdMarker.querySelector('.household-marker-dot');
          const householdMarkerLabel = householdMarker.querySelector('.household-marker-label');
          const markerLabelOpacityBeforeHover = Number.parseFloat(getComputedStyle(householdMarkerLabel).opacity || '1');
          const markerDotOpacityBeforeHover = Number.parseFloat(getComputedStyle(householdMarkerDot).opacity || '1');
          householdCard.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
          await waitFor(() => householdMarker.classList.contains('is-highlighted') && window.__GLOBE_QA__?.highlightedHouseholdId === householdId, householdLabel + ' card highlights map marker');
          const cardHoverHighlightsMarker = householdMarker.classList.contains('is-highlighted');
          householdCard.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
          await waitFor(() => !householdMarker.classList.contains('is-highlighted'), householdLabel + ' card hover clears marker');
          householdMarker.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
          await waitFor(() => householdCard.classList.contains('is-highlighted') && window.__GLOBE_QA__?.highlightedHouseholdId === householdId, householdLabel + ' map marker highlights card');
          const markerHoverHighlightsCard = householdCard.classList.contains('is-highlighted');
          await new Promise((resolve) => setTimeout(resolve, 420));
          const markerLabelOpacityOnHover = Number.parseFloat(getComputedStyle(householdMarkerLabel).opacity || '0');
          const markerDotOpacityOnHover = Number.parseFloat(getComputedStyle(householdMarkerDot).opacity || '0');
          householdMarker.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
          await clickButtonByStrong(householdLabel);
          await waitFor(() => window.__GLOBE_QA__?.selectedHousehold === householdId, householdLabel + ' household');
          const selectedMarkerHighlighted = document.querySelector('.household-marker[data-household-id="' + householdId + '"]')?.classList.contains('is-selected-household') ?? false;
          const input = document.querySelector('.name-gate input');
          const gateBeforeUnlockCopy = document.querySelector('.name-gate')?.textContent ?? '';
          const linksBeforeUnlock = document.querySelectorAll('.band-link').length;
          input.value = '틀린 암구호';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('.name-gate').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          await waitFor(() => window.__GLOBE_QA__?.nameGateState === 'invalid', householdLabel + ' invalid passphrase');
          const invalidFeedback = document.querySelector('.name-gate-feedback')?.textContent?.trim();
          const acceptedInput = document.querySelector('.name-gate input');
          acceptedInput.value = acceptedName;
          acceptedInput.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('.name-gate').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          await waitFor(() => window.__GLOBE_QA__?.nameGateState === 'unlocked', householdLabel + ' name gate unlock');
          const links = [...document.querySelectorAll('.band-link')].map((link) => link.href);
          return {
            gateBeforeUnlockCopy,
            linksBeforeUnlock,
            invalidFeedback,
            householdId,
            householdLabel,
            terminalRegion: window.__GLOBE_QA__?.selectedRegion,
            selectedHousehold: window.__GLOBE_QA__?.selectedHousehold,
            nameGateState: window.__GLOBE_QA__?.nameGateState,
            highlightedHouseholdId: window.__GLOBE_QA__?.highlightedHouseholdId,
            cardHoverHighlightsMarker,
            markerHoverHighlightsCard,
            selectedMarkerHighlighted,
            markerLabelOpacityBeforeHover,
            markerLabelOpacityOnHover,
            markerDotOpacityBeforeHover,
            markerDotOpacityOnHover,
            routeChoiceLabels,
            terminalHouseholdMarkerCount,
            terminalHouseholdMarkerLabels,
            familyTraceState: familyTraceState(),
            linkCount: links.length,
            links,
          };
        };
        const busanFirstLevelInfo = await checkFamilyRegionInfo({ label: '부산광역시', region: 'kr-busan', nextLabel: '해운대구', landmark: '해운대해수욕장', food: '돼지국밥' });
        const seoulFirstLevelInfo = await checkFamilyRegionInfo({ label: '서울특별시', region: 'kr-seoul', nextLabel: '마포구', landmark: '남산서울타워', food: '떡볶이' });
        const gyeongnamFirstLevelInfo = await checkFamilyRegionInfo({ label: '경상남도', region: 'kr-gyeongnam', nextLabel: '김해시', landmark: '진해 경화역', food: '진주냉면' });
        await openRoot();
        const seoulFamilyPath = await unlockFamilyPath({ labels: ['서울특별시', '마포구'], terminalRegion: 'kr-seoul-mapo', householdLabel: '진주네', householdId: 'brother', acceptedName: '한진주' });
        await openRoot();
        const gyeongnamFamilyPath = await unlockFamilyPath({ labels: ['경상남도', '김해시', '봉황동'], terminalRegion: 'kr-gimhae-bonghwang', householdLabel: '은하네', householdId: 'home', acceptedName: '한은하' });
        await openRoot();
        const busanParentsPath = await unlockFamilyPath({ labels: ['부산광역시', '해운대구'], terminalRegion: 'kr-busan-haeundae', householdLabel: '한가네 본가', householdId: 'parents', acceptedName: '한봉수' });
        await openRoot();
        const busanSisterPath = await unlockFamilyPath({ labels: ['부산광역시', '해운대구'], terminalRegion: 'kr-busan-haeundae', householdLabel: '건희민하찬희네', householdId: 'sister', acceptedName: '박건희' });
        const routeChoiceLabels = busanSisterPath.routeChoiceLabels;
        const links = busanSisterPath.links;
        await clickButtonByStrong('다른 가족 카드 보기');
        await waitFor(() => window.__GLOBE_QA__?.selectedRegion === 'kr-korea-overview' && window.__GLOBE_QA__?.selectedHousehold === null, 'family detail back returns to Korea overview');
        const familyBackReturnsToOverview = {
          selectedRegion: window.__GLOBE_QA__?.selectedRegion,
          selectedHousehold: window.__GLOBE_QA__?.selectedHousehold,
          nameGateState: window.__GLOBE_QA__?.nameGateState,
          panelKicker: document.querySelector('.korea-route-panel .map-kicker')?.textContent?.trim(),
          panelTitle: document.querySelector('.korea-route-panel h3')?.textContent?.trim(),
          regionCount: document.querySelectorAll('.korea-region').length,
        };

        return {
          stageKoreaMode: document.querySelector('.globe-stage')?.getAttribute('data-korea-mode'),
          koreaOverlayOpen: window.__GLOBE_QA__?.koreaOverlayOpen,
          viewMode: window.__GLOBE_QA__?.viewMode,
          selectedRegion: window.__GLOBE_QA__?.selectedRegion,
          mobileLayout,
          vectorMapTelemetry,
          mapCanvasPresent: Boolean(document.querySelector('.korea-map-canvas svg')),
          koreaRegionCount,
          koreaRegionIds,
          overviewFamilyTargetRegionIds,
          koreaRegionLabels,
          renderedFootprint,
          daeguInfoText,
          daeguInfoHref,
          selectedRegionToggleUpOk,
          contextLineCount: document.querySelectorAll('.korea-context-line').length,
          renderedFirstLevelCount,
          overviewTraceState,
          firstLevelCoordinateHits,
          coordinateHitTestSkippedForMobile,
          listHoverHighlightsMap,
          mapHoverHighlightsList,
          overviewHouseholdMarkerCount,
          overviewHouseholdMarkerLabels,
          decorativeNorthSilhouette,
          islandReferenceCount,
          islandReferenceLabels,
          islandLabelDefaultVisibility,
          islandHitTargets,
          dokdoHighlightsGyeongbuk,
          vectorTextureLayerPresent,
          vectorPremiumStyle,
          removedSatelliteCopyAbsent,
          routeChoiceLabels,
          busanFirstLevelInfo,
          seoulFirstLevelInfo,
          gyeongnamFirstLevelInfo,
          seoulFamilyPath,
          gyeongnamFamilyPath,
          busanParentsPath,
          busanSisterPath,
          familyBackReturnsToOverview,
          selectedHousehold: window.__GLOBE_QA__?.selectedHousehold,
          nameGateState: window.__GLOBE_QA__?.nameGateState,
          linkCount: links.length,
          links,
        };
      })()
    `,
  });
  await client.close();

  if (koreaSmoke.exceptionDetails) {
    throw new Error(`Browser Korea smoke failed: ${koreaSmoke.exceptionDetails.text ?? JSON.stringify(koreaSmoke.exceptionDetails)}`);
  }
  const koreaResult = koreaSmoke.result.value;
  if (!koreaResult) throw new Error(`Browser Korea smoke returned no serializable result: ${JSON.stringify(koreaSmoke)}`);
  const result = { ...explorationResult, ...koreaResult };
  if (result.rejectedCopy.length) throw new Error(`Rejected copy still present: ${result.rejectedCopy.join(', ')}`);
  if (result.koreaButtonPresent) throw new Error('Expected primary Korea family button to be removed');
  if (!result.approvedFirstScreenCopyPresent) throw new Error('Expected approved first-screen copy to be rendered');
  if (result.capitalsTitle !== '세계의 수도') throw new Error(`Expected capitals title, found ${result.capitalsTitle}`);
  if (result.capitalsCopy !== '전 세계 UN가입국의 수도를 보여줍니다') throw new Error(`Expected UN member-state capitals copy, found ${result.capitalsCopy}`);
  if (!result.capitalFocusOk || result.capitalCardTitle !== 'Seoul') throw new Error(`Expected rendered capital Seoul card, found ${result.capitalCardTitle}`);
  if (!result.capitalCardDetails?.includes('Gyeongbokgung Palace') || !result.capitalCardDetails?.includes('kimchi jjigae')) throw new Error(`Expected rendered capital card Landmark/Food, found ${result.capitalCardDetails?.join(', ')}`);
  if (result.capitalCardDetails?.some((value) => /landmarks?|highlights?|popular travel dining|local food culture|\$\{?city\}?/i.test(value ?? ''))) throw new Error(`Capital card details contain placeholder content: ${result.capitalCardDetails?.join(', ')}`);
  if (result.toggleLabelBefore !== 'TOP 100 인기 도시 보기') throw new Error(`Expected TOP100 toggle label, found ${result.toggleLabelBefore}`);
  if (result.top100Title !== 'TOP 100 인기 도시') throw new Error(`Expected TOP100 title, found ${result.top100Title}`);
  if (result.toggleLabelAfter !== '수도 보기') throw new Error(`Expected return-to-capitals toggle label, found ${result.toggleLabelAfter}`);
  if (result.count !== '10') throw new Error(`Expected 10 visible TOP100 cities on active page, found ${result.count}`);
  if (result.top100GroupCount !== 1) throw new Error(`Expected 1 active TOP100 rank group, found ${result.top100GroupCount}`);
  if (!result.top100BottomListVisible) throw new Error('Expected desktop TOP100 bottom list to be visible');
  if (!result.top100PanelListHidden) throw new Error('Expected desktop TOP100 right-panel list to be hidden/detail-only');
  if (result.top100ListEntryCount !== 10) throw new Error(`Expected 10 active TOP100 bottom-list entries, found ${result.top100ListEntryCount}`);
  const expectedRankGroups = ['1-10'];
  const expectedPageLabels = ['1-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61-70', '71-80', '81-90', '91-100'];
  if (result.top100PageControlCount !== 10) throw new Error(`Expected 10 TOP100 page controls, found ${result.top100PageControlCount}`);
  if (JSON.stringify(result.top100PageLabels) !== JSON.stringify(expectedPageLabels)) throw new Error(`Expected TOP100 page labels ${expectedPageLabels.join(', ')}, found ${result.top100PageLabels?.join(', ')}`);
  if (JSON.stringify(result.top100RankGroups) !== JSON.stringify(expectedRankGroups)) throw new Error(`Expected active TOP100 rank group ${expectedRankGroups.join(', ')}, found ${result.top100RankGroups?.join(', ')}`);
  if (result.selectedCityFromQa?.id !== 'top100-hong-kong' || result.selectedCityFromQa?.rank !== 1) throw new Error(`Expected QA selected TOP100 Hong Kong rank 1, found ${JSON.stringify(result.selectedCityFromQa)}`);
  if (!result.listSelectedGlowVisible) throw new Error('Expected TOP100 list selection to show selected city marker glow');
  if (!result.listSelectedHighlighted) throw new Error('Expected TOP100 list selection to highlight selected list row');
  if (result.listFocusRotationDeltaY <= 0.08) throw new Error(`Expected list click to rotate/focus globe, delta=${result.listFocusRotationDeltaY}`);
  if (!result.focusedCityCardOpen) throw new Error('Expected existing detail card to be open after TOP100 list click');
  if (result.focusedCityCardTitle !== '1. Hong Kong') throw new Error(`Expected existing detail card to open Hong Kong, found ${result.focusedCityCardTitle}`);
  if (!result.focusedCityCardKicker?.includes('#1')) throw new Error(`Expected card kicker to include TOP100 rank, found ${result.focusedCityCardKicker}`);
  if (!result.focusedCityCardLink?.startsWith('https://')) throw new Error(`Expected focused card HTTPS link, found ${result.focusedCityCardLink}`);
  if (result.seoulMarkerCardTitle !== '24. Seoul') throw new Error(`Expected Seoul marker click to keep TOP100 city priority, found ${result.seoulMarkerCardTitle}`);
  if (!result.seoulMarkerGlowVisible || !result.seoulListHighlighted) throw new Error('Expected Seoul marker selection to keep glow and TOP100 list highlight');
  if (result.jejuMarkerCardTitle !== '87. Jeju') throw new Error(`Expected Jeju marker click to keep TOP100 city priority, found ${result.jejuMarkerCardTitle}`);
  if (!result.jejuMarkerGlowVisible || !result.jejuListHighlighted) throw new Error('Expected Jeju marker selection to keep glow and TOP100 list highlight');
  if (result.panelHasStatsLanguage) throw new Error('Expected old stats/premium panel language to be removed');
  if (!result.cityCardPresent) throw new Error('Expected existing city card surface to remain present');
  if (result.rotationDeltaY <= 0.006) throw new Error(`Expected globe auto-rotation, delta=${result.rotationDeltaY}`);
  if (result.weatherCopyPresent || result.weatherCardPresent) throw new Error('Expected weather UI/copy to be removed');
  if (result.mobileLayout?.viewport?.width !== 390 || result.mobileLayout?.viewport?.height !== 844) throw new Error(`Expected mandatory mobile smoke viewport 390x844, found ${JSON.stringify(result.mobileLayout?.viewport)}`);
  if (result.mobileLayout?.documentScrollWidth > 390 || result.mobileLayout?.bodyScrollWidth > 390) throw new Error(`Expected no horizontal overflow at 390px mobile viewport, found document=${result.mobileLayout?.documentScrollWidth}, body=${result.mobileLayout?.bodyScrollWidth}`);
  if (!result.mobileLayout?.stage || result.mobileLayout.stage.width > 390 || result.mobileLayout.stage.height < 480) throw new Error(`Expected mobile globe stage to fit 390px width with usable height, found ${JSON.stringify(result.mobileLayout?.stage)}`);
  if (!result.mobileLayout?.overlay || result.mobileLayout.overlay.left < -1 || result.mobileLayout.overlay.right > 391 || result.mobileLayout.overlay.width > 390) throw new Error(`Expected Korea overlay to fit within 390px viewport, found ${JSON.stringify(result.mobileLayout?.overlay)}`);
  if (!/auto|scroll/.test(result.mobileLayout?.overlayOverflowY ?? '')) throw new Error(`Expected mobile Korea overlay to allow vertical scrolling, found overflow-y=${result.mobileLayout?.overlayOverflowY}`);
  if (result.mobileLayout?.overlayDisplay !== 'flex' && (!result.mobileLayout?.overlayGridColumns || result.mobileLayout.overlayGridColumns.trim().includes(' '))) throw new Error(`Expected one-column or flex-stacked Korea overlay at 390px, found display=${result.mobileLayout?.overlayDisplay} grid=${result.mobileLayout?.overlayGridColumns}`);
  if (!result.mobileLayout?.canvas || result.mobileLayout.canvas.width > 390 || result.mobileLayout.canvas.width < 240 || !Number.isFinite(result.mobileLayout.canvasAspectRatio) || result.mobileLayout.canvasAspectRatio < 0.72 || result.mobileLayout.canvasAspectRatio > 0.86) throw new Error(`Expected rectangular Korea map canvas sized for 390px mobile viewport, found ${JSON.stringify(result.mobileLayout?.canvas)} ratio=${result.mobileLayout?.canvasAspectRatio}`);
  if (result.mobileLayout?.overlay && result.mobileLayout?.canvas && Math.abs(((result.mobileLayout.canvas.left + result.mobileLayout.canvas.right) / 2) - ((result.mobileLayout.overlay.left + result.mobileLayout.overlay.right) / 2)) > 3) throw new Error(`Expected mobile Korea map canvas to be centered in overlay, found ${JSON.stringify(result.mobileLayout)}`);
  if ((result.mobileLayout?.canvasPanelGap ?? 0) < 24) throw new Error(`Expected clearly separated Korea map/panel spacing at 390x844, found ${JSON.stringify(result.mobileLayout)}`);
  if (result.mobileLayout?.overlayDisplay !== 'flex' && (result.mobileLayout?.panelOverlayBottomGap ?? -1) < 8) throw new Error(`Expected Korea route panel to keep bottom breathing room at 390x844, found ${JSON.stringify(result.mobileLayout)}`);
  if (!result.mobileLayout?.panel || result.mobileLayout.panel.top < result.mobileLayout.canvas.bottom + 20) throw new Error(`Expected Korea route panel to be a distinct card below the map canvas on mobile, found panel=${JSON.stringify(result.mobileLayout?.panel)}, canvas=${JSON.stringify(result.mobileLayout?.canvas)}`);
  if (result.mobileLayout?.overlayDisplay !== 'flex' && (!Number.isFinite(result.mobileLayout?.routePanelBottomGap) || result.mobileLayout.routePanelBottomGap < 14)) throw new Error(`Expected Korea route panel bottom spacing inside mobile overlay, found ${JSON.stringify(result.mobileLayout)}`);
  if (result.mobileLayout?.overlayDisplay === 'flex' && !((result.mobileLayout?.overlayScrollHeight ?? 0) >= (result.mobileLayout?.overlayClientHeight ?? 0))) throw new Error(`Expected flex-stacked Korea overlay to own vertical scrolling for tall panel content, found ${JSON.stringify(result.mobileLayout)}`);
  if (result.viewMode !== 'korea-focus') throw new Error(`Expected renderer Korea focus mode, found ${result.viewMode}`);
  if (result.stageKoreaMode !== 'map') throw new Error(`Expected same-stage data-korea-mode=map, found ${result.stageKoreaMode}`);
  if (!result.koreaOverlayOpen) throw new Error('Expected Korea overlay to open inside globe stage');
  if (result.selectedRegion !== 'kr-korea-overview') throw new Error(`Expected Korea overview after family back action, found ${result.selectedRegion}`);
  if (result.renderedFirstLevelCount !== 17) throw new Error(`Expected 17 first-level Korea labels, found ${result.renderedFirstLevelCount}`);
  if (result.overviewTraceState?.overlay !== 'hidden' || result.overviewTraceState?.canvas !== 'hidden' || result.overviewTraceState?.routeLayerPresent || result.overviewTraceState?.activeRouteCount !== 0) throw new Error(`Expected overview family traces hidden, found ${JSON.stringify(result.overviewTraceState)}`);
  if (result.coordinateHitTestSkippedForMobile !== true) {
    if (result.firstLevelCoordinateHits?.length !== 17) throw new Error(`Expected 17 first-level coordinate hit-test clicks, found ${result.firstLevelCoordinateHits?.length}`);
    for (const coordinateHit of result.firstLevelCoordinateHits ?? []) {
      if (!coordinateHit.selected || coordinateHit.hitRegionId !== coordinateHit.regionId || !Number.isFinite(coordinateHit.clientX) || !Number.isFinite(coordinateHit.clientY)) throw new Error(`Expected valid document.elementFromPoint coordinate click for ${coordinateHit.regionId}, found ${JSON.stringify(coordinateHit)}`);
      if (coordinateHit.firstLevelTraceState?.overlay !== 'hidden' || coordinateHit.firstLevelTraceState?.canvas !== 'hidden' || coordinateHit.firstLevelTraceState?.routeLayerPresent || coordinateHit.firstLevelTraceState?.activeRouteCount !== 0) throw new Error(`Expected first-level family traces hidden for ${coordinateHit.regionId}, found ${JSON.stringify(coordinateHit.firstLevelTraceState)}`);
    }
  } else if (result.mobileLayout?.viewport?.width !== 390) {
    throw new Error(`Expected coordinate hit-test skip only for mandatory 390px mobile smoke, found ${JSON.stringify(result.mobileLayout?.viewport)}`);
  }
  if (result.koreaRegionCount !== 17) throw new Error(`Expected overview to render exactly 17 first-level Korea region polygons, found ${result.koreaRegionCount}: ${result.koreaRegionIds?.join(', ')}`);
  if ((result.overviewFamilyTargetRegionIds ?? []).length !== 0) throw new Error(`Expected no family/drilldown polygons in overview render set, found ${result.overviewFamilyTargetRegionIds?.join(', ')}`);
  if (!result.listHoverHighlightsMap || !result.mapHoverHighlightsList) throw new Error('Expected Korea list/map cross-highlight in both directions');
  if (result.vectorMapTelemetry?.style !== 'vector-satellite-inspired' || result.vectorMapTelemetry?.hostStyle !== 'vector-satellite-inspired') throw new Error(`Expected vector-only Korea map style marker, found ${JSON.stringify(result.vectorMapTelemetry)}`);
  if (result.vectorMapTelemetry?.rasterLayerPresent || result.vectorMapTelemetry?.rasterImagePresent || result.vectorMapTelemetry?.imageryStatePresent) throw new Error(`Expected no Korea raster layer/image/imagery telemetry, found ${JSON.stringify(result.vectorMapTelemetry)}`);
  if (!result.mapCanvasPresent) throw new Error('Expected Korea map SVG canvas to render');
  if (!result.daeguInfoText?.includes('Landmark') || !result.daeguInfoText?.includes('Food') || !result.daeguInfoText?.includes('서문시장') || !result.daeguInfoText?.includes('막창구이')) throw new Error(`Expected non-family region Landmark/Food panel, found ${result.daeguInfoText}`);
  if (!result.daeguInfoHref?.startsWith('https://namu.wiki/w/')) throw new Error(`Expected non-family region Namuwiki link, found ${result.daeguInfoHref}`);
  if (!result.selectedRegionToggleUpOk) throw new Error('Expected selected active Korea region to toggle back to its parent tier');
  for (const requiredRegionLabel of ['서울특별시', '부산광역시', '경상남도', '제주특별자치도']) {
    if (!result.koreaRegionLabels?.some((label) => label.includes(requiredRegionLabel))) throw new Error(`Expected Korea boundary aria label for ${requiredRegionLabel}, found ${result.koreaRegionLabels?.join(', ')}`);
  }
  if (result.overviewHouseholdMarkerCount !== 0) throw new Error(`Expected no household markers before terminal tier, found ${result.overviewHouseholdMarkerCount}: ${result.overviewHouseholdMarkerLabels?.join(', ')}`);
  if (result.decorativeNorthSilhouette?.present) throw new Error(`Expected deleted decorative north peninsula silhouette to be absent, found ${JSON.stringify(result.decorativeNorthSilhouette)}`);
  if (result.islandReferenceCount !== 0) throw new Error(`Expected no decorative island references after Ulleungdo/Dokdo removal, found ${result.islandReferenceCount}`);
  if ((result.islandReferenceLabels ?? []).length !== 0) throw new Error(`Expected no decorative island labels, found ${result.islandReferenceLabels?.join(', ')}`);
  if ((result.islandHitTargets ?? []).length !== 0 || result.dokdoHighlightsGyeongbuk) throw new Error(`Expected no decorative island hit targets, found ${JSON.stringify({ islandHitTargets: result.islandHitTargets, dokdoHighlightsGyeongbuk: result.dokdoHighlightsGyeongbuk })}`);
  if (result.koreaRegionLabels?.some((label) => label.includes('제주도'))) throw new Error(`Expected no extra 제주도 label; keep only 제주특별자치도, found ${result.koreaRegionLabels?.join(', ')}`);
  if (result.vectorTextureLayerPresent) throw new Error('Expected static Korea grain/wave texture layers to be removed');
  if (result.vectorPremiumStyle?.palette !== 'deep-ocean-vector' || result.vectorPremiumStyle?.canvasPalette !== 'deep-ocean-vector' || result.vectorPremiumStyle?.mapContract !== 'geometry-auto-fit' || result.vectorPremiumStyle?.hostMapContract !== 'geometry-auto-fit') throw new Error(`Expected deep ocean geometry auto-fit Korea map telemetry, found ${JSON.stringify(result.vectorPremiumStyle)}`);
  if (result.vectorMapTelemetry?.fitStrategy !== 'geometry-auto-fit') throw new Error(`Expected Korea vector geometry auto-fit strategy, found ${JSON.stringify(result.vectorMapTelemetry)}`);
  if (!Number.isFinite(result.vectorMapTelemetry?.fitScale) || result.vectorMapTelemetry.fitScale < 0.95 || result.vectorMapTelemetry.fitScale > 1.25) throw new Error(`Expected balanced Korea fit scale, found ${JSON.stringify(result.vectorMapTelemetry)}`);
  const rendered = result.renderedFootprint;
  const renderedCenterX = rendered ? (rendered.left + rendered.right) / 2 : Number.NaN;
  const canvasCenterX = rendered ? rendered.canvasWidth / 2 : Number.NaN;
  const renderedTopPadding = rendered?.top ?? Number.NaN;
  const renderedHeightRatio = rendered ? (rendered.bottom - rendered.top) / rendered.canvasHeight : 0;
  if (!rendered || Math.abs(renderedCenterX - canvasCenterX) > 4 || renderedTopPadding < 28 || renderedHeightRatio < 0.7) throw new Error(`Expected actual rendered Korea regions to be centered with visible north safe padding, found ${JSON.stringify(rendered)}`);
  if (result.vectorPremiumStyle?.islandCoverage !== 'province-rings') throw new Error(`Expected province-ring island coverage telemetry, found ${JSON.stringify(result.vectorPremiumStyle)}`);
  if (!result.vectorPremiumStyle?.terrainGradientPresent || result.vectorPremiumStyle?.terrainContoursPresent) throw new Error(`Expected premium terrain gradients without contour texture layer, found ${JSON.stringify(result.vectorPremiumStyle)}`);
  if (!result.removedSatelliteCopyAbsent) throw new Error('Expected old static satellite/public-data Korea copy to be removed');
  const expectedFirstLevelInfos = [
    { key: 'busanFirstLevelInfo', label: '부산광역시', region: 'kr-busan', nextLabel: '해운대구' },
    { key: 'seoulFirstLevelInfo', label: '서울특별시', region: 'kr-seoul', nextLabel: '마포구' },
    { key: 'gyeongnamFirstLevelInfo', label: '경상남도', region: 'kr-gyeongnam', nextLabel: '김해시' },
  ];
  for (const expectedInfo of expectedFirstLevelInfos) {
    const actualInfo = result[expectedInfo.key];
    if (actualInfo?.selectedRegion !== expectedInfo.region) throw new Error(`Expected ${expectedInfo.label} first-level region ${expectedInfo.region}, found ${actualInfo?.selectedRegion}`);
    if (!actualInfo?.hasLandmark || !actualInfo?.hasFood) throw new Error(`Expected ${expectedInfo.label} Landmark/Food panel, found ${actualInfo?.panelText}`);
    if (!actualInfo?.href?.startsWith('https://namu.wiki/w/')) throw new Error(`Expected ${expectedInfo.label} Namuwiki link, found ${actualInfo?.href}`);
    if (!actualInfo?.hasNextStep) throw new Error(`Expected ${expectedInfo.label} next-step ${expectedInfo.nextLabel}, found ${actualInfo?.routeChoiceLabels?.join(', ')}`);
    if (!actualInfo?.parentLabelPinned || !actualInfo?.parentSuppressedForChildHover || !actualInfo?.childLabelHighlighted) throw new Error(`Expected ${expectedInfo.label} selected parent label to pin, then yield to child hover label, found ${JSON.stringify({ parentLabelPinned: actualInfo?.parentLabelPinned, parentSuppressedForChildHover: actualInfo?.parentSuppressedForChildHover, childLabelHighlighted: actualInfo?.childLabelHighlighted, nextRegionId: actualInfo?.nextRegionId })}`);
    if (actualInfo?.householdCardCount !== 0) throw new Error(`Expected no household cards before ${expectedInfo.label} terminal drilldown, found ${actualInfo?.householdCardLabels?.join(', ')}`);
  }
  const expectedFamilyPaths = [
    { key: 'seoulFamilyPath', terminalRegion: 'kr-seoul-mapo', householdId: 'brother', householdLabel: '진주네', linkCount: 1, links: ['https://band.us/band/102062529'] },
    { key: 'gyeongnamFamilyPath', terminalRegion: 'kr-gimhae-bonghwang', householdId: 'home', householdLabel: '은하네', linkCount: 1, links: ['https://band.us/band/102317167'] },
    { key: 'busanParentsPath', terminalRegion: 'kr-busan-haeundae', householdId: 'parents', householdLabel: '한가네 본가', linkCount: 2, links: ['https://band.us/band/4640764', 'https://band.us/band/3889566'] },
    { key: 'busanSisterPath', terminalRegion: 'kr-busan-haeundae', householdId: 'sister', householdLabel: '건희민하찬희네', linkCount: 3, links: ['https://band.us/band/7751923', 'https://band.us/band/60060244', 'https://band.us/band/85496439'] },
  ];
  for (const expectedPath of expectedFamilyPaths) {
    const actualPath = result[expectedPath.key];
    if (actualPath?.terminalRegion !== expectedPath.terminalRegion) throw new Error(`Expected ${expectedPath.householdLabel} terminal ${expectedPath.terminalRegion}, found ${actualPath?.terminalRegion}`);
    if (actualPath?.selectedHousehold !== expectedPath.householdId) throw new Error(`Expected ${expectedPath.householdLabel} household ${expectedPath.householdId}, found ${actualPath?.selectedHousehold}`);
    if (actualPath?.nameGateState !== 'unlocked') throw new Error(`Expected ${expectedPath.householdLabel} name gate unlocked, found ${actualPath?.nameGateState}`);
    if (actualPath?.highlightedHouseholdId !== expectedPath.householdId) throw new Error(`Expected ${expectedPath.householdLabel} highlightedHouseholdId ${expectedPath.householdId}, found ${actualPath?.highlightedHouseholdId}`);
    if (!actualPath?.cardHoverHighlightsMarker || !actualPath?.markerHoverHighlightsCard || !actualPath?.selectedMarkerHighlighted) throw new Error(`Expected ${expectedPath.householdLabel} bidirectional household card/marker highlight, found ${JSON.stringify({ cardHoverHighlightsMarker: actualPath?.cardHoverHighlightsMarker, markerHoverHighlightsCard: actualPath?.markerHoverHighlightsCard, selectedMarkerHighlighted: actualPath?.selectedMarkerHighlighted })}`);
    if (!(actualPath?.markerLabelOpacityBeforeHover <= 0.08) || !(actualPath?.markerLabelOpacityOnHover >= 0.9) || !(actualPath?.markerDotOpacityBeforeHover < actualPath?.markerDotOpacityOnHover)) throw new Error(`Expected ${expectedPath.householdLabel} marker label/dot CSS to stay subtle until hover, found ${JSON.stringify({ markerLabelOpacityBeforeHover: actualPath?.markerLabelOpacityBeforeHover, markerLabelOpacityOnHover: actualPath?.markerLabelOpacityOnHover, markerDotOpacityBeforeHover: actualPath?.markerDotOpacityBeforeHover, markerDotOpacityOnHover: actualPath?.markerDotOpacityOnHover })}`);
    if (actualPath?.invalidFeedback !== '암구호 틀림') throw new Error(`Expected ${expectedPath.householdLabel} invalid gate copy, found ${actualPath?.invalidFeedback}`);
    if (actualPath?.linksBeforeUnlock !== 0) throw new Error(`Expected ${expectedPath.householdLabel} links hidden before unlock, found ${actualPath?.linksBeforeUnlock}`);
    if (!actualPath?.gateBeforeUnlockCopy?.includes('암구호를 대시오!') || !actualPath?.gateBeforeUnlockCopy?.includes('암구호 확인')) throw new Error(`Expected ${expectedPath.householdLabel} passphrase gate copy, found ${actualPath?.gateBeforeUnlockCopy}`);
    if (actualPath?.familyTraceState?.overlay !== 'terminal' || actualPath?.familyTraceState?.canvas !== 'terminal' || actualPath?.familyTraceState?.routeLayerPresent || actualPath?.familyTraceState?.activeRouteCount !== 0) throw new Error(`Expected terminal family route lines removed for ${expectedPath.householdLabel}, found ${JSON.stringify(actualPath?.familyTraceState)}`);
    if (actualPath?.terminalHouseholdMarkerCount !== 4) throw new Error(`Expected 4 terminal household markers for ${expectedPath.householdLabel}, found ${actualPath?.terminalHouseholdMarkerCount}`);
    for (const requiredHouseholdLabel of ['한가네 본가', '건희민하찬희네', '진주네', '은하네']) {
      if (!actualPath?.terminalHouseholdMarkerLabels?.includes(requiredHouseholdLabel)) throw new Error(`Expected terminal household marker label ${requiredHouseholdLabel}, found ${actualPath?.terminalHouseholdMarkerLabels?.join(', ')}`);
    }
    if (actualPath?.linkCount !== expectedPath.linkCount) throw new Error(`Expected ${expectedPath.householdLabel} ${expectedPath.linkCount} Band links, found ${actualPath?.linkCount}`);
    if (JSON.stringify(actualPath?.links) !== JSON.stringify(expectedPath.links)) throw new Error(`Expected exact band.us links for ${expectedPath.householdLabel}, found ${actualPath?.links?.join(', ')}`);
  }
  if (result.familyBackReturnsToOverview?.selectedRegion !== 'kr-korea-overview') throw new Error(`Expected family back button to return to Korea overview, found ${JSON.stringify(result.familyBackReturnsToOverview)}`);
  if (result.familyBackReturnsToOverview?.selectedHousehold !== null) throw new Error(`Expected family back button to clear selected household, found ${JSON.stringify(result.familyBackReturnsToOverview)}`);
  if (result.familyBackReturnsToOverview?.nameGateState !== 'closed') throw new Error(`Expected family back button to close name gate, found ${JSON.stringify(result.familyBackReturnsToOverview)}`);
  if (result.familyBackReturnsToOverview?.panelKicker !== '17 광역자치단체' || result.familyBackReturnsToOverview?.panelTitle !== '대한민국 17개 광역 행정구역' || result.familyBackReturnsToOverview?.regionCount !== 17) throw new Error(`Expected family back button to render 17-region overview panel, found ${JSON.stringify(result.familyBackReturnsToOverview)}`);
  if (result.selectedHousehold !== null) throw new Error(`Expected selected household cleared after family back, found ${result.selectedHousehold}`);
  if (result.nameGateState !== 'closed') throw new Error(`Expected closed name gate after family back, found ${result.nameGateState}`);
  if (result.linkCount !== 3) throw new Error(`Expected 3 건희민하찬희네 Band links before family back, found ${result.linkCount}`);
  if (JSON.stringify(result.links) !== JSON.stringify(['https://band.us/band/7751923', 'https://band.us/band/60060244', 'https://band.us/band/85496439'])) throw new Error(`Expected 건희민하찬희네 real band.us links, found ${result.links.join(', ')}`);
  console.log('PASS layout, exploration, Korea family paths, and Korea morph headless smoke', JSON.stringify(result));
} finally {
  await terminate(chrome);
  await terminate(preview);
  if (profileDir) await rm(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
