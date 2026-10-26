/** What a settings field's text says, before any range rule is applied. */
export type NumberText =
  | { readonly kind: 'empty' }
  | { readonly kind: 'whole'; readonly value: number }
  | { readonly kind: 'fraction' }
  | { readonly kind: 'unreadable' };

/** Digits, ungrouped or grouped in thousands with commas after a first group of one to three. */
const WHOLE_PATTERN = /^(?:\d{1,3}(?:,\d{3})+|\d+)$/;

/** The same digits followed by a decimal part, or a bare decimal part ("2.5", "2.0", ".5"). */
const FRACTION_PATTERN = /^(?:\d{1,3}(?:,\d{3})+|\d+)?\.\d+$/;

/**
 * Reads a number as people type it into a settings field, ignoring surrounding whitespace.
 *
 * Deliberately stricter than `Number()`, which also accepts hexadecimal and binary literals,
 * exponents and "Infinity" (`0x10` is 16, `1e1` is 10): a field accepts exactly the syntax its
 * hint prints, including the thousands separator. Any decimal point makes the text a fraction,
 * "2.0" included, and it is never converted, so no rounding can turn "50.00000000000000001" into
 * 50. Digits too long for a double read as the largest double, which is reported as too large.
 */
export function readNumberText(text: string): NumberText {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { kind: 'empty' };
  }
  if (WHOLE_PATTERN.test(trimmed)) {
    const value = Number(trimmed.replaceAll(',', ''));
    return { kind: 'whole', value: Number.isFinite(value) ? value : Number.MAX_VALUE };
  }
  return FRACTION_PATTERN.test(trimmed) ? { kind: 'fraction' } : { kind: 'unreadable' };
}
