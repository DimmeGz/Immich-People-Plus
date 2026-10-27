import { createImmeyesLinks } from './immeyes-links';
import { PersonApiClient } from './person-api-client';
import {
  closePersonCardModal,
  createPersonCardTrigger,
  getPersonIdFromPath,
  waitForPersonInfoSection,
} from './person-card';
import { isExtensionContextValid, loadImmeyesUrl } from './storage';

const TOOLS_SELECTOR = '[data-immich-people-plus="person-tools"]';
const ROW_CLASS = 'immich-ext-person-card-row';

type PersonPageDeps = {
  client: PersonApiClient | null;
  immeyesUrl: string | null;
};

/**
 * Tools row on `/people/<uuid>`, right of Immich's avatar and name: "Person card" (needs person-api)
 * and the Immeyes links (need the Immeyes URL). Each part appears only when it is configured.
 */
class PersonToolsController {
  readonly #section: HTMLElement;
  readonly #tools: HTMLElement;

  constructor(personId: string, section: HTMLElement, deps: PersonPageDeps) {
    this.#section = section;

    section.classList.add(ROW_CLASS);
    // Tools left behind by an earlier mount into the same node (Immich reuses it between renders).
    section.querySelector(TOOLS_SELECTOR)?.remove();

    this.#tools = document.createElement('div');
    this.#tools.className = 'immich-ext-person-tools';
    this.#tools.dataset.immichPeoplePlus = 'person-tools';

    if (deps.client) {
      this.#tools.appendChild(createPersonCardTrigger(personId));
    }

    if (deps.immeyesUrl) {
      this.#tools.appendChild(createImmeyesLinks(deps.immeyesUrl, personId));
    }

    section.appendChild(this.#tools);
  }

  isMounted(): boolean {
    return this.#tools.isConnected;
  }

  dispose(): void {
    closePersonCardModal();
    this.#tools.remove();
    this.#section.classList.remove(ROW_CLASS);
  }
}

let controller: PersonToolsController | null = null;
let activePersonId: string | null = null;
let pendingPersonId: string | null = null;

function teardown(): void {
  controller?.dispose();
  controller = null;
  activePersonId = null;
}

async function mountPersonTools(personId: string): Promise<PersonToolsController | null> {
  const [client, immeyesUrl] = await Promise.all([PersonApiClient.create(), loadImmeyesUrl()]);

  if (!client && !immeyesUrl) {
    return null;
  }

  const section = await waitForPersonInfoSection();

  if (!section || getPersonIdFromPath(window.location.pathname) !== personId) {
    return null;
  }

  return new PersonToolsController(personId, section, { client, immeyesUrl });
}

export async function syncPersonPage(): Promise<void> {
  const personId = isExtensionContextValid() ? getPersonIdFromPath(window.location.pathname) : null;

  if (!personId) {
    teardown();
    return;
  }

  // A mount for this person is already waiting for Immich's person block.
  if (pendingPersonId === personId) {
    return;
  }

  if (controller && activePersonId === personId && controller.isMounted()) {
    return;
  }

  // Another person, or Immich re-rendered the person block (select-featured-photo mode,
  // person change inside `{#key person.id}`): mount again.
  teardown();
  pendingPersonId = personId;

  let mounted: PersonToolsController | null = null;

  try {
    mounted = await mountPersonTools(personId);
  } catch (error) {
    console.error('[Immich People Plus] Person page tools failed:', error);
  } finally {
    pendingPersonId = null;
  }

  if (!mounted) {
    return;
  }

  if (getPersonIdFromPath(window.location.pathname) !== personId || !mounted.isMounted()) {
    mounted.dispose();
    return;
  }

  controller = mounted;
  activePersonId = personId;
}
