# Chrome extension

Content scripts that add optional features to a self-hosted Immich web UI.

## Features

### People page sorting (`/people`)

Adds **Tag** (optional, requires Person API) and **Sort** dropdowns to the people list header:

- **Tag → All tags** — show everyone (Immich default when Sort is also Default)
- **Tag → …** — show only people assigned that tag in Person API
- **Sort → Default** — Immich's built-in order (unchanged when no tag filter)
- **Sort → Name A→Z / Z→A** — custom grid sorted by name

Tag and sort can be combined: filter by tag first, then apply name order on the custom grid.

Unnamed people are placed at the end when name sorting is active. Your choices are saved in extension storage and restored on the next visit.

When switching back to **Default** sort with **All tags**, the page reloads to restore Immich's original grid and infinite scroll.

### Folder people filter (`/folders?path=...`)

When you open a folder with direct photo files (not subfolders), a **People** bar appears above the gallery:

- **Person chips** — avatar, name, and photo count in this folder
- **Other photos** — photos without assigned people
- **Tag other photos** — opens a modal to assign a person to all photos in the folder with no detected faces (uses Immich’s face API)
- **Tag chips** — optional, if person-api is configured
- **Show all** — resets the filter

Active filters render a custom justified gallery for matching photos. The filter bar and gallery state are preserved when you open and close a photo in the folder viewer.

The bar is shown only when the URL has a `path` query parameter and the folder has at least one recognized person or one “other” photo.

### Person card (`/people/{id}`) — optional

On a **person’s photo page** (`/people/<uuid>`), a **Person card** link appears on the same row as the Immich avatar and name (right side). Clicking it opens a modal with:

If Person API is configured, the modal includes:

- birth year / month / day
- notes
- multiple social links (label + URL)
- tag assignment (create tags with **Add tag** if none exist yet)

If Person API is not configured or unavailable, the extension keeps working without this panel.

### Age filter (`/photos`)

Above the memories on the main timeline (`/photos`) a bar **Вік від … до …** filters the timeline to photos where **at least one person had that age** when the photo was taken. Immich keeps drawing its own timeline, so day/month groups, the year scrubber, the photo viewer (next/previous stay inside the filtered set) and selection all work as usual.

- **Who counts** — visible (not hidden) people with a known birth date: Immich’s `birthDate` first (person menu → *Set date of birth*), the Person API card (`birth_year` / `birth_month` / `birth_day`) for the rest. People without any birth date are skipped. A year-only date counts from 1 January, year + month from the 1st (the status then says how many people are «±1 рік»).
- **Bounds** — whole years 0–150, either side may stay empty. For each person: from `birthday + from years` up to the last day before `birthday + (to + 1) years`, so «до 5» includes the whole last day at age 5.
- **Apply** — **Застосувати** or Enter. The page reloads (Immich caches loaded months; a reload is the only reliable way to make it fetch them again). While the extension searches, the timeline waits and the bar shows «Фільтрую: N з M людей…»; then **Фото: N · людей з датою народження: M з K**. **Скинути** reloads to the plain timeline.
- **Lifetime** — the filter lives in this tab while you stay on `/photos` (opening and closing photos, F5). Leaving `/photos` switches it off; a new visit starts with the plain timeline. Nothing is saved across visits.
- **How** — one standard search per person (`POST /api/search/metadata` with `personIds`, `takenAfter`, `takenBefore`, paged, 4 in parallel), union of the results. A page-world script (`src/page/timeline-age-filter.ts`, injected at `document_start`) answers Immich’s own `GET /api/timeline/buckets` and `GET /api/timeline/bucket` with only those assets. It does nothing on other pages or without an active filter.
- **Safety net** — if Immich answers the timeline in a format the extension does not recognise, or the search fails, the timeline is shown unfiltered and the bar says so. Checked against Immich v3.0.2.
- **Limits** — partners’ photos drop out while filtering (people belong to their owner). For stacks Immich shows only the primary photo: a stack whose primary photo has nobody of the right age is not shown. The memories carousel and photos uploaded while the page is open are not filtered. After changing a birth date, apply the filter again.

### Age in the photo info panel — optional (needs Person API)

Immich already shows each person’s age on the photo under their name in the **People** block of the info panel (ⓘ), but only for birth dates stored in Immich. For people whose birth date is only in the Person API card, the extension adds the same line in the same place:

- **Wording** — Immich’s: «Вік 3 місяці», «Вік 1 рік, 2 місяці», «Вік 5» (or «Age …» when Immich is in English; other Immich languages get English). Smaller text when the panel lists more than six people, like Immich. The tooltip shows the birth date and «person-api».
- **Dates** — the age is counted from the photo’s local date (Immich’s `localDateTime`) the same way Immich counts it. If the card has only the year (or year and month) and the age is not certain, a range is shown: «Вік 4–5», «Вік 0–7 місяців». No line if the photo was taken before the person was born.
- **Immich first** — people with a birth date in Immich are left to Immich, even if the card has another date.
- **How** — when the info panel shows people, one `GET /api/assets/<id>` (date of the photo and its people) and one Person API bulk request. Opening the next photo drops the previous ages at once. Without Person API settings nothing is requested and nothing is added.
- **Limits** — Immich shows the People block only on your own photos (not on partners’ photos or shared links), so there is no age there either. While the mouse is over another photo of a stack, Immich previews that photo’s people; the ages stay computed from the open photo’s date.

### Immeyes links (`/people/{id}`) — optional

When **Immeyes URL** is set in the options, the same row gets links that open in a new tab:

- **Схожі персони** → `<immeyes>/duplicates/person/<uuid>`
- **Порівняти** → `<immeyes>/duplicates/compare/<uuid>`
- **Мапа** → `<immeyes>/map?person=<uuid>`

The list lives in `src/content/immeyes-links.ts`; adding a page is one entry there. Without an Immeyes URL nothing is shown, and the links do not need the Person API.

## Settings

Open `chrome://extensions` → Immich People Plus → **Details** → **Extension options** and set:

- Person API base URL (e.g. `http://localhost:3001`)
- API key (`X-API-Key`)
- Immeyes URL (optional, e.g. `http://immich-host:2284`)

Every integration is optional: the people sort, folder filter and the `/photos` age filter (with birth dates set in Immich) work with no settings at all; Person API adds the person card, tags, the birth-date fallback and ages in the photo info panel; the Immeyes URL only adds links.

Chrome 111 or newer is required (the age filter’s page script uses `"world": "MAIN"`).

## Install (development)

From the repository root:

```bash
cd extension
npm install
npm run build
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the **`extension/dist/`** folder

## Development

```bash
cd extension
npm run watch
```

After changes, click **Reload** on the extension card in `chrome://extensions`, then refresh the Immich tab.

**Note:** After reloading the extension, refresh any open Immich tabs to avoid “Extension context invalidated” errors.

Typecheck without building:

```bash
cd extension
npx tsc --noEmit
```

## Manual test checklist

The extension has no automated tests in the repository; after a change, run through this in Chrome with the rebuilt `dist/` loaded (**Reload** on `chrome://extensions`) and the Immich tab refreshed.

**People page (`/people`)**

1. Tag and Sort dropdowns appear in the header; Name A→Z / Z→A reorders, Default + All tags reloads to Immich’s grid.

**Folder (`/folders?path=...`)**

2. The People bar appears; a person chip shows only their photos in the custom gallery, **Show all** restores Immich’s gallery.
3. Open a photo from the custom gallery and close it: the filter is still active.

**Age filter (`/photos`)**

4. Open `/photos`: the **Вік від … до …** bar is above the memories, the timeline is the usual one.
5. Make sure a few people have a birth date in Immich (person menu → *Set date of birth*). Enter «від 2 до 5», press **Застосувати**: the page reloads, the bar shows «Фільтрую…», then **Фото: N · людей з датою народження: M з K**. The timeline shows only matching photos, still grouped by days with the year scrubber on the right.
6. Spot-check: for a photo near the edges, open it and compare its date with the person’s birthday (photo on the 6th birthday must be absent for «до 5»).
7. Open a photo and use next/previous: only filtered photos. Close the viewer: the filter is still active. F5: still active.
8. «до 3» with «від» empty, then «від 10» with «до» empty: each side works alone. «від 7 до 3» or «abc» shows the error text and nothing reloads.
9. **Скинути**: the page reloads with the full timeline.
10. Apply a filter, go to `/people` and back to `/photos` via the sidebar: full timeline, empty inputs. Open `/photos` in a new tab: full timeline.
11. With Person API configured: a person with only a birth year there (nothing in Immich) is counted; the status mentions «±1 рік». Without Person API the filter still works with Immich birth dates.

**Photo info panel (any photo, ⓘ)**

12. With Person API configured, give someone a full birth date in their Person card and leave Immich’s empty; open one of their photos and the info panel: under their name in **People** is «Вік N» (or «Вік N місяців» for a baby), the tooltip shows the date and «person-api». Someone with an Immich birth date shows Immich’s own line only once.
13. Next/previous to a photo of the same person from another year: the age changes, the old one never stays. A card with only the year shows a range («Вік 4–5») where the age is not certain. A photo from before the birth: no age. Without Person API: nothing added.

**Person page (`/people/<uuid>`)**

14. With Person API configured: **Person card** opens the modal, save works. Without it: no **Person card**.
15. Options → set **Immeyes URL** → save → reload the person page: **Схожі персони** and **Порівняти** open `<immeyes>/duplicates/person/<uuid>` and `<immeyes>/duplicates/compare/<uuid>` in a new tab. Clear the field: the links are gone.
16. With **Immeyes URL** set, **Мапа** on the person page opens `<immeyes>/map?person=<uuid>` in a new tab with that person’s photos on the map.

**General**

17. Clear all options: people sort, folder filter and the age filter (Immich birth dates) still work; no console errors from the extension.

## Project layout

```
extension/
  src/content/             Content scripts (isolated world)
    index.ts               Route watcher (people list, person page, folders, /photos, viewer)
    people-sort.ts         /people: sort + tag filter
    folder-*.ts            /folders: people bar + filtered gallery
    photos-age-filter.ts   /photos: age bar, per-person searches, talks to the page script
    age-filter-control.ts  The «Вік від … до …» inputs
    birth-date.ts          Birth dates (Immich, then Person API) and the date window per person
    detail-panel-age.ts    Info panel: age under people whose birth date is only in Person API
    person-age.ts          Age on a photo in Immich's wording (also ranges for year-only dates)
    person-page.ts         /people/<id>: tools row (person card, Immeyes links)
    immeyes-links.ts       Link list for the Immeyes service
    person-card.ts         Person card modal (Person API)
    storage.ts             Extension storage (settings, saved filters)
  src/page/                Page-world script (document_start): filters Immich's timeline API
  src/shared/              Code shared by both worlds (message protocol, timeline filtering)
  src/content.css          Injected styles
  src/options.*            Settings page
  dist/                    Load this folder in Chrome
  manifest.json            Copied to dist on build
```
