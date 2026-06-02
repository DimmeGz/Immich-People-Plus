import type { PeopleSortMode, Person } from './types';

export function comparePeopleByName(a: Person, b: Person, order: 'asc' | 'desc'): number {
  const aName = a.name.trim();
  const bName = b.name.trim();
  const aEmpty = aName.length === 0;
  const bEmpty = bName.length === 0;

  if (aEmpty && bEmpty) {
    return 0;
  }

  if (aEmpty) {
    return 1;
  }

  if (bEmpty) {
    return -1;
  }

  const comparison = aName.localeCompare(bName, undefined, { sensitivity: 'base' });
  return order === 'asc' ? comparison : -comparison;
}

export function sortPeopleByName(people: Person[], order: 'asc' | 'desc'): Person[] {
  return [...people].sort((a, b) => comparePeopleByName(a, b, order));
}

export function sortModeToOrder(mode: PeopleSortMode): 'asc' | 'desc' | null {
  if (mode === 'name-asc') {
    return 'asc';
  }

  if (mode === 'name-desc') {
    return 'desc';
  }

  return null;
}

export function getPersonIdFromElement(element: Element): string | null {
  const link = element.querySelector('a[href^="/people/"]');

  if (!link) {
    return null;
  }

  const href = link.getAttribute('href') ?? '';
  const match = href.match(/^\/people\/([^/?#]+)(?:\?.*)?$/);

  return match?.[1] ?? null;
}

export function getNameFromCard(element: Element): string {
  const input = element.querySelector('input[type="text"]');

  if (input instanceof HTMLInputElement) {
    return input.value.trim();
  }

  const nameElement = element.querySelector('[data-immich-extension="person-name"]');

  if (nameElement?.textContent) {
    return nameElement.textContent.trim();
  }

  const image = element.querySelector('img[alt]');
  return image?.getAttribute('alt')?.trim() ?? '';
}

export function compareCardNames(a: Element, b: Element, order: 'asc' | 'desc'): number {
  return comparePeopleByName(
    { id: '', name: getNameFromCard(a), isHidden: false },
    { id: '', name: getNameFromCard(b), isHidden: false },
    order,
  );
}

export function getGridPersonIds(): string[] {
  const header = document.getElementById('user-page-header');

  if (!header) {
    return [];
  }

  const main = header.closest('main');
  const grid = main?.querySelector('.grid.grid-cols-2:not([data-immich-extension="sorted-people-grid"])');

  if (!grid) {
    return [];
  }

  return [...grid.children]
    .map((child) => getPersonIdFromElement(child))
    .filter((personId): personId is string => personId !== null);
}

export function idsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function reorderGridFromDom(order: 'asc' | 'desc'): boolean {
  const header = document.getElementById('user-page-header');

  if (!header) {
    return false;
  }

  const main = header.closest('main');
  const grid = main?.querySelector('.grid.grid-cols-2:not([data-immich-extension="sorted-people-grid"])');

  if (!grid) {
    return false;
  }

  const cards = [...grid.children].filter((child) => getPersonIdFromElement(child));
  cards.sort((a, b) => compareCardNames(a, b, order));

  const sortedIds = cards
    .map((card) => getPersonIdFromElement(card))
    .filter((personId): personId is string => personId !== null);

  if (idsEqual(getGridPersonIds(), sortedIds)) {
    return false;
  }

  for (const card of cards) {
    grid.appendChild(card);
  }

  return true;
}
