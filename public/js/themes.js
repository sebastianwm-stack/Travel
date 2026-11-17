// Gestaltung je Reiseziel: Farbe der Kopfzeile, Mond/Sonne und eine Silhouette am unteren Rand.
// Neue Ziele: Eintrag in THEMES anlegen (Silhouette als SVG-Pfad, viewBox 0 0 390 140, Boden bei y=140).

const NYC_BACK = 'M0 140V96h18V82h14v-8h20v66zM78 140V88h16V70h22v18h10v52zM128 140V60h20v-8h12v88zM196 140V78h14V58h18v82zM268 140V66h12V50h14v16h10v74zM306 140V84h22V72h16v68zM346 140V62h16V48h12v14h16v78z';
const NYC_FRONT = [
  'M0 140V112h22v28z',
  'M24 140V74l7-44h14l7 44v66z', 'M37 30V4h2v26z',                 // One World Trade Center
  'M54 140V98h18v42z', 'M74 140V86h12V76h14v64z',
  'M102 140V104h24v36z',
  'M128 140V70h8V58h14v12h8v70z',
  'M160 140V96h10v44z',
  'M172 140V66h4l3-16h3l3-14h2l3 14h3l3 16h4v74z', 'M183 36V12h2v24z', // Chrysler
  'M206 140V92h20v48z',
  'M228 140V72h6V56h6V44h5V26h4v18h5v12h6v16h6v68z', 'M246.5 26V6h1.5v20z', // Empire State
  'M268 140V100h18v40z', 'M288 140V80h16v60z', 'M306 140V94h14V86h10v54z',
  'M332 140V74h20v66z', 'M354 140V100h12V90h24v50z',
].join('');

const CITY_BACK = 'M0 140V90h30v50zM40 140V70h26v70zM80 140V96h20v44zM110 140V60h24v80zM150 140V84h30v56zM196 140V66h22v74zM232 140V92h26v48zM270 140V58h20v82zM304 140V80h28v60zM344 140V70h46v70z';
const CITY_FRONT = 'M0 140V106h26v34zM28 140V86h18v54zM50 140V100h24v40zM78 140V74h14V62h10v78zM106 140V96h22v44zM132 140V82h20v58zM156 140V104h28v36zM188 140V70h12V54h4v16h12v70zM220 140V98h22v42zM246 140V84h18v56zM268 140V108h30v32zM302 140V76h24v64zM330 140V94h20v46zM354 140V82h36v58z';

const MOUNTAINS_BACK = 'M0 140V96l40-30 34 22 52-50 46 40 30-20 52 44 44-36 50 30 42-26v70z';
const MOUNTAINS_FRONT = 'M0 140v-24l56-40 36 26 50-44 60 52 34-20 54 40 48-34 52 34v10z';
const WAVES_BACK = 'M0 140V110c32-10 64-10 98 0s64 10 98 0 64-10 98 0 64 10 96 0v30z';
const WAVES_FRONT = 'M0 140v-16c32 10 64 10 98 0s64-10 98 0 64 10 98 0 64-10 96 0v16z';

export const THEMES = {
  nyc: { label: 'New York', hero: '#2F4BFF', back: '#4D66FF', front: '#1B30C9', orb: '#C8F25A', ink: '#FFFFFF', paths: [NYC_BACK, NYC_FRONT] },
  stadt: { label: 'Stadt', hero: '#6A3DF0', back: '#8461F5', front: '#4A23C4', orb: '#FFB627', ink: '#FFFFFF', paths: [CITY_BACK, CITY_FRONT] },
  strand: { label: 'Strand', hero: '#FF7A45', back: '#FF9A6E', front: '#E0542A', orb: '#FFE45C', ink: '#161616', paths: [WAVES_BACK, WAVES_FRONT] },
  berge: { label: 'Berge', hero: '#0E6B47', back: '#2F8A63', front: '#0A4F35', orb: '#F4F1E8', ink: '#FFFFFF', paths: [MOUNTAINS_BACK, MOUNTAINS_FRONT] },
};

export function themeFor(trip) {
  if (trip && THEMES[trip.theme]) return THEMES[trip.theme];
  const d = (trip?.dest || '').toLowerCase();
  if (/new york|nyc|manhattan|brooklyn/.test(d)) return THEMES.nyc;
  if (/strand|beach|insel|mallorca|naxos|kreta|meer/.test(d)) return THEMES.strand;
  if (/alpen|berg|tirol|dolomit|wander/.test(d)) return THEMES.berge;
  return THEMES.stadt;
}

export function skylineSVG(theme) {
  const [back, front] = theme.paths;
  return `<svg class="skyline" viewBox="0 0 390 140" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    <path d="${back}" fill="${theme.back}"/><path d="${front}" fill="${theme.front}"/></svg>`;
}

// Kategorien: Sticker-Farben (Text immer mit ausreichendem Kontrast)
export const CATS = {
  Essen: { bg: '#FF5B3A', fg: '#161616' },
  Café: { bg: '#FFB627', fg: '#161616' },
  Sehen: { bg: '#C8F25A', fg: '#161616' },
  Shopping: { bg: '#FF8AD1', fg: '#161616' },
  Kultur: { bg: '#6A3DF0', fg: '#FFFFFF' },
  Natur: { bg: '#0E6B47', fg: '#FFFFFF' },
  Nachts: { bg: '#161616', fg: '#FFFFFF' },
  Weihnachten: { bg: '#C8102E', fg: '#FFFFFF' },
};
export const CAT_NAMES = Object.keys(CATS);
