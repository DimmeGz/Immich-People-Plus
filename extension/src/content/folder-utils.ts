import type { FolderAsset, FolderFilter, FolderPersonSummary, Person } from './types';

export function normalizeFolderPath(folderPath: string): string {
  const trimmed = folderPath.trim();

  if (trimmed.length <= 1) {
    return trimmed.replace(/\/$/, '');
  }

  return trimmed.replace(/\/$/, '');
}

export function isDirectFileInFolder(originalPath: string, folderPath: string): boolean {
  const folder = normalizeFolderPath(folderPath);
  const prefix = `${folder}/`;

  if (!originalPath.startsWith(prefix)) {
    return false;
  }

  const remainder = originalPath.slice(prefix.length);
  return remainder.length > 0 && !remainder.includes('/');
}

export function buildPersonSummaries(assets: FolderAsset[]): FolderPersonSummary[] {
  const summaries = new Map<string, FolderPersonSummary & { assetIds: Set<string> }>();

  for (const asset of assets) {
    for (const person of asset.people) {
      if (person.isHidden) {
        continue;
      }

      let summary = summaries.get(person.id);

      if (!summary) {
        summary = {
          person,
          assetCount: 0,
          assetIds: new Set<string>(),
        };
        summaries.set(person.id, summary);
      }

      if (!summary.assetIds.has(asset.id)) {
        summary.assetIds.add(asset.id);
        summary.assetCount += 1;
      }
    }
  }

  return [...summaries.values()]
    .map(({ person, assetCount }) => ({ person, assetCount }))
    .sort((left, right) => {
      const countDiff = right.assetCount - left.assetCount;

      if (countDiff !== 0) {
        return countDiff;
      }

      return left.person.name.localeCompare(right.person.name, undefined, { sensitivity: 'base' });
    });
}

export function countOtherPhotos(assets: FolderAsset[]): number {
  return assets.filter((asset) => asset.people.length === 0).length;
}

export function getVisibleAssetIds(assets: FolderAsset[], filter: FolderFilter): Set<string> {
  if (filter.type === 'all') {
    return new Set(assets.map((asset) => asset.id));
  }

  if (filter.type === 'person') {
    return new Set(
      assets.filter((asset) => asset.people.some((person) => person.id === filter.personId)).map((asset) => asset.id),
    );
  }

  return new Set(assets.filter((asset) => asset.people.length === 0).map((asset) => asset.id));
}

export function isFoldersPage(pathname: string): boolean {
  const normalized = pathname.replace(/\/$/, '') || '/';
  return normalized === '/folders';
}

export function getFolderPathFromUrl(): string | null {
  const path = new URLSearchParams(window.location.search).get('path');
  return path?.trim() ? path : null;
}
