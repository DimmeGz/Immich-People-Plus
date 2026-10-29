import { openWhoShotPopup } from './who-shot-popup';

export type ImmeyesLink = {
  label: string;
  title: string;
  path: (personId: string) => string;
};

/**
 * Links to the Immeyes service shown on the person page when "Immeyes URL" is set in the options.
 * Adding a page is one entry here.
 */
export const IMMEYES_LINKS: readonly ImmeyesLink[] = [
  {
    label: 'Схожі персони',
    title: 'Схожі персони в Immeyes',
    path: (id) => `/duplicates/person/${encodeURIComponent(id)}`,
  },
  {
    label: 'Порівняти',
    title: 'Порівняти з іншою персоною в Immeyes',
    path: (id) => `/duplicates/compare/${encodeURIComponent(id)}`,
  },
  {
    label: 'Мапа',
    title: 'Фото персони на мапі (Immeyes)',
    path: (id) => `/map?person=${encodeURIComponent(id)}`,
  },
];

/** «Хто знімав»: a popup rather than a link, and it asks Immeyes only when clicked. */
function createWhoShotButton(immeyesUrl: string, personId: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'immich-ext-person-card__trigger immich-ext-immeyes-links__link';
  button.dataset.immichPeoplePlus = 'who-shot-trigger';
  button.title = 'Хто знімав фото цієї персони: фотографи, корпуси й підписи (Immeyes)';
  button.textContent = 'Хто знімав';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openWhoShotPopup(immeyesUrl, personId);
  });

  return button;
}

export function createImmeyesLinks(immeyesUrl: string, personId: string): HTMLElement {
  const root = document.createElement('nav');
  root.className = 'immich-ext-immeyes-links';
  root.dataset.immichPeoplePlus = 'immeyes-links';
  root.setAttribute('aria-label', 'Immeyes');

  for (const link of IMMEYES_LINKS) {
    const anchor = document.createElement('a');
    anchor.className = 'immich-ext-person-card__trigger immich-ext-immeyes-links__link';
    anchor.href = `${immeyesUrl}${link.path(personId)}`;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.title = link.title;
    anchor.textContent = link.label;
    // Keep the click away from Immich's handlers on the person block (same as the Person card trigger).
    anchor.addEventListener('click', (event) => event.stopPropagation());
    root.appendChild(anchor);
  }

  root.appendChild(createWhoShotButton(immeyesUrl, personId));

  return root;
}
