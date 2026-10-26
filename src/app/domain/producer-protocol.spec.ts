import { isProducerCommand } from './producer-protocol';
import { DEFAULT_PRODUCER_SETTINGS } from './producer-settings';

describe('isProducerCommand', () => {
  it('accepts every well-formed command', () => {
    expect(
      isProducerCommand({ type: 'start', runId: 1, settings: DEFAULT_PRODUCER_SETTINGS }),
    ).toBe(true);
    expect(isProducerCommand({ type: 'pause', runId: 2 })).toBe(true);
    expect(isProducerCommand({ type: 'resume', runId: 3 })).toBe(true);
  });

  it.each([
    ['a primitive', 'start'],
    ['an unknown type', { type: 'stop', runId: 1 }],
    ['a missing run id', { type: 'pause' }],
    ['a fractional run id', { type: 'pause', runId: 1.5 }],
    ['run id zero', { type: 'pause', runId: 0 }],
    ['a start without settings', { type: 'start', runId: 1 }],
    [
      'a start with invalid settings',
      { type: 'start', runId: 1, settings: { ...DEFAULT_PRODUCER_SETTINGS, instrumentCount: 51 } },
    ],
  ])('rejects %s', (_, value) => {
    expect(isProducerCommand(value)).toBe(false);
  });
});
