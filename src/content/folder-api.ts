import { isDirectFileInFolder, normalizeFolderPath } from './folder-utils';
import type { FolderAsset, Person } from './types';

type MetadataSearchResponse = {
  assets: {
    items: Array<{
      id: string;
      originalPath: string;
      originalFileName?: string;
      width?: number;
      height?: number;
      thumbhash?: string | null;
      people?: Person[];
    }>;
    nextPage: string | null;
  };
};

export async function fetchFolderAssets(folderPath: string): Promise<FolderAsset[]> {
  const normalizedPath = normalizeFolderPath(folderPath);
  const assets: FolderAsset[] = [];
  let page = 1;
  let nextPage: string | null = '1';

  while (nextPage) {
    const response = await fetch('/api/search/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalPath: normalizedPath,
        withPeople: true,
        size: 1000,
        page,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch folder assets (${response.status})`);
    }

    const data = (await response.json()) as MetadataSearchResponse;

    for (const asset of data.assets.items) {
      if (!isDirectFileInFolder(asset.originalPath, normalizedPath)) {
        continue;
      }

      const width = asset.width ?? 0;
      const height = asset.height ?? 0;

      assets.push({
        id: asset.id,
        originalPath: asset.originalPath,
        originalFileName: asset.originalFileName ?? asset.originalPath.split('/').pop() ?? asset.id,
        width: width > 0 ? width : 1,
        height: height > 0 ? height : 1,
        thumbhash: asset.thumbhash,
        people: asset.people ?? [],
      });
    }

    nextPage = data.assets.nextPage;
    page = nextPage ? Number(nextPage) : 0;
  }

  return assets;
}
