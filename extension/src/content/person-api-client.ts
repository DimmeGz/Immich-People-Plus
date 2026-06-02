import type { PersonCard, PersonTag } from './types';
import { loadPersonApiSettings, type PersonApiSettings } from './storage';

export class PersonApiClient {
  #settings: PersonApiSettings;

  constructor(settings: PersonApiSettings) {
    this.#settings = settings;
  }

  static async create(): Promise<PersonApiClient | null> {
    const settings = await loadPersonApiSettings();

    if (!settings?.baseUrl || !settings.apiKey) {
      return null;
    }

    return new PersonApiClient(settings);
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.#settings.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.#settings.apiKey,
        ...(init.headers ?? {}),
      },
    });

    if (response.status === 404) {
      throw new Error('NOT_FOUND');
    }

    if (!response.ok) {
      throw new Error(`person-api request failed (${response.status})`);
    }

    return (await response.json()) as T;
  }

  async testConnection(): Promise<boolean> {
    const response = await fetch(`${this.#settings.baseUrl}/health`);
    return response.ok;
  }

  getPerson(personId: string): Promise<PersonCard> {
    return this.#request<PersonCard>(`/persons/${personId}`);
  }

  upsertPerson(personId: string, card: Partial<PersonCard>): Promise<PersonCard> {
    return this.#request<PersonCard>(`/persons/${personId}`, {
      method: 'PUT',
      body: JSON.stringify(card),
    });
  }

  setPersonTags(personId: string, tagIds: string[]): Promise<{ tags: PersonTag[] }> {
    return this.#request<{ tags: PersonTag[] }>(`/persons/${personId}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tagIds }),
    });
  }

  getTags(): Promise<{ tags: PersonTag[] }> {
    return this.#request<{ tags: PersonTag[] }>('/tags');
  }

  getBulkPersons(ids: string[]): Promise<{ persons: PersonCard[] }> {
    const query = new URLSearchParams({ ids: ids.join(',') }).toString();
    return this.#request<{ persons: PersonCard[] }>(`/persons/bulk/list?${query}`);
  }

  getPeopleByTag(tagId: string): Promise<{ personIds: string[] }> {
    return this.#request<{ personIds: string[] }>(`/persons/by-tag/${tagId}`);
  }
}
