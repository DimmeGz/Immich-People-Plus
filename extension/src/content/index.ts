import { syncDetailPanelAges } from './detail-panel-age';
import { syncDetailPanelPhotographer } from './detail-panel-photographer';
import {
  createFolderFilterController,
  isFolderAssetsPage,
  isFolderPhotoViewerPage,
  type FolderFilterController,
} from './folder-filter';
import { getFolderPathFromUrl } from './folder-utils';
import { createPeopleSortController, isPeopleListPage, type PeopleSortController } from './people-sort';
import { syncPersonPage } from './person-page';
import { syncPhotosAgeFilter } from './photos-age-filter';
import { isExtensionContextValid } from './storage';

let peopleController: PeopleSortController | null = null;
let folderController: FolderFilterController | null = null;
let activeFolderPath: string | null = null;

function isImmichPeoplePage(): boolean {
  return isPeopleListPage(window.location.pathname) && Boolean(document.getElementById('user-page-header'));
}

async function activatePeopleSort(): Promise<void> {
  if (peopleController || !isImmichPeoplePage() || !isExtensionContextValid()) {
    return;
  }

  peopleController = createPeopleSortController();

  try {
    await peopleController.init();
  } catch {
    deactivatePeopleSort();
  }
}

function deactivatePeopleSort(): void {
  peopleController?.dispose();
  peopleController = null;
}

function deactivateFolderFilter(preserveGallery = false): void {
  folderController?.dispose({ preserveGallery });
  folderController = null;
}

async function syncFolderFilter(): Promise<void> {
  const folderPath = getFolderPathFromUrl();

  if (!folderPath || !isExtensionContextValid()) {
    deactivateFolderFilter();
    activeFolderPath = null;
    return;
  }

  if (isFolderPhotoViewerPage()) {
    folderController?.setBarVisible(false);
    activeFolderPath = folderPath;
    return;
  }

  if (!isFolderAssetsPage()) {
    deactivateFolderFilter();
    activeFolderPath = null;
    return;
  }

  if (folderController && activeFolderPath === folderPath) {
    folderController.setBarVisible(true);
    return;
  }

  deactivateFolderFilter();
  activeFolderPath = folderPath;
  folderController = createFolderFilterController(folderPath);

  try {
    await folderController.init();
  } catch {
    deactivateFolderFilter();
    activeFolderPath = null;
  }
}

async function syncWithRoute(): Promise<void> {
  // First and synchronous: on /photos with an active age filter Immich's timeline waits for it.
  syncPhotosAgeFilter();
  // Synchronous too: drops the previous photo's ages as soon as the viewer moves on.
  syncDetailPanelAges();
  // Same for the photographer block: the previous photo's one goes at once, the new one is fetched.
  syncDetailPanelPhotographer();

  if (!isExtensionContextValid()) {
    deactivatePeopleSort();
    deactivateFolderFilter();
    activeFolderPath = null;
    return;
  }

  if (isImmichPeoplePage()) {
    await activatePeopleSort();
  } else {
    deactivatePeopleSort();
  }

  await syncPersonPage();
  await syncFolderFilter();
}

function watchRouteChanges(): void {
  let currentUrl = window.location.href;

  const handleRouteChange = () => {
    if (window.location.href === currentUrl) {
      return;
    }

    currentUrl = window.location.href;
    void syncWithRoute();
  };

  window.addEventListener('popstate', handleRouteChange);
  // Immich navigates with history.pushState from the page, which the wrappers below (isolated
  // world) do not see; the Navigation API reports those navigations right away.
  (window as unknown as { navigation?: EventTarget }).navigation?.addEventListener(
    'currententrychange',
    handleRouteChange,
  );

  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = (...args) => {
    originalPushState(...args);
    handleRouteChange();
  };

  history.replaceState = (...args) => {
    originalReplaceState(...args);
    handleRouteChange();
  };
}

function watchDomForImmichPages(): void {
  let timer: number | null = null;

  const observer = new MutationObserver(() => {
    if (timer !== null) {
      window.clearTimeout(timer);
    }

    timer = window.setTimeout(() => {
      timer = null;
      void syncWithRoute();
    }, 250);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

void syncWithRoute();
watchRouteChanges();
watchDomForImmichPages();
