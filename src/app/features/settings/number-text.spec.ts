import { readNumberText } from './number-text';

describe('readNumberText', () => {
  it.each([
    ['1000', 1_000],
    ['1,000', 1_000],
    [' 50 ', 50],
    ['12,345,678', 12_345_678],
    ['007', 7],
  ])('reads %j as the whole number %d', (text, value) => {
    expect(readNumberText(text)).toEqual({ kind: 'whole', value });
  });

  it.each(['', '   ', '\t'])('reads %j as empty', (text) => {
    expect(readNumberText(text)).toEqual({ kind: 'empty' });
  });

  it.each([
    '2.5',
    // A decimal point makes a fraction even when the decimals are zero.
    '2.0',
    '.5',
    '1,000.5',
    // A double would round this to exactly 50.
    '50.00000000000000001',
  ])('reads %j as a fraction', (text) => {
    expect(readNumberText(text)).toEqual({ kind: 'fraction' });
  });

  it.each([
    // Accepted by Number(), but not what the hints show.
    '0x10',
    '0b11',
    '0o7',
    '1e1',
    '.5e1',
    'Infinity',
    // Misplaced or foreign separators.
    '1,00',
    '10,0000',
    ',100',
    '1,,000',
    '1 000',
    '1_000',
    // Signs, units and stray characters.
    '-5',
    '+5',
    '5x',
    '50ms',
    '2.',
    '.',
  ])('rejects %j as unreadable', (text) => {
    expect(readNumberText(text)).toEqual({ kind: 'unreadable' });
  });

  it('reads digits beyond the range of a double as the largest double', () => {
    expect(readNumberText('9'.repeat(400))).toEqual({ kind: 'whole', value: Number.MAX_VALUE });
  });
});
