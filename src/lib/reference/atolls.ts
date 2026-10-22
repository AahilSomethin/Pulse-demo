/** Official atoll abbreviations used by the Maldives Bureau of Statistics. */
export const ATOLL_CODES = [
  "HA",
  "HDh",
  "Sh",
  "N",
  "R",
  "B",
  "Lh",
  "K",
  "AA",
  "Adh",
  "V",
  "M",
  "F",
  "Dh",
  "Th",
  "L",
  "GA",
  "GDh",
  "Gn",
  "S",
] as const;

export type AtollCode = (typeof ATOLL_CODES)[number];

const CODE_BY_KEY = new Map<string, AtollCode>(ATOLL_CODES.map((code) => [code.toLowerCase(), code]));

/** Full atoll names only. Single-letter leftovers are not aliases. */
const NAME_ALIASES: Record<string, AtollCode> = {
  "haa alif": "HA",
  "haa alifu": "HA",
  "north thiladhunmathi": "HA",
  "haa dhaal": "HDh",
  "haa dhaalu": "HDh",
  "south thiladhunmathi": "HDh",
  shaviyani: "Sh",
  "north miladhunmadulu": "Sh",
  "north miladhunmathi": "Sh",
  noonu: "N",
  "south miladhunmadulu": "N",
  "south miladhunmathi": "N",
  raa: "R",
  "north maalhosmadulu": "R",
  "north maalhosmadulhu": "R",
  baa: "B",
  "south maalhosmadulu": "B",
  "south maalhosmadulhu": "B",
  lhaviyani: "Lh",
  faadhippolhu: "Lh",
  faadhippolu: "Lh",
  kaafu: "K",
  male: "K",
  maale: "K",
  "male city": "K",
  "alif alif": "AA",
  "alifu alifu": "AA",
  "alif alifu": "AA",
  "north ari": "AA",
  "alif dhaal": "Adh",
  "alif dhaalu": "Adh",
  "alifu dhaalu": "Adh",
  "south ari": "Adh",
  vaavu: "V",
  felidhu: "V",
  felidhe: "V",
  meemu: "M",
  mulaku: "M",
  faafu: "F",
  "north nilandhe": "F",
  "north nilandhu": "F",
  dhaalu: "Dh",
  "south nilandhe": "Dh",
  "south nilandhu": "Dh",
  thaa: "Th",
  kolhumadulu: "Th",
  kolhumadulhu: "Th",
  laamu: "L",
  hadhdhunmathi: "L",
  hadhdhunmati: "L",
  "gaafu alif": "GA",
  "gaafu alifu": "GA",
  "north huvadhu": "GA",
  "north huvadhoo": "GA",
  "gaafu dhaal": "GDh",
  "gaafu dhaalu": "GDh",
  "south huvadhu": "GDh",
  "south huvadhoo": "GDh",
  gnaviyani: "Gn",
  fuvahmulah: "Gn",
  foammulah: "Gn",
  seenu: "S",
  addu: "S",
  "addu city": "S",
};

export function normalisePlaceName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Maps an official abbreviation or a full atoll name to the census code.
 * Unrecognised text returns null so a guess is never stored as an atoll.
 */
export function canonicalAtoll(value: string | null | undefined): AtollCode | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const asCode = CODE_BY_KEY.get(trimmed.toLowerCase());
  if (asCode) return asCode;
  const words = normalisePlaceName(trimmed).replace(/\batolls?\b/g, "").replace(/\s+/g, " ").trim();
  return NAME_ALIASES[words] ?? null;
}

export const ATOLL_TITLES: Record<AtollCode, string> = {
  HA: "Haa Alifu",
  HDh: "Haa Dhaalu",
  Sh: "Shaviyani",
  N: "Noonu",
  R: "Raa",
  B: "Baa",
  Lh: "Lhaviyani",
  K: "Kaafu",
  AA: "Alif Alifu",
  Adh: "Alif Dhaalu",
  V: "Vaavu",
  M: "Meemu",
  F: "Faafu",
  Dh: "Dhaalu",
  Th: "Thaa",
  L: "Laamu",
  GA: "Gaafu Alifu",
  GDh: "Gaafu Dhaalu",
  Gn: "Gnaviyani",
  S: "Seenu",
};

export function atollQueryText(code: AtollCode): string {
  const aliases = Object.entries(NAME_ALIASES).filter(([, value]) => value === code).map(([name]) => name);
  return [code, ATOLL_TITLES[code], ...aliases].join(" ");
}
