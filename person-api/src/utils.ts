import { randomUUID } from 'node:crypto';
import type { SocialLink } from './types.js';

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(): string {
  return randomUUID();
}

export function parseSocial(value: unknown): SocialLink[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const links: SocialLink[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const candidate = entry as { label?: unknown; url?: unknown };
    const url = typeof candidate.url === 'string' ? candidate.url.trim() : '';
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';

    if (!url || !/^https?:\/\//i.test(url)) {
      continue;
    }

    links.push({ url, label: label || null });
  }

  return dedupeSocial(links);
}

export function dedupeSocial(links: SocialLink[]): SocialLink[] {
  const seen = new Set<string>();
  const result: SocialLink[] = [];

  for (const link of links) {
    const key = link.url.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(link);
  }

  return result;
}

export function toNumberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }

  return value;
}
