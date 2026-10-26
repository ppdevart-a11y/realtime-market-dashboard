import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form, validate } from '@angular/forms/signals';
import { NumberField } from './number-field';

@Component({
  imports: [NumberField],
  template: `<app-number-field [field]="sample.count" label="Count" hint="From 1 to 9." />`,
})
class Host {
  readonly model = signal<{ count: number | null }>({ count: 5 });
  readonly sample = form(this.model, (path) => {
    validate(path.count, ({ value }) =>
      value() === 7 ? { kind: 'seven', message: 'Seven is not allowed.' } : null,
    );
  });
}

async function render() {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const input = element.querySelector('input');
  if (input === null) {
    throw new Error('The field rendered no input');
  }
  const describedBy = () => (input.getAttribute('aria-describedby') ?? '').split(' ');
  const textOf = (id: string) => element.querySelector(`#${id}`)?.textContent.trim();
  const edit = async (text: string, { leave = false } = {}) => {
    input.value = text;
    input.dispatchEvent(new Event('input'));
    if (leave) {
      input.dispatchEvent(new Event('blur'));
    }
    await fixture.whenStable();
  };
  return { host: fixture.componentInstance, element, input, describedBy, textOf, edit };
}

describe('NumberField', () => {
  it('labels a numeric text input and always links its hint', async () => {
    const { element, input, describedBy, textOf } = await render();

    expect(element.querySelector('label')?.htmlFor).toBe(input.id);
    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('numeric');
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(input.value).toBe('5');
    expect(describedBy()).toHaveLength(1);
    expect(textOf(describedBy()[0])).toBe('From 1 to 9.');
  });

  it('flags an invalid value only once the field has been left', async () => {
    const { host, input, describedBy, textOf, edit } = await render();

    await edit('7');
    expect(host.model().count).toBe(7);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(describedBy()).toHaveLength(1);

    await edit('7', { leave: true });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy()).toHaveLength(2);
    expect(textOf(describedBy()[1])).toBe('Error: Seven is not allowed.');

    await edit('6');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(describedBy()).toHaveLength(1);
  });

  it('reports text that is not a number without changing the model', async () => {
    const { host, describedBy, textOf, edit } = await render();

    await edit('12a', { leave: true });

    expect(host.model().count).toBe(5);
    expect(textOf(describedBy()[1])).toBe('Error: Enter a number using digits only.');
  });

  it('reads empty text as no value', async () => {
    const { host, edit } = await render();

    await edit('');

    expect(host.model().count).toBeNull();
  });
});
