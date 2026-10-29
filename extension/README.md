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
- **Хто знімав** — not a link but a button, see below.

The list lives in `src/content/immeyes-links.ts`; adding a page is one entry there. Without an Immeyes URL nothing is shown, and the links do not need the Person API.

#### «Хто знімав» popup

**Хто знімав** opens a popup (the person card’s overlay and panel; close with **✕**, **Esc** or a click on the background) with who took the photos this person is on, from Immeyes (`GET <immeyes>/api/photographers/person/<uuid>`, no credentials):

- **Header** — «Фото: N · з фотографом: N · без даних: N» (photos of the person Immeyes knows; with a photographer; with no photographer, no serial and no signature — phones, unread files).
- **Фотографи**, **Корпуси**, **Підписи** — most frequent first, 15 rows each, then **ще N** (how many different ones there are in all, minus 15) which shows the rest of what Immeyes sent; if the person has more than it sent, a note says «Показано найчастіші: N з M». An empty section says «немає». Every row is a link in a new tab with the photo count on the right: a photographer → `<immeyes>/photographers/<id>?person=<uuid>`, a camera body («Canon EOS R · serial», same naming as in the info panel block) → `<immeyes>/photographers?tab=bodies&open=<bodyKey>`, a signature → `<immeyes>/photographers?tab=signatures&open=<signature>`.
- **Приватні камери** and **Відбитки** — two more sections that appear only when there is something in them. **Приватні камери** (photographers Immeyes marks `private`: the person’s own camera rather than a photographer) sit right below **Фотографи**, which then lists only the real ones; a row is the same link to `<immeyes>/photographers/<id>?person=<uuid>`. **Відбитки** (cameras without a serial, see above) sit between **Корпуси** and **Підписи**: «SONY DSC-P200 · відбиток 0ce356debb63» → `<immeyes>/photographers?tab=fingerprints&open=<fingerprint>`. Older Immeyes without these fields simply shows neither.
- **When** — the request is made only on the click (for a person with many photos it can take seconds; the popup shows «Рахую…» meanwhile and can be closed, reopening shares the running request). The answer is cached per person until the page is reloaded; a failure («Immeyes недоступний»: 503, network error, anything but a normal answer) is not, the next click asks again. The popup closes when you leave the person page.

### Photographer in the photo info panel — optional (needs Immeyes)

When **Immeyes URL** is set, the info panel (ⓘ) of a photo gets one block from Immeyes (the service next to Immich that reads photo EXIF) — who took the photo, with which camera body, under which author signature. It sits right under the camera / lens rows of **Details**, in the same light small text as the age line; a photo without camera or lens text gets it right after the **People** block instead. Rows appear only for what Immeyes knows:

- **Фотограф: Alex Studio** — links to `<immeyes>/photographers/<id>`; a small mark says how the photographer was determined (**тег**, **підпис**, **корпус**, **відбиток**, **тека**); then up to three of the photographer’s own links (their label, or the domain without `www.`). Everything opens in a new tab.
- **Корпус: Canon EOS R · 0123456789AB (1234 фото)** — camera name (EXIF model, with the make in front unless the model already starts with it), serial and how many library photos share this body → `<immeyes>/photographers?tab=bodies&open=…`.
- **Відбиток: SONY DSC-P200 · 0ce356debb63 (56 фото)** — for cameras that write no serial, which Immeyes still tells apart by a per-unit region of the maker note (a *fingerprint*, `make|model|hash`): camera name, the hash and how many library photos share it → `<immeyes>/photographers?tab=fingerprints&open=…`. The photographer’s mark can then be **відбиток**.
- **Камера: …** — when the “photographer” is a person’s *private camera* (`private: true` in Immeyes) the first row says «Камера» instead of «Фотограф»; it still links to the same Immeyes page.
- **Підпис: Alex Studio (56 фото)** — the author signature from EXIF and its photo count → `<immeyes>/photographers?tab=signatures&open=…`.
- **Nothing to show** — one gray line: «EXIF ще не прочитано», «телефон або без камери, Immeyes не читає», «файл не вдалось прочитати» or, when Immeyes read the file and found nothing, «фотограф невідомий». Immeyes has not seen the photo (404): «Immeyes ще не бачив це фото»; the service is down, has no state database (503) or does not answer: «Immeyes недоступний».
- **How** — one `GET <immeyes>/api/photographers/asset/<id>` (no credentials) when a photo is open with the info panel shown, and again for each photo you move to; answers (and 404s) are cached per photo until the page is reloaded, «недоступний» is not, so the next visit to that photo asks again. Moving to another photo drops the old block at once and an answer that arrives late is ignored if it is not for the open photo. Reopening the panel never adds a second block. Without **Immeyes URL** nothing is requested and nothing is added.
- **Needs** — Immeyes must answer `/api/photographers/*` with CORS for the address you open Immich at (it always allows the origin of its own `IMMICH_PUBLIC_URL`; any other address goes into its `CORS_ORIGINS`) and be reachable from the browser; with Immich on `https` the Immeyes URL has to be `https` too (the browser blocks `http` requests from an `https` page).
- **Limits** — Immich’s camera and lens rows have no id of their own, so the block finds them through the search links Immich puts on the camera and lens text. A photo that has neither camera/lens text nor a People block with someone in it (screenshots, shared links without camera EXIF) gets no block. Like the age line, the block follows the photo in the address bar, so while the mouse is over another photo of a stack the panel may show that photo’s details but the block stays on the open one.

## Settings

Open `chrome://extensions` → Immich People Plus → **Details** → **Extension options** and set:

- Person API base URL (e.g. `http://localhost:3001`)
- API key (`X-API-Key`)
- Immeyes URL (optional, e.g. `http://immich-host:2284`)

Every integration is optional: the people sort, folder filter and the `/photos` age filter (with birth dates set in Immich) work with no settings at all; Person API adds the person card, tags, the birth-date fallback and ages in the photo info panel; the Immeyes URL adds the links and the photographer block.

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
14. With **Immeyes URL** set (open Immich in a new tab afterwards: a tab keeps the settings it read first), open a photo with the info panel ⓘ. Under the camera / lens rows (without camera EXIF: right after **People**) there is a block; check each state against Immeyes:
    - a photo with a photographer: «Фотограф: …» with a small mark (тег / підпис / корпус / тека) and up to three links; the name opens `<immeyes>/photographers/<id>`, every link a new tab;
    - «Корпус: камера · серійний номер (N фото)» opens `<immeyes>/photographers?tab=bodies&open=<bodyKey>` and «Підпис: … (N фото)» opens `…?tab=signatures&open=<signature>`; a photo with only a body (or only a signature) shows only that row; a photo of a camera without a serial that Immeyes knows by fingerprint (Sony DSC-P200) shows «Відбиток: камера · hash (N фото)» after the body row, linking to `…?tab=fingerprints&open=<fingerprint>`, and the photographer’s mark may say **відбиток**; a photographer Immeyes marks as a private camera shows «Камера: …» instead of «Фотограф: …»;
    - nothing found: one gray line — «EXIF ще не прочитано» (photo just added, Immeyes has not read EXIF), «телефон або без камери, Immeyes не читає» (phone photo), «файл не вдалось прочитати», «фотограф невідомий» (read, nothing matched); a photo added to Immich after the last Immeyes sync: «Immeyes ще не бачив це фото»; Immeyes stopped or the URL wrong: «Immeyes недоступний»;
    - next / previous: the previous photo’s block is gone at once and never stays under another photo; go back and forth between two photos: DevTools → Network shows one request per photo; close and reopen ⓘ several times: always exactly one block;
    - clear **Immeyes URL** (new tab again): no block and no requests to Immeyes.

**Person page (`/people/<uuid>`)**

15. With Person API configured: **Person card** opens the modal, save works. Without it: no **Person card**.
16. Options → set **Immeyes URL** → save → reload the person page: **Схожі персони** and **Порівняти** open `<immeyes>/duplicates/person/<uuid>` and `<immeyes>/duplicates/compare/<uuid>` in a new tab. Clear the field: the links are gone.
17. With **Immeyes URL** set, **Мапа** on the person page opens `<immeyes>/map?person=<uuid>` in a new tab with that person’s photos on the map.
18. With **Immeyes URL** set, click **Хто знімав** on the person page (open it in a fresh tab; check DevTools → Network: nothing goes to Immeyes before the click): the popup shows «Рахую…» and then «Фото: … · з фотографом: … · без даних: …» and the lists **Фотографи**, **Корпуси**, **Підписи**. Check that:
    - the numbers fit the person (total ≈ their photos known to Immeyes), names open `<immeyes>/photographers/<id>?person=<uuid>`, bodies and signatures open the matching Immeyes tab with the group opened, all in a new tab;
    - a section with more than 15 rows ends with **ще N**, which expands the rest; a person with no known photos shows «немає» in **Фотографи**, **Корпуси** and **Підписи**; **Відбитки** (a person photographed with a serial-less camera Immeyes fingerprints) and **Приватні камери** (their own cameras, photographers marked private in Immeyes, split off **Фотографи**) show only when they have rows;
    - **✕**, **Esc** and a click on the dark background each close it; click again: it opens at once from cache (no new request); the person page behind does not react to Esc or the clicks;
    - Immeyes stopped (`docker stop`) or the URL wrong: «Immeyes недоступний»; start it again and click once more — it loads (a failure is not cached);
    - go to another person while it is open: it closes; clear **Immeyes URL** (new tab): no **Хто знімав**.

**General**

19. Clear all options: people sort, folder filter and the age filter (Immich birth dates) still work; no console errors from the extension.

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
    detail-panel-photographer.ts  Info panel: photographer, body and signature from Immeyes
    person-age.ts          Age on a photo in Immich's wording (also ranges for year-only dates)
    person-page.ts         /people/<id>: tools row (person card, Immeyes links)
    immeyes-links.ts       Link list for the Immeyes service
    who-shot-popup.ts      «Хто знімав» popup (photographers, private cameras, bodies, fingerprints, signatures)
    person-card.ts         Person card modal (Person API)
    storage.ts             Extension storage (settings, saved filters)
  src/page/                Page-world script (document_start): filters Immich's timeline API
  src/shared/              Code shared by both worlds (message protocol, timeline filtering)
  src/content.css          Injected styles
  src/options.*            Settings page
  dist/                    Load this folder in Chrome
  manifest.json            Copied to dist on build
```
