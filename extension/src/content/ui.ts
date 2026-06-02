import type { PeopleSortMode, PersonTag } from './types';

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
  root.dataset.immichPeoplePlus = 'people-sort';

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

export type TagFilterControl = {
  root: HTMLElement;
  select: HTMLSelectElement;
  setTags: (tags: PersonTag[]) => void;
  setValue: (tagId: string | null) => void;
  setBusy: (busy: boolean, message?: string) => void;
  onChange: (handler: (tagId: string | null) => void) => void;
};

const TAG_FILTER_ALL = '';

export function createTagFilterControl(initialTagId: string | null): TagFilterControl {
  const root = document.createElement('div');
  root.className = 'immich-ext-people-sort';
  root.dataset.immichPeoplePlus = 'people-tag-filter';

  const label = document.createElement('span');
  label.className = 'immich-ext-people-sort__label';
  label.textContent = 'Tag';

  const select = document.createElement('select');
  select.className = 'immich-ext-people-sort__select immich-ext-people-sort__select--tag';
  select.setAttribute('aria-label', 'Filter people by tag');

  const status = document.createElement('span');
  status.className = 'immich-ext-people-sort__status';
  status.hidden = true;

  root.append(label, select, status);

  function rebuildOptions(tags: PersonTag[]): void {
    const selected = select.value;
    select.replaceChildren();

    const allOption = document.createElement('option');
    allOption.value = TAG_FILTER_ALL;
    allOption.textContent = 'All tags';
    select.appendChild(allOption);

    for (const tag of tags) {
      const option = document.createElement('option');
      option.value = tag.id;
      option.textContent = tag.name;
      select.appendChild(option);
    }

    const hasSelected = selected === TAG_FILTER_ALL || tags.some((tag) => tag.id === selected);
    select.value = hasSelected ? selected : TAG_FILTER_ALL;
  }

  rebuildOptions([]);
  select.value = initialTagId ?? TAG_FILTER_ALL;

  return {
    root,
    select,
    setTags(tags) {
      rebuildOptions(tags);
    },
    setValue(tagId) {
      select.value = tagId ?? TAG_FILTER_ALL;
    },
    setBusy(busy, message) {
      select.disabled = busy;
      status.hidden = !busy;
      status.textContent = message ?? 'Filtering…';
    },
    onChange(handler) {
      select.addEventListener('change', () => {
        const value = select.value;
        handler(value === TAG_FILTER_ALL ? null : value);
      });
    },
  };
}

function mountToolbarControl(controlRoot: HTMLElement): void {
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
    actions.prepend(controlRoot);
    return;
  }

  toolbar.appendChild(controlRoot);
}

export function mountPeopleToolbarControls(controls: HTMLElement[]): void {
  for (const control of controls) {
    mountToolbarControl(control);
  }
}

export function mountSortControl(control: SortControl): void {
  mountPeopleToolbarControls([control.root]);
}

export function unmountSortControl(control: SortControl): void {
  control.root.remove();
}

export function unmountTagFilterControl(control: TagFilterControl): void {
  control.root.remove();
}
