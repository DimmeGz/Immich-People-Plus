import type { PeopleSortMode } from './types';

export type SortControl = {
  root: HTMLElement;
  select: HTMLSelectElement;
  status: HTMLElement;
  setMode: (mode: PeopleSortMode) => void;
  setBusy: (busy: boolean, message?: string) => void;
  onChange: (handler: (mode: PeopleSortMode) => void) => void;
};

const SORT_OPTIONS: Array<{ value: PeopleSortMode; label: string }> = [
  { value: 'standard', label: 'Default' },
  { value: 'name-asc', label: 'Name A→Z' },
  { value: 'name-desc', label: 'Name Z→A' },
];

export function createSortControl(initialMode: PeopleSortMode): SortControl {
  const root = document.createElement('div');
  root.className = 'immich-ext-people-sort';
  root.dataset.immichExtension = 'people-sort';

  const label = document.createElement('span');
  label.className = 'immich-ext-people-sort__label';
  label.textContent = 'Sort';

  const select = document.createElement('select');
  select.className = 'immich-ext-people-sort__select';
  select.setAttribute('aria-label', 'Sort people');

  for (const option of SORT_OPTIONS) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    select.appendChild(element);
  }

  select.value = initialMode;

  const status = document.createElement('span');
  status.className = 'immich-ext-people-sort__status';
  status.hidden = true;

  root.append(label, select, status);

  return {
    root,
    select,
    status,
    setMode(mode) {
      select.value = mode;
    },
    setBusy(busy, message) {
      select.disabled = busy;
      status.hidden = !busy;
      status.textContent = message ?? 'Sorting…';
    },
    onChange(handler) {
      select.addEventListener('change', () => {
        handler(select.value as PeopleSortMode);
      });
    },
  };
}

export function mountSortControl(control: SortControl): void {
  const header = document.getElementById('user-page-header');

  if (!header) {
    return;
  }

  const toolbar = header.parentElement;

  if (!toolbar) {
    return;
  }

  const actions = toolbar.querySelector('.flex.items-center.justify-center.gap-2');

  if (actions instanceof HTMLElement) {
    actions.prepend(control.root);
    return;
  }

  toolbar.appendChild(control.root);
}

export function unmountSortControl(control: SortControl): void {
  control.root.remove();
}
