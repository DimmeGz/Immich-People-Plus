import type { PersonCard, PersonTag, SocialLink } from './types';
import { PersonApiClient } from './person-api-client';
import { isExtensionContextValid } from './storage';

type PersonCardController = {
  dispose: () => void;
};

function getPersonIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/people\/([^/]+)/);
  return match?.[1] ?? null;
}

function isPersonPage(pathname: string): boolean {
  return Boolean(getPersonIdFromPath(pathname));
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

async function mountPersonCard(): Promise<PersonCardController | null> {
  const personId = getPersonIdFromPath(window.location.pathname);

  if (!personId) {
    return null;
  }

  const client = await PersonApiClient.create();

  if (!client) {
    return null;
  }

  const pageHeader = document.getElementById('user-page-header');

  if (!pageHeader) {
    return null;
  }

  const host = pageHeader.parentElement ?? pageHeader;
  const root = document.createElement('section');
  root.className = 'immich-ext-person-card';
  root.dataset.immichPeoplePlus = 'person-card';

  const title = document.createElement('h3');
  title.className = 'immich-ext-person-card__title';
  title.textContent = 'Person card';

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
  tagsSelect.size = 6;

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

  root.append(title, grid, notesInput, socialContainer, addSocialButton, tagsLabel, tagsSelect, saveButton, status);
  host.appendChild(root);

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
  let existingCard: PersonCard | null = null;

  try {
    const [tagsResponse, personCard] = await Promise.all([
      client.getTags(),
      client.getPerson(personId).catch(() => null),
    ]);

    tags = tagsResponse.tags;
    existingCard = personCard;
  } catch (error) {
    status.textContent = 'Failed to load card metadata';
    console.error('[Immich People Plus] person-api load failed:', error);
    return {
      dispose: () => root.remove(),
    };
  }

  for (const tag of tags) {
    const option = document.createElement('option');
    option.value = tag.id;
    option.textContent = tag.name;
    tagsSelect.appendChild(option);
  }

  if (existingCard) {
    yearInput.value = existingCard.birthYear?.toString() ?? '';
    monthInput.value = existingCard.birthMonth?.toString() ?? '';
    dayInput.value = existingCard.birthDay?.toString() ?? '';
    notesInput.value = existingCard.notes ?? '';
    for (const link of existingCard.social) {
      addRow(link);
    }
    for (const option of tagsSelect.options) {
      option.selected = existingCard.tags.some((tag) => tag.id === option.value);
    }
  }

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

    const selectedTagIds = [...tagsSelect.selectedOptions].map((option) => option.value);

    try {
      await client.upsertPerson(personId, payload);
      await client.setPersonTags(personId, selectedTagIds);
      status.textContent = 'Saved';
    } catch (error) {
      status.textContent = 'Save failed';
      console.error('[Immich People Plus] person-api save failed:', error);
    } finally {
      saveButton.disabled = false;
    }
  });

  return {
    dispose: () => root.remove(),
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
  activePersonId = personId;
}
