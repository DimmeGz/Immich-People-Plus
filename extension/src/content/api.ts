import type { PeoplePageResponse, Person } from './types';

export async function fetchPeoplePage(page: number, size = 1000): Promise<PeoplePageResponse> {
  const response = await fetch(`/api/people?withHidden=true&page=${page}&size=${size}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch people (${response.status})`);
  }

  return response.json() as Promise<PeoplePageResponse>;
}

export async function fetchAllVisiblePeople(): Promise<Person[]> {
  const people: Person[] = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await fetchPeoplePage(page);
    people.push(...data.people);
    hasNextPage = data.hasNextPage;
    page += 1;
  }

  return people.filter((person) => !person.isHidden);
}
