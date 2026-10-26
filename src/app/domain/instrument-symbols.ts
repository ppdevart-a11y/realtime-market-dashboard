/**
 * Maps an instrument index to a stable four-letter ticker: consonant–vowel–consonant–vowel, no Q,
 * 10,000 words before exclusions. ALFA and BETA lead; the list is prefix-stable.
 */

const CONSONANTS = 'BCDFGHJKLMNPRSTVWXYZ';
const VOWELS = 'AEIOU';
const WORD_SPACE = CONSONANTS.length * VOWELS.length * CONSONANTS.length * VOWELS.length;

/**
 * `index ↦ (index × STRIDE + OFFSET) mod WORD_SPACE` is a bijection because STRIDE shares no
 * factor with 10,000 (it is divisible by neither 2 nor 5). It scatters neighbouring indices, so
 * consecutive rows do not read BABE, BABI, BABO… The constants were picked by inspecting the
 * first fifty symbols, which are what a default-sized table shows.
 */
const STRIDE = 3_637;
const OFFSET = 1_234;

/** The two symbols the specification uses as examples lead the directory. */
const LEADING_SYMBOLS = ['ALFA', 'BETA'] as const;

/**
 * Words a generated ticker must not spell: slurs and vulgarities, words that read as data in a
 * table (NONE, LIRA next to dollar prices), and well-known real tickers or brands, so the
 * instruments stay recognisably fictional.
 */
export const EXCLUDED_SYMBOLS: ReadonlySet<string> = new Set(
  [
    // Offensive
    'CACA HOMO KAKA KIKE LOLI NAZI NIGA PAKI PEDO PUBE PUKE RAPE SEXO SUKA ZOPA',
    // Reads as data or as a currency
    'DIME LIRA NADA NONE PESO ZERO',
    // Real tickers and brands
    'BABA BILI CAVA DOCU FIVE FUTU LULU MARA MELI META MOMO NIKE NOVA RACE ROKU SAVE SOFI TATA VALE',
  ]
    .join(' ')
    .split(' '),
);

const directory: string[] = [...LEADING_SYMBOLS];
let nextCandidate = 0;

/** Reads `word` as a mixed-radix number whose digits index, in turn, C, V, C and V. */
function spell(word: number): string {
  const c = CONSONANTS.length;
  const v = VOWELS.length;
  return (
    CONSONANTS.charAt(word % c) +
    VOWELS.charAt(Math.floor(word / c) % v) +
    CONSONANTS.charAt(Math.floor(word / (c * v)) % c) +
    VOWELS.charAt(Math.floor(word / (c * v * c)) % v)
  );
}

function isAvailable(symbol: string): boolean {
  return !EXCLUDED_SYMBOLS.has(symbol) && !(LEADING_SYMBOLS as readonly string[]).includes(symbol);
}

/**
 * Symbols for instruments `0 … count − 1`. Deterministic and prefix-stable: the first `n`
 * symbols are the same for every `count ≥ n`.
 *
 * @throws {RangeError} if `count` exceeds the number of available words (just under 10,000).
 */
export function instrumentSymbols(count: number): readonly string[] {
  while (directory.length < count) {
    if (nextCandidate === WORD_SPACE) {
      throw new RangeError(
        `Only ${directory.length} unique symbols exist; ${count} were requested`,
      );
    }
    const symbol = spell((nextCandidate * STRIDE + OFFSET) % WORD_SPACE);
    nextCandidate += 1;
    if (isAvailable(symbol)) {
      directory.push(symbol);
    }
  }
  return directory.slice(0, count);
}
