import { TestBed } from '@angular/core/testing';
import type { InstrumentRow } from '../../market-data/market-data.store';
import { MarketTable } from './market-table';

const unavailableRow: InstrumentRow = {
  symbol: 'ALFA',
  lastPriceCents: null,
  lastTick: null,
  spreadCents: null,
  volume: 0,
  vwapCents: null,
  imbalance: null,
};

const tradedRow: InstrumentRow = {
  symbol: 'BETA',
  lastPriceCents: 10_200,
  lastTick: 'up',
  spreadCents: 4,
  volume: 40,
  vwapCents: 10_150,
  imbalance: 0.2,
};

async function render(rows: readonly InstrumentRow[]) {
  const fixture = TestBed.createComponent(MarketTable);
  fixture.componentRef.setInput('rows', rows);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  // Text as assistive technology reads it: decorative (aria-hidden) glyphs removed.
  const cells = (rowIndex: number) =>
    [...element.querySelectorAll('tbody tr')[rowIndex].querySelectorAll('th, td')].map((cell) => {
      const accessible = cell.cloneNode(true) as HTMLElement;
      accessible.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => {
        hidden.remove();
      });
      return accessible.textContent.replace(/\s+/g, ' ').trim();
    });
  return { fixture, element, cells };
}

describe('MarketTable', () => {
  it('labels every column and identifies each row by its symbol', async () => {
    const { element } = await render([unavailableRow]);

    expect(
      [...element.querySelectorAll('thead th')].map((header) => header.textContent.trim()),
    ).toEqual(['Symbol', 'Last price', 'Spread', 'Volume', 'VWAP', 'Order-book imbalance']);
    expect(element.querySelector('tbody th')?.getAttribute('scope')).toBe('row');
    expect(element.querySelector('caption')?.textContent.trim()).toBe(
      'Live metrics per instrument',
    );
  });

  it('shows unavailable values, announced as such, and zero volume before data', async () => {
    const { cells, element } = await render([unavailableRow]);

    expect(element.querySelectorAll('.unavailable')).toHaveLength(4);
    expect(cells(0)).toEqual([
      'ALFA',
      'Not available',
      'Not available',
      '0',
      'Not available',
      'Not available',
    ]);
  });

  it('formats prices as currency, volume with grouping and imbalance with a sign', async () => {
    const { cells } = await render([{ ...tradedRow, volume: 1_234_567 }]);

    expect(cells(0)).toEqual(['BETA', 'Up $102.00', '$0.04', '1,234,567', '$101.50', '+0.20']);
  });

  it('marks a falling price with an arrow and text, not colour alone', async () => {
    const { cells, element } = await render([{ ...tradedRow, lastTick: 'down', imbalance: -0.35 }]);

    expect(cells(0)[1]).toBe('Down $102.00');
    expect(element.querySelector('.tick')?.textContent).toBe('▼');
    expect(cells(0)[5]).toBe('−0.35');
  });

  it('keeps the scrollable region reachable and named for keyboard users', async () => {
    const { element } = await render([tradedRow]);
    const region = element.querySelector('[role="region"]');

    expect(region?.getAttribute('tabindex')).toBe('0');
    expect(region?.getAttribute('aria-labelledby')).toBe('market-table-caption');
  });

  it('reuses row elements across updates, tracked by symbol', async () => {
    const { fixture, element } = await render([unavailableRow, tradedRow]);
    const before = element.querySelectorAll('tbody tr')[1];

    fixture.componentRef.setInput('rows', [unavailableRow, { ...tradedRow, volume: 41 }]);
    await fixture.whenStable();

    expect(element.querySelectorAll('tbody tr')[1]).toBe(before);
    expect(before.querySelectorAll('td')[2].textContent.trim()).toBe('41');
  });
});
