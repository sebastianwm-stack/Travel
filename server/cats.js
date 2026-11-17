// Kategorien für Orte. Die Farben stehen im Frontend (public/js/themes.js).
export const CATS = ['Essen', 'Café', 'Sehen', 'Shopping', 'Kultur', 'Natur', 'Nachts', 'Weihnachten'];

const RULES = [
  ['Café', /caf[eé]|coffee|kaffee|bakery|b[aä]ckerei|donut|bagel|bread|zimt|cinnamon|tea\b|matcha|patisserie|croissant/i],
  ['Essen', /pizza|burger|ramen|taco|restaurant|food|steak|sushi|noodle|dumpling|chicken|bbq|grill|deli|diner|kitchen|bistro|trattoria|essen|eat|bar & grill|market/i],
  ['Weihnachten', /christmas|weihnacht|xmas|winter village|lichter|holiday/i],
  ['Kultur', /museum|gallery|galerie|theat|broadway|oper|opera|concert|konzert|show|moma|met\b/i],
  ['Natur', /park|garden|garten|beach|strand|trail|island|see\b|lake|wald|berg/i],
  ['Shopping', /shop|store|boutique|vintage|thrift|mall|market hall|laden|kaufhaus|outlet/i],
  ['Nachts', /bar\b|club|rooftop|lounge|cocktail|pub\b/i],
];

export function guessCat(text) {
  for (const [cat, re] of RULES) if (re.test(text || '')) return cat;
  return 'Sehen';
}

export const validCat = (c) => (CATS.includes(c) ? c : 'Sehen');
