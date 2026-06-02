export async function createManualFace(personId: string, assetId: string): Promise<void> {
  const response = await fetch('/api/faces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personId,
      assetId,
      imageHeight: 0,
      imageWidth: 0,
      height: 0,
      width: 0,
      x: 0,
      y: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to assign person to photo (${response.status})`);
  }
}

export async function assignPersonToOtherPhotos(
  personId: string,
  assetIds: string[],
  onProgress?: (completed: number, total: number) => void,
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  for (let index = 0; index < assetIds.length; index += 1) {
    try {
      await createManualFace(personId, assetIds[index]!);
      succeeded += 1;
    } catch {
      failed += 1;
    }

    onProgress?.(index + 1, assetIds.length);
  }

  return { succeeded, failed };
}
