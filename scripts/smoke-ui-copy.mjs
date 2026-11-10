import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = [
  'src/main.ts',
  'src/globeRenderer.ts',
  'src/assetsPolicy.ts',
  'src/explorationOverlay.ts',
  'src/koreaFamilyOverlay.ts',
  'src/capitals.ts',
  'src/styles.css',
];
const sources = Object.fromEntries(await Promise.all(
  sourceFiles.map(async (file) => [file, await readFile(join(root, file), 'utf8')])
));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const combined = Object.values(sources).join('\n');
const forbiddenVisibleCopy = [
  'The globe is glowing with its final details.',
  'Earth imagery and optional atmosphere enhancements are active.',
  'Earth surface texture from the Three.js examples planets set; planning source references NASA Blue Marble / Earth Observatory imagery.',
  'Cloud texture from the Three.js examples planets set; optional non-blocking enhancement.',
  'Night-lights texture from the Three.js examples planets set; optional non-blocking enhancement.',
  'Earth imagery policy loading…',
  'Earth Ready',
  'Earth ready',
  'Earth view preparing',
  'asset enhancement ready',
  'A warm illustrated Earth is ready for exploration.',
];

for (const copy of forbiddenVisibleCopy) {
  assert(!combined.includes(copy), `technical visible UI copy must be absent: ${copy}`);
}


const requiredGiftCopy = [
  'Our Earth',
  'where are you? where do you want to go?',
  '전 세계 UN가입국의 수도를 보여줍니다',
  '17 광역자치단체',
  '관할 기초자치단체',
  '암구호를 대시오!',
  '암구호 확인',
  '암구호 틀림',
];
for (const copy of requiredGiftCopy) {
  assert(combined.includes(copy), `required polished UI copy must be present: ${copy}`);
}

const forbiddenKoreaCopy = [
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
  'The globe is glowing with its final details.',
  '이름 확인 후 가족 밴드로 연결됩니다',
  '위키 링크로 더 자세히 탐험할 수 있어요.',
  '정적 검증 데이터로 순위와 링크를 제공합니다.',
];
for (const copy of forbiddenKoreaCopy) {
  assert(!combined.includes(copy), `old visible UI copy must be absent: ${copy}`);
}

assert(!sources['src/main.ts'].includes("state.replaceAll('-', ' ');"), 'UI must not render raw technical state ids such as asset enhancement ready');
assert(sources['src/main.ts'].includes('friendlyStateLabels'), 'main UI must map runtime state ids to family-friendly labels');
assert(sources['src/globeRenderer.ts'].includes('where are you? where do you want to go?'), 'final ready message should use the approved first-screen copy');
assert(sources['src/assetsPolicy.ts'].includes('NASA_GIBS_BLUE_MARBLE'), 'NASA GIBS Blue Marble constants must be defined');
assert(sources['src/assetsPolicy.ts'].includes('BlueMarble_NextGeneration'), 'NASA GIBS BlueMarble_NextGeneration layer must be configured');
assert(sources['src/assetsPolicy.ts'].includes("REQUEST: 'GetMap'"), 'NASA GIBS helper must use WMS GetMap image GET parameters');
assert(sources['src/assetsPolicy.ts'].includes('loadImageViaGet'), 'primary imagery must have an explicit GET image load helper');
assert(sources['src/assetsPolicy.ts'].includes('shouldForcePrimaryTextureFailure'), 'fallback QA hook must remain available');
assert(sources['src/globeRenderer.ts'].includes('loadPrimaryEarthTexture'), 'globe renderer must load primary Earth imagery through the image helper');

assert(sources['src/styles.css'].includes('@font-face') && sources['src/styles.css'].includes('Great Vibes Self Hosted'), 'script title must use a self-hosted premium script @font-face');
assert(sources['src/styles.css'].includes('./assets/fonts/great-vibes-v21-latin-regular.woff2'), 'script title font must load from the bundled app asset path');
assert(!/fonts\.(?:googleapis|gstatic)\.com|https?:\/\//i.test(sources['src/styles.css']), 'runtime CSS must not load the script font from a CDN or external URL');
assert(sources['src/styles.css'].includes('font-family: "Great Vibes Self Hosted"'), 'script-title must prefer the self-hosted script font before system fallbacks');
assert(!combined.includes('korea-raster-layer') && !combined.includes('korea-raster-image'), 'Korea UI source must not retain raster layer/image contracts');
assert(combined.includes('vector-satellite-inspired'), 'Korea UI source must expose vector-only satellite-inspired map style');

console.log('PASS UI copy smoke: approved G001 copy/gate polish is present and old copy is absent');
