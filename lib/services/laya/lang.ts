/**
 * Language/script detection for Laya checkpoint routing (spec 18, P1 verbatim
 * port of `laya/lang.py`).
 *
 * Routing needs one decision: *is this English Latin text, or something the
 * English checkpoint cannot read?* Script detection is exact; the Latin-script
 * language guess is a stopword/diacritic heuristic (best-effort — pass an
 * explicit model or `lang=` when you already know).
 */

/** Unicode blocks the English (ModernBERT-large, 50k English BPE) checkpoint cannot read. */
export const SCRIPT_RANGES: Array<[string, Array<[number, number]>]> = [
  ["greek", [[0x0370, 0x03ff], [0x1f00, 0x1fff]]],
  ["cyrillic", [[0x0400, 0x052f], [0x2de0, 0x2dff], [0xa640, 0xa69f]]],
  ["armenian", [[0x0530, 0x058f]]],
  ["hebrew", [[0x0590, 0x05ff]]],
  ["arabic", [[0x0600, 0x06ff], [0x0750, 0x077f], [0x08a0, 0x08ff], [0xfb50, 0xfdff], [0xfe70, 0xfeff]]],
  ["devanagari", [[0x0900, 0x097f], [0xa8e0, 0xa8ff]]],
  ["bengali", [[0x0980, 0x09ff]]],
  ["gurmukhi", [[0x0a00, 0x0a7f]]],
  ["gujarati", [[0x0a80, 0x0aff]]],
  ["oriya", [[0x0b00, 0x0b7f]]],
  ["tamil", [[0x0b80, 0x0bff]]],
  ["telugu", [[0x0c00, 0x0c7f]]],
  ["kannada", [[0x0c80, 0x0cff]]],
  ["malayalam", [[0x0d00, 0x0d7f]]],
  ["sinhala", [[0x0d80, 0x0dff]]],
  ["thai", [[0x0e00, 0x0e7f]]],
  ["lao", [[0x0e80, 0x0eff]]],
  ["tibetan", [[0x0f00, 0x0fff]]],
  ["myanmar", [[0x1000, 0x109f]]],
  ["georgian", [[0x10a0, 0x10ff]]],
  ["ethiopic", [[0x1200, 0x137f]]],
  ["khmer", [[0x1780, 0x17ff]]],
  ["hangul", [[0x1100, 0x11ff], [0x3130, 0x318f], [0xac00, 0xd7af]]],
  ["kana", [[0x3040, 0x309f], [0x30a0, 0x30ff], [0x31f0, 0x31ff]]],
  ["han", [[0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff]]],
];

/**
 * Function words per Latin-script language. Romance lists deliberately carry
 * the UNACCENTED function words too: any pipeline that normalises to ASCII
 * strips accents, so `la`, `un`, `y`, `e`, `et` are the only evidence left.
 * Word-for-word from `laya/lang.py` (insertion order matters for ties).
 */
export const STOP: Record<string, ReadonlySet<string>> = {
  en: new Set([
    "the", "and", "is", "are", "was", "were", "to", "of", "in", "for", "with", "that",
    "this", "it", "you", "have", "has", "not", "but", "on", "at", "be", "as", "from",
    "will", "can", "would", "there", "their", "what", "which", "please", "we", "i",
  ]),
  fr: new Set([
    "le", "la", "les", "des", "une", "est", "pour", "dans", "que", "qui", "avec", "sur",
    "pas", "plus", "nous", "vous", "être", "cette", "mais", "sont", "ont", "aux", "ce",
    "et", "du", "au", "ou", "je", "tu", "il", "elle", "ils", "elles", "mon", "ton",
    "ma", "ta", "sa", "mes", "tes", "ses", "ces", "deux", "trois", "très", "bien",
    "tout", "tous", "toute", "fait", "veux", "veut", "peux", "peut", "dois", "doit",
    "merci", "bonjour", "jour", "jours", "mois", "fois", "quand", "comment", "pourquoi",
    "alors", "donc",
  ]),
  de: new Set([
    "der", "die", "das", "und", "ist", "ein", "eine", "den", "dem", "nicht", "mit", "für",
    "auf", "von", "zu", "sich", "auch", "werden", "wurde", "haben", "sind", "oder", "aber",
  ]),
  es: new Set([
    "el", "los", "las", "que", "por", "con", "para", "una", "es", "se", "del", "como",
    "pero", "son", "está", "este", "esta", "todo", "más", "muy", "hay", "sus",
    // `de`/`en` are Spanish too but common English tokens as well (`de facto`,
    // `en-US`, `Rio de Janeiro`); a state of those alone carries no English
    // word for the margin to weigh against, so they stay out.
    "la", "un", "y", "al", "lo", "le", "les", "su", "mi", "tu", "nos",
    "ni", "dos", "tres", "fue", "fueron", "ser", "tiene", "tienen", "tengo", "puede",
    "pueden", "quiero", "necesito", "hemos", "han", "sobre", "entre", "cuando", "donde",
    "porque", "aunque", "también", "ya", "eso", "esto", "esa", "ese", "nada", "algo",
    "aquí", "hoy", "gracias",
  ]),
  pt: new Set([
    "os", "as", "que", "em", "um", "uma", "para", "com", "não", "é", "se", "do", "da",
    "dos", "das", "mas", "são", "está", "este", "esta", "muito", "pelo", "pela",
    // `no` is Portuguese too but among the most frequent English words, so it
    // stays out; short Portuguese states leaning on it alone are left to the
    // diacritic rate.
    "o", "e", "na", "nas", "nos", "ao", "aos", "por", "foi", "era", "ser", "sou",
    "tem", "tenho", "pode", "podem", "quero", "preciso", "eu", "meu", "minha", "seu",
    "sua", "isso", "isto", "aqui", "ali", "como", "quando", "onde", "porque", "mais",
    "já", "ainda", "agora", "hoje", "ontem", "dois", "três", "tudo", "nada", "obrigado",
    "olá",
  ]),
  it: new Set([
    "il", "lo", "gli", "che", "di", "per", "con", "non", "è", "si", "del", "della", "sono",
    "questo", "questa", "anche", "come", "più", "nella", "alla",
    "la", "le", "un", "uno", "una", "e", "ed", "o", "da", "su", "tra", "fra", "mi",
    "ci", "ne", "ho", "hai", "ha", "abbiamo", "avete", "hanno", "era", "stato", "stata",
    "devo", "deve", "devono", "voglio", "vorrei", "mio", "mia", "tuo", "sua", "quando",
    "dove", "perche", "molto", "poco", "sempre", "mai", "già", "ancora", "adesso", "oggi",
    "ieri", "grazie", "ciao", "scusa",
    // the articulated prepositions: Italian-only words
    "nel", "nell", "negli", "sul", "sulla", "sulle", "dal", "dalla", "dallo", "dagli", "dei",
    "delle", "dello", "degli", "agli", "alle", "col",
  ]),
  nl: new Set([
    "het", "een", "van", "is", "op", "te", "dat", "niet", "met", "voor", "zijn", "aan",
    "door", "maar", "ook", "worden", "deze", "naar", "wordt",
  ]),
  // Romanian words its Romance neighbours do not share: `la`, `o`, `un`, `de`,
  // `pe`, `ca` are deliberately left out so `ro` cannot steal another state.
  ro: new Set([
    "și", "să", "este", "sunt", "care", "pentru", "din", "dar", "după", "până", "fără",
    "ale", "lui", "în", "fost", "acum", "vreau", "trebuie", "foarte", "acest", "această",
    "acesta", "aceasta", "mi", "ți", "vă", "nu",
  ]),
};

/** Letters ordinary English does not use; catches Latin-script languages with no stopword list. */
export const NON_EN_DIACRITICS: ReadonlySet<string> = new Set(
  // Western European / Romanian / Polish / Czech+Slovak / Hungarian / Turkish / Baltic / Serbo-Croatian
  "àâäãáåçéèêëíìîïñóòôöõøúùûüýÿßæœ" +
    "ăâîșțşţ" +
    "ąćęłńśźż" +
    "čďěňřšťůž" +
    "őű" +
    "ğı" +
    "āēģīķļņūž" +
    "đ",
);

/** Words claimed by more than one language list (venn-overlap). */
export const SHARED_WORDS: ReadonlySet<string> = (() => {
  const all = new Set<string>();
  for (const sw of Object.values(STOP)) for (const w of sw) all.add(w);
  const shared = new Set<string>();
  for (const w of all) {
    let n = 0;
    for (const sw of Object.values(STOP)) if (sw.has(w)) n++;
    if (n > 1) shared.add(w);
  }
  return shared;
})();

/**
 * Python `re.compile(r"[^\W\d_]+", re.UNICODE)`: word chars minus digits minus
 * underscore = Unicode letters (L*). Documented deviation: Python `\w` also
 * matches letter numbers (Nl/No) and combining marks it classifies as
 * alphanumeric; JS `\p{L}` is the closest practical equivalent.
 */
const WORD = /\p{L}+/gu;
const LETTER = /\p{L}/u;

/** Python `round(x, 4)` — round-half-even on the decimal value. */
function round4HalfEven(x: number): number {
  const scaled = x * 1e4;
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  let rounded: number;
  if (frac > 0.5) rounded = floor + 1;
  else if (frac < 0.5) rounded = floor;
  else rounded = floor % 2 === 0 ? floor : floor + 1; // tie → even
  return rounded / 1e4;
}

type Stateish = string | Record<string, unknown> | unknown[] | null | undefined;

/** `_iter_text`: collect the string leaves of a state (str/dict/list). */
function iterText(state: unknown, depth = 0): string[] {
  if (depth > 6 || state === null || state === undefined) return [];
  if (typeof state === "string") return [state];
  if (Array.isArray(state)) {
    const out: string[] = [];
    for (const v of state) out.push(...iterText(v, depth + 1));
    return out;
  }
  if (typeof state === "object") {
    const out: string[] = [];
    for (const v of Object.values(state as Record<string, unknown>)) out.push(...iterText(v, depth + 1));
    return out;
  }
  return [];
}

/** `state_text`: flatten a state into the text used for detection. */
export function stateText(state: Stateish, maxChars = 4000): string {
  return iterText(state).join(" ").slice(0, maxChars);
}

/**
 * `detect_script`: dominant script of `text` — "latin", "han", "devanagari",
 * ... or "unknown". Python `max(items, key=value)` returns the FIRST maximal
 * in insertion order, so JS must keep the first best (strictly-greater only).
 */
export function detectScript(text: string): string {
  const counts: Record<string, number> = {};
  let latin = 0;
  for (const ch of text) {
    if (!LETTER.test(ch)) continue;
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x0250 || (cp >= 0x1e00 && cp <= 0x1eff)) {
      // Latin + Latin Extended Additional
      latin += 1;
      continue;
    }
    for (const [name, ranges] of SCRIPT_RANGES) {
      if (ranges.some(([lo, hi]) => cp >= lo && cp <= hi)) {
        counts[name] = (counts[name] ?? 0) + 1;
        break;
      }
    }
  }
  counts.latin = latin;
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  if (total === 0) return "unknown";
  let best: string | null = null;
  let bestN = 0;
  for (const [k, v] of Object.entries(counts)) {
    if (best === null || v > bestN) {
      best = k;
      bestN = v;
    }
  }
  return best as string;
}

/** `script_profile`: fraction of alphabetic characters per detected script. */
export function scriptProfile(text: string): Record<string, number> {
  const counts: Record<string, number> = { latin: 0 };
  for (const ch of text) {
    if (!LETTER.test(ch)) continue;
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x0250 || (cp >= 0x1e00 && cp <= 0x1eff)) {
      counts.latin += 1;
      continue;
    }
    for (const [name, ranges] of SCRIPT_RANGES) {
      if (ranges.some(([lo, hi]) => cp >= lo && cp <= hi)) {
        counts[name] = (counts[name] ?? 0) + 1;
        break;
      }
    }
  }
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  if (!total) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) if (v) out[k] = v / total;
  return out;
}

export const NON_EN_DIACRITIC_RATE = 0.02;

export interface LatinProfile {
  language: string | null;
  englishHits: number;
  diacriticRate: number;
  looksNonEnglish: boolean;
}

/**
 * `latin_profile`: evidence behind the Latin-script language guess. A language
 * is only named when it matched at least one word no other list claims.
 */
export function latinProfile(text: string): LatinProfile {
  const words = (text.match(WORD) ?? []).map((w) => w.toLowerCase());
  const lowered = text.toLowerCase();
  let diac = 0;
  for (const ch of lowered) if (NON_EN_DIACRITICS.has(ch)) diac += 1;
  const diacriticRate = diac / Math.max(1, lowered.length);
  const looksNonEnglish = diacriticRate >= NON_EN_DIACRITIC_RATE;
  if (words.length < 4) {
    return { language: null, englishHits: 0, diacriticRate, looksNonEnglish };
  }
  const scores: Record<string, number> = {};
  for (const [lg, sw] of Object.entries(STOP)) {
    scores[lg] = 0;
    for (const w of words) if (sw.has(w)) scores[lg] += 1;
  }
  const en = scores.en ?? 0;
  // Only a language that matched at least one word no other list claims may
  // be named; shared words alone (`la`, `e`, `o`) identify no language.
  const evidenced: Record<string, number> = {};
  for (const [lg, s] of Object.entries(scores)) {
    if (lg === "en") continue;
    const hit = words.some((w) => STOP[lg].has(w) && !SHARED_WORDS.has(w));
    if (hit) evidenced[lg] = s;
  }
  let bestLg: string | null = null;
  let best = 0;
  for (const [lg, s] of Object.entries(evidenced)) {
    if (bestLg === null || s > best) {
      bestLg = lg;
      best = s;
    }
  }
  let language: string | null = null;
  if (bestLg && best >= Math.max(2, en + 2)) {
    language = bestLg; // clear margin over English function words
  } else if (bestLg && looksNonEnglish && best >= Math.max(2, en)) {
    language = bestLg; // needs two hits; diacritics alone don't name a language
  } else if (en && !looksNonEnglish) {
    language = "en";
  }
  return { language, englishHits: en, diacriticRate, looksNonEnglish };
}

/** `guess_latin_language`: best-effort code, or null when undecided. */
export function guessLatinLanguage(text: string): string | null {
  return latinProfile(text).language;
}

export interface LangAnalysis {
  script: string;
  scriptProfile: Record<string, number>;
  language: string | null;
  isEnglish: boolean;
  languageUndecided: boolean;
  diacriticRate: number;
  nonLatinFraction: number;
}

/** `analyse`: full detection result for a state. */
export function analyse(state: Stateish): LangAnalysis {
  const text = stateText(state);
  const prof = scriptProfile(text);
  const script = detectScript(text);
  const nonLatinFraction = prof ? round4HalfEven(1.0 - (prof.latin ?? 0.0)) : 0.0;
  if (script === "unknown") {
    return {
      script: "unknown",
      scriptProfile: prof,
      language: null,
      isEnglish: true,
      languageUndecided: true,
      diacriticRate: 0.0,
      nonLatinFraction: 0.0,
    };
  }
  if (script !== "latin") {
    return {
      script,
      scriptProfile: prof,
      language: null,
      isEnglish: false,
      languageUndecided: true,
      diacriticRate: 0.0,
      nonLatinFraction,
    };
  }
  const profLat = latinProfile(text);
  const lang = profLat.language;
  // Undecided is not English: text with non-English letters but no stopword
  // list wants the multilingual checkpoint.
  const languageUndecided = lang === null;
  const isEnglish = lang === "en" || (languageUndecided && !profLat.looksNonEnglish);
  return {
    script: "latin",
    scriptProfile: prof,
    language: lang,
    isEnglish,
    languageUndecided,
    diacriticRate: round4HalfEven(profLat.diacriticRate),
    nonLatinFraction,
  };
}

/** `is_english`: true when the English checkpoint can be expected to read this state. */
export function isEnglish(state: Stateish): boolean {
  return analyse(state).isEnglish;
}