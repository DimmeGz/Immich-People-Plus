import { fetchAllVisiblePeople } from './api';
import { assignPersonToOtherPhotos } from './folder-immich-api';
import { getPersonThumbnailUrl } from './render';
import type { FolderAsset, Person } from './types';

export type OpenTagOtherPhotosModalOptions = {
  otherAssets: FolderAsset[];
  onComplete: () => void | Promise<void>;
};

const MODAL_SELECTOR = '[data-immich-people-plus="tag-other-photos-modal"]';
const MAX_SEARCH_RESULTS = 30;

function closeModal(): void {
  document.querySelector(MODAL_SELECTOR)?.remove();
}

function filterPeopleByQuery(people: Person[], query: string): Person[] {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return people.slice(0, MAX_SEARCH_RESULTS);
  }

  return people
    .filter((person) => {
      const name = person.name.trim().toLowerCase();
      return name.includes(normalized);
    })
    .slice(0, MAX_SEARCH_RESULTS);
}

function formatPersonName(person: Person): string {
  return person.name.trim() || 'Unnamed';
}

export function openTagOtherPhotosModal(options: OpenTagOtherPhotosModalOptions): void {
  closeModal();

  const assetIds = options.otherAssets.map((asset) => asset.id);
  const photoCount = assetIds.length;

  if (photoCount === 0) {
    return;
  }

  let selectedPerson: Person | null = null;
  let allPeople: Person[] = [];
  let peopleLoaded = false;

  const overlay = document.createElement('div');
  overlay.className = 'immich-ext-person-card-modal';
  overlay.setAttribute('data-immich-people-plus', 'tag-other-photos-modal');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'immich-ext-tag-other-photos-title');

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'immich-ext-person-card-modal__backdrop';
  backdrop.setAttribute('aria-label', 'Close');
  backdrop.addEventListener('click', closeModal);

  const panel = document.createElement('div');
  panel.className = 'immich-ext-person-card-modal__panel';

  const header = document.createElement('div');
  header.className = 'immich-ext-person-card-modal__header';

  const title = document.createElement('h2');
  title.id = 'immich-ext-tag-other-photos-title';
  title.className = 'immich-ext-person-card-modal__title';
  title.textContent = 'Tag other photos';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'immich-ext-person-card__chip';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', closeModal);

  header.append(title, closeButton);

  const body = document.createElement('div');
  body.className = 'immich-ext-person-card-modal__body';

  const summary = document.createElement('p');
  summary.className = 'immich-ext-tag-other-photos__summary';
  summary.textContent = `${photoCount} photo${photoCount === 1 ? '' : 's'} in this folder have no detected faces.`;

  const searchLabel = document.createElement('span');
  searchLabel.className = 'immich-ext-person-card__label';
  searchLabel.textContent = 'Person';

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'immich-ext-person-card__input';
  searchInput.placeholder = 'Search by name';
  searchInput.setAttribute('aria-label', 'Search people');

  const results = document.createElement('div');
  results.className = 'immich-ext-tag-other-photos__results';
  results.setAttribute('role', 'listbox');
  results.setAttribute('aria-label', 'People search results');

  const selectedLabel = document.createElement('p');
  selectedLabel.className = 'immich-ext-tag-other-photos__selected';
  selectedLabel.hidden = true;

  const processButton = document.createElement('button');
  processButton.type = 'button';
  processButton.className = 'immich-ext-person-card__chip immich-ext-person-card__chip--primary';
  processButton.textContent = 'Process photos';
  processButton.disabled = true;

  const status = document.createElement('span');
  status.className = 'immich-ext-person-card__status';

  body.append(summary, searchLabel, searchInput, results, selectedLabel, processButton, status);
  panel.append(header, body);
  overlay.append(backdrop, panel);
  document.body.appendChild(overlay);

  searchInput.focus();

  const updateProcessButton = (): void => {
    processButton.disabled = !selectedPerson;
    processButton.textContent = selectedPerson
      ? `Process ${photoCount} photo${photoCount === 1 ? '' : 's'}`
      : 'Process photos';
  };

  const updateSelectedLabel = (): void => {
    if (!selectedPerson) {
      selectedLabel.hidden = true;
      return;
    }

    selectedLabel.hidden = false;
    selectedLabel.textContent = `Selected: ${formatPersonName(selectedPerson)}`;
  };

  const renderResults = (): void => {
    results.replaceChildren();

    if (!peopleLoaded) {
      const loading = document.createElement('p');
      loading.className = 'immich-ext-tag-other-photos__hint';
      loading.textContent = 'Loading people…';
      results.appendChild(loading);
      return;
    }

    const matches = filterPeopleByQuery(allPeople, searchInput.value);

    if (matches.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'immich-ext-tag-other-photos__hint';
      empty.textContent = 'No people match your search.';
      results.appendChild(empty);
      return;
    }

    for (const person of matches) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'immich-ext-tag-other-photos__option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(selectedPerson?.id === person.id));

      if (selectedPerson?.id === person.id) {
        option.classList.add('immich-ext-tag-other-photos__option--selected');
      }

      const avatar = document.createElement('img');
      avatar.className = 'immich-ext-tag-other-photos__avatar';
      avatar.src = getPersonThumbnailUrl(person);
      avatar.alt = '';
      avatar.loading = 'lazy';
      avatar.draggable = false;

      const name = document.createElement('span');
      name.className = 'immich-ext-tag-other-photos__name';
      name.textContent = formatPersonName(person);

      option.append(avatar, name);
      option.addEventListener('click', () => {
        selectedPerson = person;
        updateSelectedLabel();
        updateProcessButton();
        renderResults();
      });

      results.appendChild(option);
    }
  };

  void (async () => {
    try {
      allPeople = await fetchAllVisiblePeople();
      peopleLoaded = true;
      renderResults();
    } catch (error) {
      console.error('[Immich People Plus] Failed to load people for tag-other-photos:', error);
      status.textContent = 'Could not load people list.';
      searchInput.disabled = true;
      processButton.disabled = true;
    }
  })();

  searchInput.addEventListener('input', renderResults);

  processButton.addEventListener('click', () => {
    if (!selectedPerson) {
      return;
    }

    const person = selectedPerson;
    const confirmed = window.confirm(
      `Assign "${formatPersonName(person)}" to ${photoCount} photo${photoCount === 1 ? '' : 's'} without detected faces in this folder?`,
    );

    if (!confirmed) {
      return;
    }

    searchInput.disabled = true;
    processButton.disabled = true;
    closeButton.disabled = true;
    backdrop.disabled = true;

    void (async () => {
      try {
        const { succeeded, failed } = await assignPersonToOtherPhotos(person.id, assetIds, (done, total) => {
          status.textContent = `Processing ${done}/${total}…`;
        });

        if (failed === 0) {
          status.textContent = `Done. ${succeeded} photo${succeeded === 1 ? '' : 's'} updated.`;
        } else {
          status.textContent = `Done. ${succeeded} updated, ${failed} failed.`;
        }

        await options.onComplete();
        window.setTimeout(closeModal, failed === 0 ? 600 : 2500);
      } catch (error) {
        console.error('[Immich People Plus] Failed to tag other photos:', error);
        status.textContent = 'Failed to assign person to photos.';
        searchInput.disabled = false;
        processButton.disabled = false;
        closeButton.disabled = false;
        backdrop.disabled = false;
        updateProcessButton();
      }
    })();
  });

  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
    }
  });
}
