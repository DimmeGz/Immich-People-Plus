import type { Person } from './types';

export function getPersonThumbnailUrl(person: Person): string {
  const params = new URLSearchParams();

  if (person.updatedAt) {
    params.set('updatedAt', person.updatedAt);
  }

  const query = params.toString();
  return `/api/people/${person.id}/thumbnail${query ? `?${query}` : ''}`;
}

function createPersonCard(person: Person): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className =
    'rounded-xl border-2 border-transparent p-2 transition-all hover:border-immich-primary/50 hover:bg-gray-200 hover:shadow-sm hover:dark:border-immich-dark-primary/25 dark:hover:bg-immich-dark-primary/20';
  wrapper.dataset.immichExtension = 'person-card';

  const card = document.createElement('div');
  card.className = 'relative';

  const link = document.createElement('a');
  link.href = `/people/${person.id}?previousRoute=${encodeURIComponent('/people')}`;
  link.draggable = false;
  link.className = 'block w-full';

  const imageWrap = document.createElement('div');
  imageWrap.className = 'w-full rounded-xl brightness-95 filter';

  const image = document.createElement('img');
  image.src = getPersonThumbnailUrl(person);
  image.alt = person.name;
  image.title = person.name;
  image.loading = 'lazy';
  image.draggable = false;
  image.className =
    'aspect-square w-full rounded-full bg-gray-300 object-cover shadow-lg transition-shadow duration-150 dark:bg-gray-700';

  imageWrap.appendChild(image);
  link.appendChild(imageWrap);
  card.appendChild(link);
  wrapper.appendChild(card);

  const name = document.createElement('input');
  name.type = 'text';
  name.readOnly = true;
  name.tabIndex = -1;
  name.value = person.name.trim();
  name.className =
    'mt-2 w-full rounded-2xl border-gray-100 bg-white py-2 text-center text-sm text-primary placeholder-gray-400 dark:border-gray-900 dark:bg-immich-dark-gray';

  wrapper.appendChild(name);

  return wrapper;
}

export function renderSortedGrid(people: Person[]): HTMLElement {
  const grid = document.createElement('div');
  grid.className =
    'grid w-full grid-cols-2 items-start gap-1 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-10';
  grid.dataset.immichExtension = 'sorted-people-grid';

  for (const person of people) {
    grid.appendChild(createPersonCard(person));
  }

  return grid;
}

export function removeExtensionGrid(): void {
  document.querySelector('[data-immich-extension="sorted-people-grid"]')?.remove();
}

export function setOriginalGridHidden(hidden: boolean): void {
  const grid = getPeopleGrid();

  if (grid) {
    grid.hidden = hidden;
  }
}

export function mountExtensionGrid(grid: HTMLElement): void {
  const originalGrid = getPeopleGrid();

  if (!originalGrid?.parentElement) {
    return;
  }

  removeExtensionGrid();
  originalGrid.parentElement.appendChild(grid);
}

export function getPeopleGrid(): HTMLElement | null {
  const header = document.getElementById('user-page-header');

  if (!header) {
    return null;
  }

  const main = header.closest('main');
  return main?.querySelector('.grid.grid-cols-2:not([data-immich-extension="sorted-people-grid"])') ?? null;
}

export function getScrollContainer(): HTMLElement | null {
  const header = document.getElementById('user-page-header');

  if (!header) {
    return null;
  }

  const main = header.closest('main');
  return main?.querySelector('.overflow-y-auto') ?? null;
}
