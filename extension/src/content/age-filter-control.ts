import { MAX_AGE_YEARS } from './birth-date';
import type { AgeFilter } from './types';

export type AgeFilterControl = {
  root: HTMLElement;
  setValue: (filter: AgeFilter | null) => void;
  setBusy: (busy: boolean) => void;
  setStatus: (text: string, kind?: 'info' | 'error') => void;
};

type CreateAgeFilterControlOptions = {
  /** Parsed window, or null when both bounds are empty / reset was pressed. */
  onApply: (filter: AgeFilter | null) => void;
};

export const AGE_FILTER_TEXT = {
  title: 'Вік',
  from: 'від',
  to: 'до',
  fromAria: 'Вік від (повних років)',
  toAria: 'Вік до (повних років, включно)',
  apply: 'Застосувати',
  reset: 'Скинути',
  hint:
    'Фото, де хоча б одна людина з відомою датою народження мала цей вік. Люди без дати народження не враховуються. «До 5» — включно з останнім днем у 5 років.',
  invalid: `Цілі роки 0–${MAX_AGE_YEARS}, «від» не більше за «до»`,
};

/** '' → null (open bound); anything that is not an integer in range → undefined (invalid). */
function parseBound(raw: string): number | null | undefined {
  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  const value = Number(trimmed);
  return value <= MAX_AGE_YEARS ? value : undefined;
}

function createBoundInput(ariaLabel: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'numeric';
  input.min = '0';
  input.max = String(MAX_AGE_YEARS);
  input.step = '1';
  input.className = 'immich-ext-age-filter__input';
  input.setAttribute('aria-label', ariaLabel);
  return input;
}

function createButton(label: string, extraClass = ''): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `immich-ext-age-filter__button ${extraClass}`.trim();
  button.textContent = label;
  return button;
}

/**
 * "Вік від … до …" with apply / reset. Applies only on Enter or the button (applying reloads the
 * page, so leaving a field must not trigger it).
 */
export function createAgeFilterControl({ onApply }: CreateAgeFilterControlOptions): AgeFilterControl {
  const root = document.createElement('div');
  root.className = 'immich-ext-age-filter';
  root.dataset.immichPeoplePlus = 'age-filter';
  root.title = AGE_FILTER_TEXT.hint;

  const title = document.createElement('span');
  title.className = 'immich-ext-age-filter__title';
  title.textContent = AGE_FILTER_TEXT.title;

  const fromLabel = document.createElement('span');
  fromLabel.className = 'immich-ext-age-filter__label';
  fromLabel.textContent = AGE_FILTER_TEXT.from;

  const fromInput = createBoundInput(AGE_FILTER_TEXT.fromAria);

  const toLabel = document.createElement('span');
  toLabel.className = 'immich-ext-age-filter__label';
  toLabel.textContent = AGE_FILTER_TEXT.to;

  const toInput = createBoundInput(AGE_FILTER_TEXT.toAria);

  const applyButton = createButton(AGE_FILTER_TEXT.apply, 'immich-ext-age-filter__button--primary');
  const resetButton = createButton(AGE_FILTER_TEXT.reset);
  resetButton.hidden = true;

  const status = document.createElement('span');
  status.className = 'immich-ext-age-filter__status';
  status.setAttribute('aria-live', 'polite');

  root.append(title, fromLabel, fromInput, toLabel, toInput, applyButton, resetButton, status);

  const setStatus = (text: string, kind: 'info' | 'error' = 'info'): void => {
    status.textContent = text;
    status.hidden = text.length === 0;
    status.classList.toggle('immich-ext-age-filter__status--error', kind === 'error');
  };

  setStatus('');

  const apply = (): void => {
    const from = parseBound(fromInput.value);
    const to = parseBound(toInput.value);

    if (from === undefined || to === undefined || (from !== null && to !== null && from > to)) {
      setStatus(AGE_FILTER_TEXT.invalid, 'error');
      return;
    }

    onApply(from === null && to === null ? null : { from, to });
  };

  for (const input of [fromInput, toInput]) {
    input.addEventListener('keydown', (event) => {
      // Keep Immich's global keyboard shortcuts away from the inputs.
      event.stopPropagation();

      if (event.key === 'Enter') {
        event.preventDefault();
        apply();
      }
    });
  }

  applyButton.addEventListener('click', (event) => {
    event.preventDefault();
    apply();
  });

  resetButton.addEventListener('click', (event) => {
    event.preventDefault();
    fromInput.value = '';
    toInput.value = '';
    onApply(null);
  });

  // Keep clicks away from the timeline's own handlers.
  root.addEventListener('click', (event) => event.stopPropagation());

  return {
    root,
    setValue(filter) {
      fromInput.value = filter?.from == null ? '' : String(filter.from);
      toInput.value = filter?.to == null ? '' : String(filter.to);
      resetButton.hidden = filter === null;
    },
    setBusy(busy) {
      root.classList.toggle('immich-ext-age-filter--busy', busy);

      for (const element of [fromInput, toInput, applyButton, resetButton]) {
        element.disabled = busy;
      }
    },
    setStatus,
  };
}
