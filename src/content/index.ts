import { createPeopleSortController, isPeopleListPage, type PeopleSortController } from './people-sort';
import { isExtensionContextValid } from './storage';

let controller: PeopleSortController | null = null;

function isImmichPeoplePage(): boolean {
  return isPeopleListPage(window.location.pathname) && Boolean(document.getElementById('user-page-header'));
}

async function activate(): Promise<void> {
  if (controller || !isImmichPeoplePage() || !isExtensionContextValid()) {
    return;
  }

  controller = createPeopleSortController();

  try {
    await controller.init();
  } catch {
    deactivate();
  }
}

function deactivate(): void {
  controller?.dispose();
  controller = null;
}

async function syncWithRoute(): Promise<void> {
  if (!isExtensionContextValid()) {
    deactivate();
    return;
  }

  if (isImmichPeoplePage()) {
    await activate();
    return;
  }

  deactivate();
}

function watchRouteChanges(): void {
  let currentPath = window.location.pathname;

  const handleRouteChange = () => {
    if (window.location.pathname === currentPath) {
      return;
    }

    currentPath = window.location.pathname;
    void syncWithRoute();
  };

  window.addEventListener('popstate', handleRouteChange);

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

function watchDomForPeoplePage(): void {
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
watchDomForPeoplePage();
