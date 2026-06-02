import { getPersonThumbnailUrl } from './render';
import type { FolderFilter, FolderPersonSummary } from './types';

export type FolderFilterBar = {
  root: HTMLElement;
  setFilter: (filter: FolderFilter) => void;
  setBusy: (busy: boolean) => void;
  setVisible: (visible: boolean) => void;
};

type CreateFolderFilterBarOptions = {
  people: FolderPersonSummary[];
  otherPhotosCount: number;
  tags?: Array<{ id: string; name: string; count: number }>;
  onFilterChange: (filter: FolderFilter) => void;
  onTagOtherPhotos?: () => void;
};

function createChipButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'immich-ext-folder-filter__chip';
  button.title = title;
  button.textContent = label;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function createPersonChip(summary: FolderPersonSummary, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'immich-ext-folder-filter__chip immich-ext-folder-filter__chip--person';
  button.dataset.personId = summary.person.id;
  button.title = summary.person.name || 'Unnamed';

  const avatar = document.createElement('img');
  avatar.className = 'immich-ext-folder-filter__avatar';
  avatar.src = getPersonThumbnailUrl(summary.person);
  avatar.alt = summary.person.name;
  avatar.loading = 'lazy';
  avatar.draggable = false;

  const label = document.createElement('span');
  label.className = 'immich-ext-folder-filter__chip-label';
  const name = summary.person.name.trim() || 'Unnamed';
  label.textContent = `${name} (${summary.assetCount})`;

  button.append(avatar, label);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });

  return button;
}

export function createFolderFilterBar({
  people,
  otherPhotosCount,
  tags = [],
  onFilterChange,
  onTagOtherPhotos,
}: CreateFolderFilterBarOptions): FolderFilterBar {
  const root = document.createElement('div');
  root.className = 'immich-ext-folder-filter';
  root.dataset.immichPeoplePlus = 'folder-filter';

  const label = document.createElement('span');
  label.className = 'immich-ext-folder-filter__title';
  label.textContent = 'People';

  const chips = document.createElement('div');
  chips.className = 'immich-ext-folder-filter__chips';

  const showAllButton = createChipButton('Show all', 'Show all photos in this folder', () => {
    onFilterChange({ type: 'all' });
  });
  showAllButton.dataset.filter = 'all';
  showAllButton.hidden = true;
  chips.appendChild(showAllButton);

  for (const summary of people) {
    chips.appendChild(
      createPersonChip(summary, () => {
        onFilterChange({ type: 'person', personId: summary.person.id });
      }),
    );
  }

  if (otherPhotosCount > 0) {
    const othersButton = createChipButton(
      `Other photos (${otherPhotosCount})`,
      'Photos without assigned people',
      () => {
        onFilterChange({ type: 'others' });
      },
    );
    othersButton.dataset.filter = 'others';
    chips.appendChild(othersButton);

    if (onTagOtherPhotos) {
      const tagOthersButton = createChipButton(
        'Tag other photos',
        'Assign a person to all photos without detected faces in this folder',
        onTagOtherPhotos,
      );
      tagOthersButton.dataset.action = 'tag-other-photos';
      tagOthersButton.classList.add('immich-ext-folder-filter__chip--action');
      chips.appendChild(tagOthersButton);
    }
  }

  for (const tag of tags) {
    const tagButton = createChipButton(
      `${tag.name} (${tag.count})`,
      `Photos tagged with ${tag.name}`,
      () => {
        onFilterChange({ type: 'tag', tagId: tag.id });
      },
    );
    tagButton.dataset.filter = `tag:${tag.id}`;
    chips.appendChild(tagButton);
  }

  root.append(label, chips);

  const setActiveChip = (filter: FolderFilter) => {
    for (const chip of chips.querySelectorAll<HTMLButtonElement>('.immich-ext-folder-filter__chip')) {
      chip.classList.remove('immich-ext-folder-filter__chip--active');
    }

    showAllButton.hidden = filter.type === 'all';

    if (filter.type === 'person') {
      chips.querySelector<HTMLButtonElement>(`[data-person-id="${filter.personId}"]`)?.classList.add(
        'immich-ext-folder-filter__chip--active',
      );
      return;
    }

    if (filter.type === 'others') {
      chips.querySelector<HTMLButtonElement>('[data-filter="others"]')?.classList.add(
        'immich-ext-folder-filter__chip--active',
      );
      return;
    }

    if (filter.type === 'tag') {
      chips.querySelector<HTMLButtonElement>(`[data-filter="tag:${filter.tagId}"]`)?.classList.add(
        'immich-ext-folder-filter__chip--active',
      );
    }
  };

  return {
    root,
    setFilter: setActiveChip,
    setBusy(busy) {
      root.classList.toggle('immich-ext-folder-filter--busy', busy);
      for (const chip of chips.querySelectorAll('button')) {
        chip.disabled = busy;
      }
    },
    setVisible(visible) {
      root.hidden = !visible;
    },
  };
}

export function mountFolderFilterBar(bar: FolderFilterBar): void {
  const section = document.querySelector('section.immich-scrollbar.overflow-auto');

  if (!section) {
    return;
  }

  const galleryMount = section.querySelector('.mt-2');

  if (galleryMount instanceof HTMLElement) {
    galleryMount.before(bar.root);
    return;
  }

  section.appendChild(bar.root);
}

export function unmountFolderFilterBar(bar: FolderFilterBar): void {
  bar.root.remove();
}
