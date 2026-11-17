// Illustrationen im Sticker-Stil für Orte ohne Foto: man soll beim Swipen sofort sehen, worum es geht.
// Auswahl nach Stichworten im Namen und in der Notiz, sonst nach Kategorie. viewBox 0 0 120 120, Kontur in Tinte.
const S = 'stroke="#161616" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"';

const ART = {
  pizza: `<path d="M60 18 100 96a90 40 0 0 1-80 0z" fill="#FFD25E" ${S}/><path d="M20 96a90 40 0 0 0 80 0" fill="none" stroke="#C9772E" stroke-width="10" stroke-linecap="round"/><path d="M20 96a90 40 0 0 0 80 0" fill="none" ${S}/><circle cx="58" cy="52" r="7" fill="#E8553A" ${S}/><circle cx="48" cy="76" r="7" fill="#E8553A" ${S}/><circle cx="72" cy="78" r="7" fill="#E8553A" ${S}/>`,
  bagel: `<ellipse cx="60" cy="64" rx="42" ry="34" fill="#E3A35A" ${S}/><ellipse cx="60" cy="60" rx="14" ry="10" fill="var(--bgc)" ${S}/><g fill="#FFF6E0"><ellipse cx="38" cy="50" rx="3" ry="1.6"/><ellipse cx="80" cy="46" rx="3" ry="1.6"/><ellipse cx="86" cy="70" rx="3" ry="1.6"/><ellipse cx="44" cy="80" rx="3" ry="1.6"/><ellipse cx="62" cy="40" rx="3" ry="1.6"/><ellipse cx="66" cy="86" rx="3" ry="1.6"/></g>`,
  burger: `<path d="M22 56a38 26 0 0 1 76 0z" fill="#E3A35A" ${S}/><path d="M18 64q8-8 14 0t14 0 14 0 14 0 14 0 14 0" fill="none" stroke="#7BC74D" stroke-width="7" stroke-linecap="round"/><rect x="20" y="66" width="80" height="13" rx="6" fill="#7A4630" ${S}/><path d="M22 86h76v6a10 10 0 0 1-10 10H32a10 10 0 0 1-10-10z" fill="#E3A35A" ${S}/><g fill="#FFF6E0"><ellipse cx="46" cy="42" rx="3" ry="1.6"/><ellipse cx="62" cy="38" rx="3" ry="1.6"/><ellipse cx="76" cy="44" rx="3" ry="1.6"/></g>`,
  taco: `<path d="M16 86a44 44 0 0 1 88 0z" fill="#FFCF5C" ${S}/><path d="M24 80q6-14 14-6t12-4 12 2 12-6 12 4 10 10" fill="none" stroke="#7BC74D" stroke-width="8" stroke-linecap="round"/><circle cx="44" cy="70" r="5" fill="#E8553A"/><circle cx="70" cy="66" r="5" fill="#E8553A"/><path d="M16 86a44 44 0 0 1 88 0z" fill="none" ${S}/>`,
  ramen: `<path d="M18 58h84a42 38 0 0 1-84 0z" fill="#FFF6E0" ${S}/><path d="M30 66q6 10 12 0t12 0 12 0 12 0 12 0" fill="none" stroke="#E3A35A" stroke-width="5"/><circle cx="74" cy="60" r="8" fill="#FFD25E" ${S}/><path d="M66 18 50 56M84 20 64 56" ${S}/><path d="M44 104h32" ${S}/>`,
  donut: `<circle cx="60" cy="62" r="40" fill="#E3A35A" ${S}/><path d="M24 58q4-26 36-28t36 24q-6 10-12 4t-12 6-14-2-12 6-12-4-10-6z" fill="#FF8AD1" ${S}/><circle cx="60" cy="60" r="12" fill="var(--bgc)" ${S}/><g stroke-width="4" stroke-linecap="round"><path d="M40 46l4 3" stroke="#2F4BFF"/><path d="M76 42l-3 4" stroke="#C8F25A"/><path d="M84 58l4 1" stroke="#FFD25E"/><path d="M50 36l3-3" stroke="#FFD25E"/></g>`,
  coffee: `<path d="M26 46h60v28a26 26 0 0 1-26 26h-8a26 26 0 0 1-26-26z" fill="#FFF6E0" ${S}/><path d="M86 54h6a10 10 0 0 1 0 20h-8" fill="none" ${S}/><path d="M30 56h52" stroke="#7A4630" stroke-width="7"/><path d="M14 104h84" ${S}/><path d="M44 18q-6 8 0 14t0 12M60 16q-6 8 0 14t0 12" fill="none" ${S}/>`,
  bread: `<path d="M18 74q10-36 42-40t42 40q-8 14-24 12-6 8-18 8t-18-8q-16 2-24-12z" fill="#E3A35A" ${S}/><path d="M42 44l8 40M60 36v52M78 44l-8 40" fill="none" ${S}/>`,
  chicken: `<path d="M66 22a28 28 0 0 1 22 46L62 82q-12 6-20-4t2-22z" fill="#E3A35A" ${S}/><path d="M48 76 32 92" stroke="#FFF6E0" stroke-width="10" stroke-linecap="round"/><path d="M48 76 32 92" fill="none" ${S}/><circle cx="26" cy="92" r="7" fill="#FFF6E0" ${S}/><circle cx="34" cy="100" r="7" fill="#FFF6E0" ${S}/>`,
  dumpling: `<path d="M16 76q4-34 44-34t44 34q-20 14-44 14T16 76z" fill="#FFF6E0" ${S}/><path d="M36 50q4 8 0 14M50 44q4 10 0 16M64 44q4 10 0 16M78 48q4 8 0 14" fill="none" ${S}/><path d="M14 98h92" ${S}/>`,
  plate: `<circle cx="60" cy="62" r="36" fill="#FFF6E0" ${S}/><circle cx="60" cy="62" r="22" fill="none" ${S}/><path d="M16 34v24a6 6 0 0 0 12 0V34M22 34v70M98 34q-10 6-10 24h10v46" fill="none" ${S}/>`,
  bag: `<path d="M26 44h68l-6 58H32z" fill="#FF8AD1" ${S}/><path d="M44 52V36a16 16 0 0 1 32 0v16" fill="none" ${S}/><path d="M44 66l32 0" stroke="#FFF6E0" stroke-width="5"/>`,
  camera: `<rect x="16" y="40" width="88" height="56" rx="12" fill="#FFF6E0" ${S}/><path d="M42 40l6-12h24l6 12" fill="#FFF6E0" ${S}/><circle cx="60" cy="68" r="17" fill="#2F4BFF" ${S}/><circle cx="60" cy="68" r="7" fill="#161616"/><circle cx="90" cy="52" r="4" fill="#E8553A"/>`,
  ticket: `<path d="M16 40h88v14a8 8 0 0 0 0 16v14H16V70a8 8 0 0 0 0-16z" fill="#FFF6E0" ${S} transform="rotate(-8 60 60)"/><path d="M60 46l5 10 11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2z" fill="#FFD25E" ${S} transform="rotate(-8 60 60)"/>`,
  tree: `<circle cx="60" cy="46" r="28" fill="#7BC74D" ${S}/><circle cx="40" cy="62" r="18" fill="#7BC74D" ${S}/><circle cx="80" cy="62" r="18" fill="#7BC74D" ${S}/><path d="M60 70v34M48 104h24" ${S}/>`,
  xmas: `<path d="M60 18 86 56H72l20 28H28l20-28H34z" fill="#2E9E5B" ${S}/><path d="M54 84h12v16H54z" fill="#7A4630" ${S}/><path d="M60 8l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="#FFD25E" ${S}/><circle cx="52" cy="48" r="4" fill="#E8553A"/><circle cx="70" cy="64" r="4" fill="#FFD25E"/><circle cx="46" cy="72" r="4" fill="#2F4BFF"/>`,
  cocktail: `<path d="M24 26h72L60 66z" fill="#FF8AD1" ${S}/><path d="M60 66v32M44 100h32" ${S}/><circle cx="82" cy="24" r="10" fill="#C8F25A" ${S}/>`,
  suitcase: `<rect x="22" y="38" width="76" height="58" rx="10" fill="#FF5B3A" ${S}/><path d="M46 38V28a6 6 0 0 1 6-6h16a6 6 0 0 1 6 6v10" fill="none" ${S}/><path d="M40 38v58M80 38v58" ${S}/><circle cx="36" cy="102" r="5" fill="#161616"/><circle cx="84" cy="102" r="5" fill="#161616"/><rect x="52" y="56" width="16" height="12" rx="3" fill="#FFF6E0" ${S}/>`,
  walk: `<path d="M18 74c0-10 8-16 16-16 6 0 10 6 18 6h10c8 0 12 8 12 14v4H18z" fill="#2F4BFF" ${S}/><path d="M18 82h56v8H18z" fill="#FFF6E0" ${S}/><path d="M52 92c0-10 8-16 16-16 6 0 10 6 18 6h10c8 0 12 8 12 14v4H52z" fill="#FF8AD1" ${S} transform="translate(-8 -42)"/><path d="M44 58h56v8H44z" fill="#FFF6E0" ${S}/><path d="M34 64l4 0M44 64l4 0" ${S}/>`,
  skyline: `<path d="M14 100V58h16V40h14v60M48 100V30l8-14 8 14v70M68 100V48h18v52M90 100V62h16v38" fill="#FFF6E0" ${S}/><path d="M10 100h100" ${S}/>`,
};

const RULES = [
  ['suitcase', /ankommen|ankunft|anreise|abreise|hotel|flughafen|airport|check-?in/i], ['walk', /spaziergang|bummel|laufen|zu fu(ß|ss)|walk/i],
  ['pizza', /pizza|pizzeria/i], ['bagel', /bagel/i], ['burger', /burger/i], ['taco', /taco/i],
  ['ramen', /ramen|noodle|udon|pho\b/i], ['donut', /donut|doughnut/i], ['chicken', /chicken|wings|fried/i],
  ['dumpling', /dumpling|chinese|chines|fu zhou|wah fung|dim sum/i], ['bread', /bread|bakery|bäck|zimt|cinnamon|croissant|magnolia|salt/i],
  ['coffee', /coffee|café|cafe|kaffee|espresso/i], ['bag', /shop|shopping|store|boutique|vintage|thrift|mall|laden/i],
  ['xmas', /weihnacht|christmas|lichter|lights|eisbahn|rink|winter village/i], ['ticket', /theat|broadway|show|museum|moma|tenement|radio city/i],
  ['tree', /park|garden|high line|island|natur/i], ['cocktail', /bar\b|rooftop|cocktail|club/i],
];
const BY_CAT = { Essen: 'plate', Café: 'coffee', Sehen: 'skyline', Shopping: 'bag', Kultur: 'ticket', Natur: 'tree', Nachts: 'cocktail', Weihnachten: 'xmas' };

export function illusFor(p) {
  const text = `${p.title} ${p.note || ''}`;
  const hit = RULES.find(([, re]) => re.test(p.title)) || RULES.find(([, re]) => re.test(text));
  const key = hit ? hit[0] : BY_CAT[p.cat] || 'skyline';
  return `<svg viewBox="0 0 120 120" aria-hidden="true">${ART[key]}</svg>`;
}
