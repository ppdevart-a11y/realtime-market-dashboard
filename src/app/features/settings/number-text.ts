/** What a settings field's text says, before any range rule is applied. */
export type NumberText =
  | { readonly kind: 'empty' }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'unreadable' };

/**
 * Digits, either ungrouped or grouped in thousands with commas after a first group of one to
 * three digits ("1,000", "12,345"), optionally followed by a decimal part; or a bare decimal part.
 */
const NUMBER_PATTERN = /^(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)$/;

/**
 * Reads a number as people type it into a settings field, ignoring surrounding whitespace.
 *
 * Deliberately stricter than `Number()`, which also accepts hexadecimal and binary literals,
 * exponents and "Infinity" (`0x10` is 16, `1e1` is 10): a field accepts exactly the syntax its
 * hint prints, including the thousands separator. A decimal part is read rather than rejected, so
 * the range rules can report a fraction as such. Digits too long for a double read as the largest
 * double, so they are reported as too large rather than as not a number.
 */
export function readNumberText(text: string): NumberText {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { kind: 'empty' };
  }
  if (!NUMBER_PATTERN.test(trimmed)) {
    return { kind: 'unreadable' };
  }
  const value = Number(trimmed.replaceAll(',', ''));
  return { kind: 'number', value: Number.isFinite(value) ? value : Number.MAX_VALUE };
}
