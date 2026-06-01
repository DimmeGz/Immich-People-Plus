import createJustifiedLayout from 'justified-layout';
import type { FolderAsset } from './types';

const FILTERED_GALLERY_SELECTOR = '[data-immich-extension="filtered-gallery"]';
const HIDDEN_GALLERY_ATTR = 'data-immich-extension-gallery-hidden';

function getAssetThumbnailUrl(asset: FolderAsset): string {
  const params = new URLSearchParams({ size: 'thumbnail' });

  if (asset.thumbhash) {
    params.set('c', asset.thumbhash);
  }

  return `/api/assets/${asset.id}/thumbnail?${params}`;
}

function getAssetViewerUrl(assetId: string, folderPath: string): string {
  const params = new URLSearchParams({ path: folderPath });
  return `/folders/photos/${assetId}?${params}`;
}

function getGallerySection(): HTMLElement | null {
  const section = document.querySelector('section.immich-scrollbar.overflow-auto');
  return section instanceof HTMLElement ? section : null;
}

function getImmichGalleryWrapper(): HTMLElement | null {
  const section = getGallerySection();

  if (!section) {
    return null;
  }

  for (const mount of section.querySelectorAll('.mt-2')) {
    if (mount.querySelector('[data-asset], .relative')) {
      return mount instanceof HTMLElement ? mount : null;
    }
  }

  return null;
}

function getGalleryWidth(): number {
  const wrapper = getImmichGalleryWrapper();

  if (wrapper && wrapper.clientWidth > 0) {
    return Math.floor(wrapper.clientWidth);
  }

  const section = getGallerySection();

  if (section && section.clientWidth > 0) {
    return Math.floor(section.clientWidth);
  }

  return Math.floor(window.innerWidth);
}

function getRowHeight(): number {
  return window.innerWidth < 850 ? 100 : 235;
}

function sortAssets(assets: FolderAsset[]): FolderAsset[] {
  return [...assets].sort((left, right) =>
    left.originalPath.localeCompare(right.originalPath, undefined, { sensitivity: 'base' }),
  );
}

function buildFilteredGallery(assets: FolderAsset[], folderPath: string): HTMLElement {
  const sortedAssets = sortAssets(assets);
  const containerWidth = getGalleryWidth();
  const aspectRatios = sortedAssets.map((asset) => asset.width / asset.height);
  const layout = createJustifiedLayout(aspectRatios, {
    targetRowHeight: getRowHeight(),
    containerWidth,
    boxSpacing: 2,
    targetRowHeightTolerance: 0.5,
    containerPadding: 0,
  });

  const root = document.createElement('div');
  root.className = 'mt-2';
  root.dataset.immichExtension = 'filtered-gallery';

  const mount = document.createElement('div');
  mount.style.position = 'relative';
  mount.style.width = `${layout.containerWidth}px`;
  mount.style.height = `${layout.containerHeight}px`;

  for (let index = 0; index < sortedAssets.length; index += 1) {
    const asset = sortedAssets[index];
    const box = layout.boxes[index];

    const item = document.createElement('div');
    item.className = 'absolute';
    item.style.overflow = 'clip';
    item.style.top = `${box.top}px`;
    item.style.left = `${box.left}px`;
    item.style.width = `${box.width}px`;
    item.style.height = `${box.height}px`;

    const link = document.createElement('a');
    link.href = getAssetViewerUrl(asset.id, folderPath);
    link.draggable = false;
    link.className = 'block h-full w-full';

    const image = document.createElement('img');
    image.src = getAssetThumbnailUrl(asset);
    image.alt = asset.originalFileName;
    image.loading = 'lazy';
    image.draggable = false;
    image.className = 'h-full w-full object-cover';

    link.appendChild(image);
    item.appendChild(link);

    const label = document.createElement('div');
    label.className =
      'absolute bottom-0 w-full overflow-clip bg-slate-50/75 p-1 text-center font-mono text-xs font-semibold text-ellipsis whitespace-pre-wrap dark:bg-slate-800/75';
    label.textContent = asset.originalFileName;
    item.appendChild(label);

    mount.appendChild(item);
  }

  root.appendChild(mount);
  return root;
}

function removeFilteredGallery(): void {
  document.querySelector(FILTERED_GALLERY_SELECTOR)?.remove();
}

function setImmichGalleryHidden(hidden: boolean): void {
  const wrapper = getImmichGalleryWrapper();

  if (!wrapper) {
    return;
  }

  wrapper.hidden = hidden;
  wrapper.toggleAttribute(HIDDEN_GALLERY_ATTR, hidden);
}

export function showFilteredGallery(assets: FolderAsset[], folderPath: string): void {
  removeFilteredGallery();
  setImmichGalleryHidden(true);

  const gallery = buildFilteredGallery(assets, folderPath);
  const wrapper = getImmichGalleryWrapper();

  if (wrapper) {
    wrapper.insertAdjacentElement('afterend', gallery);
    return;
  }

  getGallerySection()?.appendChild(gallery);
}

export function clearFilteredGallery(): void {
  removeFilteredGallery();
  setImmichGalleryHidden(false);
}

export function waitForGalleryAssets(timeoutMs = 15_000): Promise<boolean> {
  return new Promise((resolve) => {
    if (document.querySelector('[data-asset]')) {
      resolve(true);
      return;
    }

    const startedAt = Date.now();

    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-asset]')) {
        observer.disconnect();
        resolve(true);
      } else if (Date.now() - startedAt >= timeoutMs) {
        observer.disconnect();
        resolve(false);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    window.setTimeout(() => {
      observer.disconnect();
      resolve(Boolean(document.querySelector('[data-asset]')));
    }, timeoutMs);
  });
}
