import type { PersonCard, PersonTag, SocialLink } from './types';
import { PersonApiClient } from './person-api-client';
import { isExtensionContextValid } from './storage';

type PersonCardController = {
  dispose: () => void;
};

const TRIGGER_SELECTOR = '[data-immich-people-plus="person-card-trigger"]';
const MODAL_SELECTOR = '[data-immich-people-plus="person-card-modal"]';

function getPersonIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/people\/([^/]+)/);
  return match?.[1] ?? null;
}

function findPersonInfoBlock(): HTMLElement | null {
  const blocks = document.querySelectorAll<HTMLElement>('main div.relative.w-fit');

  for (const block of blocks) {
    if (block.querySelector('section.flex.place-items-center, section.flex.w-64')) {
      return block;
    }
  }

  return null;
}

function findPersonInfoSection(): HTMLElement | null {
  const block = findPersonInfoBlock();
  return block?.querySelector<HTMLElement>('section.flex') ?? null;
}

function waitForPersonInfoSection(timeoutMs = 15_000): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const existing = findPersonInfoSection();

    if (existing) {
      resolve(existing);
      return;
    }

    const startedAt = Date.now();

    const observer = new MutationObserver(() => {
      const section = findPersonInfoSection();

      if (section) {
        observer.disconnect();
        resolve(section);
      } else if (Date.now() - startedAt >= timeoutMs) {
        observer.disconnect();
        resolve(null);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    window.setTimeout(() => {
      observer.disconnect();
      resolve(findPersonInfoSection());
    }, timeoutMs);
  });
}

function closeModal(): void {
  document.querySelector(MODAL_SELECTOR)?.remove();
}

function createSocialRow(link: SocialLink, onRemove: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'immich-ext-person-card__social-row';

  const label = document.createElement('input');
  label.className = 'immich-ext-person-card__input';
  label.placeholder = 'Label';
  label.value = link.label ?? '';
  label.dataset.field = 'label';

  const url = document.createElement('input');
  url.className = 'immich-ext-person-card__input';
  url.placeholder = 'https://...';
  url.value = link.url;
  url.dataset.field = 'url';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'immich-ext-person-card__chip';
  remove.textContent = 'Remove';
  remove.addEventListener('click', onRemove);

  row.append(label, url, remove);
  return row;
}

function refreshTagOptions(select: HTMLSelectElement, tags: PersonTag[], selectedIds: Set<string>): void {
  select.replaceChildren();

  if (tags.length === 0) {
    const empty = document.createElement('option');
    empty.disabled = true;
    empty.textContent = 'No tags yet — create one below';
    select.appendChild(empty);
    select.size = 2;
    return;
  }

  select.size = Math.min(6, Math.max(3, tags.length));

  for (const tag of tags) {
    const option = document.createElement('option');
    option.value = tag.id;
    option.textContent = tag.name;
    option.selected = selectedIds.has(tag.id);
    select.appendChild(option);
  }
}

async function openPersonCardModal(personId: string): Promise<void> {
  closeModal();

  const client = await PersonApiClient.create();

  if (!client) {
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'immich-ext-person-card-modal';
  overlay.setAttribute('data-immich-people-plus', 'person-card-modal');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'immich-ext-person-card-modal-title');

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'immich-ext-person-card-modal__backdrop';
  backdrop.setAttribute('aria-label', 'Close');

  const panel = document.createElement('div');
  panel.className = 'immich-ext-person-card-modal__panel';

  const header = document.createElement('div');
  header.className = 'immich-ext-person-card-modal__header';

  const title = document.createElement('h2');
  title.id = 'immich-ext-person-card-modal-title';
  title.className = 'immich-ext-person-card-modal__title';
  title.textContent = 'Person card';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'immich-ext-person-card__chip';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', closeModal);

  header.append(title, closeButton);

  const body = document.createElement('div');
  body.className = 'immich-ext-person-card-modal__body';

  const yearInput = document.createElement('input');
  yearInput.type = 'number';
  yearInput.placeholder = 'Birth year';
  yearInput.className = 'immich-ext-person-card__input';

  const monthInput = document.createElement('input');
  monthInput.type = 'number';
  monthInput.placeholder = 'Birth month';
  monthInput.className = 'immich-ext-person-card__input';

  const dayInput = document.createElement('input');
  dayInput.type = 'number';
  dayInput.placeholder = 'Birth day';
  dayInput.className = 'immich-ext-person-card__input';

  const notesInput = document.createElement('textarea');
  notesInput.className = 'immich-ext-person-card__textarea';
  notesInput.placeholder = 'Notes';

  const socialContainer = document.createElement('div');
  socialContainer.className = 'immich-ext-person-card__social';

  const tagsLabel = document.createElement('span');
  tagsLabel.className = 'immich-ext-person-card__label';
  tagsLabel.textContent = 'Tags';

  const tagsSelect = document.createElement('select');
  tagsSelect.className = 'immich-ext-person-card__input';
  tagsSelect.multiple = true;

  const createTagRow = document.createElement('div');
  createTagRow.className = 'immich-ext-person-card__create-tag';

  const newTagInput = document.createElement('input');
  newTagInput.className = 'immich-ext-person-card__input';
  newTagInput.placeholder = 'New tag name';

  const createTagButton = document.createElement('button');
  createTagButton.type = 'button';
  createTagButton.className = 'immich-ext-person-card__chip';
  createTagButton.textContent = 'Add tag';

  createTagRow.append(newTagInput, createTagButton);

  const addSocialButton = document.createElement('button');
  addSocialButton.type = 'button';
  addSocialButton.className = 'immich-ext-person-card__chip';
  addSocialButton.textContent = 'Add link';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'immich-ext-person-card__chip immich-ext-person-card__chip--primary';
  saveButton.textContent = 'Save';

  const status = document.createElement('span');
  status.className = 'immich-ext-person-card__status';

  const grid = document.createElement('div');
  grid.className = 'immich-ext-person-card__grid';
  grid.append(yearInput, monthInput, dayInput);

  body.append(
    grid,
    notesInput,
    socialContainer,
    addSocialButton,
    tagsLabel,
    tagsSelect,
    createTagRow,
    saveButton,
    status,
  );

  panel.append(header, body);
  overlay.append(backdrop, panel);
  document.body.appendChild(overlay);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      closeModal();
    }
  };

  document.addEventListener('keydown', onKeyDown, { once: true });
  backdrop.addEventListener('click', closeModal);
  panel.addEventListener('click', (event) => event.stopPropagation());

  const socialRows: HTMLElement[] = [];
  const removeRow = (row: HTMLElement) => {
    row.remove();
    const idx = socialRows.indexOf(row);
    if (idx >= 0) {
      socialRows.splice(idx, 1);
    }
  };

  const addRow = (link: SocialLink) => {
    const row = createSocialRow(link, () => removeRow(row));
    socialRows.push(row);
    socialContainer.appendChild(row);
  };

  addSocialButton.addEventListener('click', () => addRow({ url: '', label: '' }));

  let tags: PersonTag[] = [];
  const selectedTagIds = new Set<string>();

  status.textContent = 'Loading...';

  try {
    const [tagsResponse, personCard] = await Promise.all([
      client.getTags(),
      client.getPerson(personId).catch(() => null),
    ]);

    tags = tagsResponse.tags;

    if (personCard) {
      yearInput.value = personCard.birthYear?.toString() ?? '';
      monthInput.value = personCard.birthMonth?.toString() ?? '';
      dayInput.value = personCard.birthDay?.toString() ?? '';
      notesInput.value = personCard.notes ?? '';
      for (const link of personCard.social) {
        addRow(link);
      }
      for (const tag of personCard.tags) {
        selectedTagIds.add(tag.id);
      }
    }

    refreshTagOptions(tagsSelect, tags, selectedTagIds);
    status.textContent = '';
  } catch (error) {
    status.textContent = 'Failed to load';
    console.error('[Immich People Plus] person-api load failed:', error);
  }

  createTagButton.addEventListener('click', async () => {
    const name = newTagInput.value.trim();

    if (!name) {
      status.textContent = 'Enter a tag name';
      return;
    }

    createTagButton.disabled = true;
    status.textContent = 'Creating tag...';

    try {
      const created = await client.createTag(name);
      tags = [...tags, created].sort((a, b) => a.name.localeCompare(b.name));
      selectedTagIds.add(created.id);
      refreshTagOptions(tagsSelect, tags, selectedTagIds);
      newTagInput.value = '';
      status.textContent = `Tag "${created.name}" created`;
    } catch (error) {
      status.textContent = 'Could not create tag';
      console.error('[Immich People Plus] create tag failed:', error);
    } finally {
      createTagButton.disabled = false;
    }
  });

  saveButton.addEventListener('click', async () => {
    status.textContent = 'Saving...';
    saveButton.disabled = true;

    const social = socialRows
      .map((row) => {
        const label = row.querySelector<HTMLInputElement>('input[data-field="label"]')?.value.trim() ?? '';
        const url = row.querySelector<HTMLInputElement>('input[data-field="url"]')?.value.trim() ?? '';
        return { label: label || null, url };
      })
      .filter((entry) => entry.url.length > 0);

    const payload: Partial<PersonCard> = {
      birthYear: yearInput.value ? Number(yearInput.value) : null,
      birthMonth: monthInput.value ? Number(monthInput.value) : null,
      birthDay: dayInput.value ? Number(dayInput.value) : null,
      notes: notesInput.value.trim() || null,
      social,
    };

    const tagIds = [...tagsSelect.selectedOptions]
      .map((option) => option.value)
      .filter((value) => value.length > 0);

    try {
      await client.upsertPerson(personId, payload);
      await client.setPersonTags(personId, tagIds);
      status.textContent = 'Saved';
    } catch (error) {
      status.textContent = 'Save failed';
      console.error('[Immich People Plus] person-api save failed:', error);
    } finally {
      saveButton.disabled = false;
    }
  });
}

function mountPersonCardTrigger(section: HTMLElement, personId: string): HTMLElement {
  section.classList.add('immich-ext-person-card-row');
  section.querySelector(TRIGGER_SELECTOR)?.remove();

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'immich-ext-person-card__trigger';
  trigger.textContent = 'Person card';
  trigger.setAttribute('data-immich-people-plus', 'person-card-trigger');

  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openPersonCardModal(personId);
  });

  section.appendChild(trigger);
  return trigger;
}

async function mountPersonCard(): Promise<PersonCardController | null> {
  const personId = getPersonIdFromPath(window.location.pathname);

  if (!personId) {
    return null;
  }

  const client = await PersonApiClient.create();

  if (!client) {
    return null;
  }

  const section = await waitForPersonInfoSection();

  if (!section) {
    return null;
  }

  const trigger = mountPersonCardTrigger(section, personId);

  return {
    dispose: () => {
      closeModal();
      trigger.remove();
      section.classList.remove('immich-ext-person-card-row');
    },
  };
}

let controller: PersonCardController | null = null;
let activePersonId: string | null = null;

export async function syncPersonCard(): Promise<void> {
  if (!isExtensionContextValid()) {
    controller?.dispose();
    controller = null;
    activePersonId = null;
    return;
  }

  const personId = getPersonIdFromPath(window.location.pathname);

  if (!personId) {
    controller?.dispose();
    controller = null;
    activePersonId = null;
    return;
  }

  if (controller && activePersonId === personId) {
    return;
  }

  controller?.dispose();
  controller = await mountPersonCard();
  activePersonId = controller ? personId : null;
}
