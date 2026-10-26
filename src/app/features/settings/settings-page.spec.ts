import { TestBed } from '@angular/core/testing';
import { NEVER } from 'rxjs';
import type { ProducerCommand } from '../../domain/producer-protocol';
import { DEFAULT_PRODUCER_SETTINGS, type ProducerSettings } from '../../domain/producer-settings';
import { MarketDataStore } from '../../market-data/market-data.store';
import {
  PRODUCER_TRANSPORT_FACTORY,
  type ProducerTransport,
} from '../../market-data/producer-transport';
import { SettingsPage } from './settings-page';

type Label = 'Instrument count' | 'Updates per batch' | 'Batch interval';

const smallRun: ProducerSettings = {
  instrumentCount: 2,
  updatesPerBatch: 10,
  batchIntervalMs: 100,
};
const UNREADABLE = 'Enter a whole number using digits, such as 500 or 1,000.';

/**
 * Renders the page against the real store on a producer that records commands, after an optional
 * `before` step that shapes the active run (the page reads it on entry).
 */
async function render(before: (store: MarketDataStore) => void = () => undefined) {
  const sent: ProducerCommand[] = [];
  const transport: ProducerTransport = {
    events$: NEVER,
    send: (command) => sent.push(command),
    dispose: () => undefined,
  };
  TestBed.configureTestingModule({
    providers: [{ provide: PRODUCER_TRANSPORT_FACTORY, useValue: () => transport }],
  });
  const store = TestBed.inject(MarketDataStore);
  store.start();
  before(store);

  const fixture = TestBed.createComponent(SettingsPage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;

  const input = (label: Label): HTMLInputElement => {
    const forId = [...element.querySelectorAll('label')].find(
      (candidate) => candidate.textContent.trim() === label,
    )?.htmlFor;
    const found = forId === undefined ? null : element.querySelector<HTMLInputElement>(`#${forId}`);
    if (found === null) {
      throw new Error(`No input is labelled "${label}"`);
    }
    return found;
  };
  /** The field's error as announced: the description that follows its hint, if any. */
  const errorOf = (label: Label): string | null => {
    const errorId = input(label).getAttribute('aria-describedby')?.split(' ')[1];
    return errorId === undefined
      ? null
      : (element.querySelector(`#${errorId}`)?.textContent.trim() ?? null);
  };
  const enter = async (label: Label, text: string, { leave = true } = {}) => {
    const field = input(label);
    field.value = text;
    field.dispatchEvent(new Event('input'));
    if (leave) {
      field.dispatchEvent(new Event('blur'));
    }
    await fixture.whenStable();
  };
  const press = async (name: string) => {
    const button = [...element.querySelectorAll('button')].find(
      (candidate) => candidate.textContent.trim() === name,
    );
    if (button === undefined) {
      throw new Error(`No button is named "${name}"`);
    }
    button.click();
    await fixture.whenStable();
  };
  const values = () =>
    (['Instrument count', 'Updates per batch', 'Batch interval'] as const).map(
      (label) => input(label).value,
    );
  const pageText = () => element.textContent.replace(/\s+/g, ' ');
  const confirmation = () => element.querySelector('[role="status"]')?.textContent.trim();

  return { store, sent, input, errorOf, enter, press, values, pageText, confirmation };
}

describe('SettingsPage', () => {
  it('opens with the active run’s settings and no unsaved changes', async () => {
    const page = await render((store) => {
      store.apply(smallRun);
    });

    expect(page.values()).toEqual(['2', '10', '100']);
    expect(page.pageText()).not.toContain('Unsaved changes');
  });

  it('states each allowed range in the field hints', async () => {
    const page = await render();

    expect(page.pageText()).toContain('Whole number from 1 to 50.');
    expect(page.pageText()).toContain('Whole number from 1 to 1,000, shared by all instruments.');
    expect(page.pageText()).toContain('Whole number of milliseconds from 50 to 2,000.');
  });

  it.each<[Label, string, string]>([
    ['Instrument count', '', 'Enter a value.'],
    ['Instrument count', '2.5', 'Enter a whole number.'],
    ['Instrument count', 'five', UNREADABLE],
    ['Instrument count', '0x10', UNREADABLE],
    ['Instrument count', '0b11', UNREADABLE],
    ['Instrument count', '1e1', UNREADABLE],
    ['Instrument count', '.5e1', UNREADABLE],
    ['Instrument count', '-5', UNREADABLE],
    ['Updates per batch', '1,00', UNREADABLE],
    ['Instrument count', '0', 'Enter 1 or more.'],
    ['Instrument count', '51', 'Enter 50 or less.'],
    ['Updates per batch', '1001', 'Enter 1,000 or less.'],
    ['Batch interval', '49', 'Enter 50 or more.'],
  ])('rejects %s "%s" with "%s"', async (label, text, message) => {
    const page = await render();

    await page.enter(label, text);

    expect(page.errorOf(label)).toBe(`Error: ${message}`);
    expect(page.input(label).getAttribute('aria-invalid')).toBe('true');
  });

  it.each<[Label, string]>([
    ['Instrument count', '1'],
    ['Instrument count', '50'],
    ['Updates per batch', '1'],
    ['Updates per batch', '1000'],
    ['Batch interval', '50'],
    ['Batch interval', '2000'],
    // The thousands separator the hints print, and surrounding whitespace.
    ['Updates per batch', '1,000'],
    ['Batch interval', ' 2,000 '],
    ['Instrument count', ' 50 '],
  ])('accepts %s as "%s"', async (label, text) => {
    const page = await render();

    await page.enter(label, text);

    expect(page.errorOf(label)).toBeNull();
    expect(page.input(label).hasAttribute('aria-invalid')).toBe(false);
  });

  it('keeps edits away from the producer until they are applied', async () => {
    const page = await render();

    await page.enter('Instrument count', '7');
    await page.enter('Batch interval', '1000');

    expect(page.store.settings()).toEqual(DEFAULT_PRODUCER_SETTINGS);
    expect(page.store.runId()).toBe(1);
    expect(page.sent).toEqual([{ type: 'start', runId: 1, settings: DEFAULT_PRODUCER_SETTINGS }]);
  });

  it('applies valid settings as a new run and confirms it politely', async () => {
    const page = await render();
    expect(page.confirmation()).toBe('');

    await page.enter('Instrument count', '2');
    await page.enter('Updates per batch', '10');
    await page.enter('Batch interval', '100');
    await page.press('Apply settings');

    expect(page.store.runId()).toBe(2);
    expect(page.store.settings()).toEqual(smallRun);
    expect(page.store.instruments().map((row) => row.volume)).toEqual([0, 0]);
    expect(page.sent.at(-1)).toEqual({ type: 'start', runId: 2, settings: smallRun });
    expect(page.confirmation()).toBe('Settings applied. Run 2 is starting.');
    expect(page.pageText()).not.toContain('Unsaved changes');

    // Applying starts a fresh edit: errors wait until a field is left again.
    await page.enter('Instrument count', '0', { leave: false });
    expect(page.errorOf('Instrument count')).toBeNull();
  });

  it('restarts a paused producer when applied, even without changes', async () => {
    const page = await render((store) => {
      store.pause();
    });

    await page.press('Apply settings');

    expect(page.store.runId()).toBe(2);
    expect(page.store.status()).toEqual({ kind: 'starting', paused: false });
    expect(page.sent.at(-1)).toEqual({
      type: 'start',
      runId: 2,
      settings: DEFAULT_PRODUCER_SETTINGS,
    });
  });

  it('applies numbers typed with separators and spaces, then shows them as the hints do', async () => {
    const page = await render();

    await page.enter('Updates per batch', ' 1,000 ');
    await page.enter('Batch interval', '2000');
    await page.press('Apply settings');

    expect(page.store.settings()).toEqual({
      instrumentCount: 5,
      updatesPerBatch: 1_000,
      batchIntervalMs: 2_000,
    });
    expect(page.values()).toEqual(['5', '1,000', '2,000']);
  });

  it.each(['0x10', '1e1', '.5e1'])(
    'never applies %j, which Number() would read as a number',
    async (text) => {
      const page = await render();

      await page.enter('Instrument count', text);
      await page.press('Apply settings');

      expect(page.errorOf('Instrument count')).toBe(`Error: ${UNREADABLE}`);
      expect(page.store.runId()).toBe(1);
      expect(page.store.settings()).toEqual(DEFAULT_PRODUCER_SETTINGS);
      expect(page.sent).toEqual([{ type: 'start', runId: 1, settings: DEFAULT_PRODUCER_SETTINGS }]);
    },
  );

  it('on an invalid submit, reveals every error, focuses the first one and sends nothing', async () => {
    const page = await render();
    await page.enter('Updates per batch', '0', { leave: false });
    await page.enter('Batch interval', '', { leave: false });
    expect(page.errorOf('Updates per batch')).toBeNull();

    await page.press('Apply settings');

    expect(page.errorOf('Updates per batch')).toBe('Error: Enter 1 or more.');
    expect(page.errorOf('Batch interval')).toBe('Error: Enter a value.');
    expect(document.activeElement).toBe(page.input('Updates per batch'));
    expect(page.store.runId()).toBe(1);
    expect(page.sent).toHaveLength(1);
    expect(page.confirmation()).toBe('');
  });

  it('resets the form to the defaults without applying them', async () => {
    const page = await render((store) => {
      store.apply(smallRun);
    });
    await page.enter('Instrument count', 'oops');

    await page.press('Reset to defaults');

    expect(page.values()).toEqual(['5', '100', '500']);
    expect(page.errorOf('Instrument count')).toBeNull();
    expect(page.store.settings()).toEqual(smallRun);
    expect(page.sent.at(-1)).toEqual({ type: 'start', runId: 2, settings: smallRun });
    expect(page.pageText()).toContain('Unsaved changes');
  });

  it('marks unsaved changes, including unreadable text, until the draft matches the run again', async () => {
    const page = await render();

    await page.enter('Instrument count', '6');
    expect(page.pageText()).toContain('Unsaved changes');

    await page.enter('Instrument count', ' 5 ');
    expect(page.pageText()).not.toContain('Unsaved changes');

    await page.enter('Instrument count', '5x');
    expect(page.pageText()).toContain('Unsaved changes');
  });

  it('previews the nominal rate across all instruments, and stays neutral while invalid', async () => {
    const page = await render();
    expect(page.pageText()).toContain(
      '100 updates every 500 ms is 200 updates per second across all instruments.',
    );

    await page.enter('Updates per batch', '1');
    await page.enter('Batch interval', '2000');
    expect(page.pageText()).toContain(
      '1 update every 2,000 ms is 0.5 updates per second across all instruments.',
    );

    await page.enter('Batch interval', '20');
    expect(page.pageText()).toContain('The resulting rate appears here once every value is valid.');

    await page.enter('Batch interval', '2000');
    await page.enter('Batch interval', '2s');
    expect(page.pageText()).not.toContain('per second across all instruments');
  });
});
