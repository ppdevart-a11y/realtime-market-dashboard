import { TestBed } from '@angular/core/testing';
import { ImbalanceMeter } from './imbalance-meter';

describe('ImbalanceMeter', () => {
  async function render(value: number | null) {
    const fixture = TestBed.createComponent(ImbalanceMeter);
    fixture.componentRef.setInput('value', value);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    return {
      askHeavy: host.classList.contains('ask-heavy'),
      extent: host.style.getPropertyValue('--imbalance'),
      hidden: host.getAttribute('aria-hidden'),
    };
  }

  it('extends towards the bid side for a bid-heavy book', async () => {
    expect(await render(0.2)).toEqual({ askHeavy: false, extent: '0.2', hidden: 'true' });
  });

  it('extends towards the ask side for an ask-heavy book', async () => {
    expect(await render(-0.35)).toEqual({ askHeavy: true, extent: '0.35', hidden: 'true' });
  });

  it('stays empty while the imbalance is unavailable', async () => {
    expect(await render(null)).toEqual({ askHeavy: false, extent: '0', hidden: 'true' });
  });
});
