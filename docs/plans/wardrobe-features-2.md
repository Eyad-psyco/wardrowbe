# Seven more wardrobe features

## Progress

Tick as each lands.

- [ ] **§1** Multiple images in the single-item create modal (frontend only)
- [ ] **§2** Tags in the create modal (`user_tags` Form param + `TagInput`)
- [ ] **§3** `TagInput` upgrades — suggest on focus, floating list, counts
- [ ] **§4** Tags on the wardrobe card + `+N` popover (new `ui/popover.tsx`)
- [ ] **§5** Multi-select type filter, incl. bulk `select_all` parity
- [ ] **§6** Fit / Fill toggle so card images aren't cropped
- [ ] **§7** Hover auto-advance on multi-image cards (desktop)
- [ ] i18n keys + `npm run i18n:check`
- [ ] verification pass (§ Verification)

### Deviations from the plan

_(record any here as they happen)_

## Context

The eight features in [wardrobe-features.md](wardrobe-features.md) are all shipped. Using them
surfaced seven gaps — five in the item-creation and filtering flow, two in how the grid shows
images:

1. **Single-item create takes one image.** Multi-image support only exists *after* the item exists
   (the detail dialog's thumbnail strip), so adding a 3-photo item is create → reopen → upload.
2. **Tags can only be added after creation**, for the same reason — `POST /items` has no tag field.
3. **The tag filter only suggests after you type**, renders suggestions in-flow (shifting the filter
   row), and shows no counts.
4. **Tags are invisible on the wardrobe grid** — you have to open an item to see what it's tagged.
5. **The type filter is single-select** — you can look at shirts, or everything, nothing in between.
6. **Card images are cropped.** Not a processing bug — the backend preserves aspect ratio
   (`image.thumbnail()`, `image_service.py:96`); it's purely `object-cover` inside the card's
   `aspect-square` box, so a portrait photo loses its top and bottom.
7. **A multi-image card looks identical to a single-image one** until you notice the dots or reach
   for an arrow.

Decisions already made: card shows `user_tags` only (not AI `tags.features`); the overflow "+N" uses
a real Popover; the tag suggestion list becomes a floating dropdown with counts, ordered by
frequency; image fit is a localStorage toggle between `contain` and `fill`; hover cycles images on
a timer.

**One new dependency: `@radix-ui/react-popover`** + a standard shadcn `components/ui/popover.tsx`.
Justified by two features (card tag overflow, multi-select type filter): the wardrobe `Card` is
`overflow-hidden`, so an in-flow panel clips, and nothing installed today opens on both hover and
touch. Everything else reuses what is already here.

---

## 1. Multiple images in the single-item create modal

**No backend change.** `POST /items` (primary + phash duplicate check) and
`POST /items/{id}/images` (multi-file, capped by `settings.max_item_images`, per-file `errors`)
already exist and already do exactly this — chain them.

[frontend/components/add-item-dialog.tsx](../../frontend/components/add-item-dialog.tsx), single tab
only (the bulk tab is untouched):

- Replace `file: File | null` / `preview: string | null` with `files: FileWithPreview[]`, reusing the
  existing `FileWithPreview` type, `blobUrlsRef` cleanup, and `removeBulkFile`/`clearBulkFiles`
  helpers rather than the current `FileReader` base64 path.
- Single dropzone: drop `maxFiles: 1` / `multiple: false`; `onDropSingle` appends like `onDropBulk`.
- UI: `files[0]` keeps today's large preview (it becomes the item's primary image); the rest render
  in the same 4-col thumbnail grid the bulk tab already uses at `add-item-dialog.tsx:443-465`, each
  with the X remove button. Dropzone stays visible while `files.length < 1 + maxItemImages`
  (`useFeatures().max_item_images`, as the detail dialog does at `item-detail-dialog.tsx:133`).
- `handleSingleSubmit`: `createItem.mutateAsync` with `files[0]`, then if there are more, one
  `useAddItemImages().mutateAsync({ itemId: created.id, files: rest })`; toast any `errors` entries.
  Wrap the second call in its own try/catch — the item already exists at that point, so on failure
  toast a warning and still close; do not leave the modal open pretending nothing was created.
- `hasUnsavedFiles` and `handleClose` follow the array.

Skipped: making the extra images durable/resumable. `POST /items/{id}/images` is already marked
`# ponytail: non-durable` — a closed tab loses the tail of the batch, and the item plus its primary
image survive. Add `lib/upload-queue.ts` here only if that turns out to bite.

## 2. Tags in the create modal

**Backend** — `api/items.py:154-223`: add `user_tags: str | None = Form(None)`, split on comma into
`ItemCreate(user_tags=...)` exactly like the existing `colors` param two lines above. `ItemCreate`'s
`_clean_user_tags` validator (`schemas/item.py:80`) normalizes, and `ItemService.create` already
persists `user_tags` (`item_service.py:215`) — nothing else to touch.

**Frontend**: a `<TagInput>` in the single tab's field block with `useItemTags()` suggestions,
mirroring `item-detail-dialog.tsx:679-687`; `formData.append('user_tags', tags.join(','))` when
non-empty.

Not doing: tags on the bulk tab (one tag set for N unrelated garments is rarely what you want).

## 3. Tag filter / `TagInput` upgrades

All in [frontend/components/tag-input.tsx](../../frontend/components/tag-input.tsx) — both call sites
(the wardrobe filter row and the item edit form) get the same behaviour:

- `suggestions` prop becomes `Array<{ tag: string; count: number }>`; both call sites already hold
  exactly that array from `useItemTags()` and currently `.map()` it away — pass it straight through.
- New `focused` state. `matches` = suggestions filtered by `draft` (**empty draft ⇒ all of them**),
  minus already-selected, `.slice(0, 8)`, shown when `focused`. This is the "click and it suggests"
  ask.
- Frequency order is free: `get_tag_distribution` already `order_by(func.count().desc())`
  (`item_service.py:632`) and `.filter()` preserves order — just don't re-sort.
- Floating list: wrap the `Input` in a `relative` div and render the list as
  `absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-md border bg-popover shadow-md`, one
  `<button>` per row with the tag left and `count` right in `text-muted-foreground`. Keep the
  existing `onMouseDown={e => e.preventDefault()}` trick so blur doesn't commit the partial draft
  first. Close on blur and on `Escape`.

No `Popover` here — the list is anchored to an input it must not steal focus from; `absolute` is
smaller and behaves better. Inside the detail dialog's scroll container the list scrolls with the
form, which is fine at `max-h-56`.

## 4. Tags on the wardrobe card

New `frontend/components/ui/popover.tsx` (shadcn default: `Popover`, `PopoverTrigger`,
`PopoverContent`) on `@radix-ui/react-popover`.

In `ItemCard` (`app/dashboard/wardrobe/page.tsx:221-252`), under the name/type row, when
`item.user_tags?.length`:

- One non-wrapping row: the first **2** tags as `Badge variant="secondary"` (`text-[10px]`,
  `truncate max-w-[6rem]`), then a `+N` badge as the `PopoverTrigger` when more remain.
  Fixed 2 rather than measured fit — `# ponytail: fixed 2 visible tags, measure with ResizeObserver
  only if the truncation looks bad at real widths`.
- `PopoverContent` lists every tag as badges. Trigger gets `onMouseEnter` → open (hover) plus the
  native click/touch toggle, and `onClick={e => { e.stopPropagation(); e.preventDefault(); }}` — the
  whole card is a click target that opens the detail dialog, the same guard `ImageCarousel` needed.
- Radix portals the content, so the card's `overflow-hidden` does not clip it.

## 5. Multi-select type filter

Default = all types selected = no `type` constraint sent, i.e. today's behaviour with a different
control.

**Backend**
- `ItemFilter.types: list[str] | None = None` (`schemas/item.py:215`); in `get_list`,
  `if filters.types: query = query.where(ClothingItem.type.in_(filters.types))` beside the existing
  single `filters.type` check (`item_service.py:59`). Leave `type` in place — other callers still
  pass it.
- `GET /items` gains `types: str | None = None`, split on comma like `colors`/`tags`
  (`items.py:112-113`).
- **Bulk parity (required, not optional):** `BulkFilters.type: str | None` → `types: list[str] | None`
  (`schemas/item.py:257`), and `ItemService.get_ids_by_filter(type_filter=...)` → `types` with
  `.in_()` (`item_service.py:121-132`), updated at both call sites (`items.py:496`, `:549`).
  Without this, "select all matching" + bulk delete would ignore the type filter and delete beyond
  what is on screen.
  Pre-existing and *not* fixed here: `get_ids_by_filter` also ignores `tags`, `favorite` and
  `needs_wash`, so select-all already over-selects for those. Worth a follow-up.

**Frontend** — [app/dashboard/wardrobe/page.tsx](../../frontend/app/dashboard/wardrobe/page.tsx)
- `typeFilter: string[]` (empty ⇒ all). Init from `?types=a,b`, falling back to the legacy `?type=x`
  single value so existing links keep working; URL sync writes `types`.
- Control: `Popover` (from §4) with a `Checkbox` row per `useClothingTypes()` entry plus
  "Select all" / "Select none" buttons; trigger `Button` labels `allTypes` / the single type's label
  / `typesSelected {count}`. Reuses `Checkbox` and `Button`; no new component and no
  `DropdownMenuCheckboxItem` to add.
  Note "none selected" means *no filter*, same as all — do not send an empty `types` param.
- Follow `typeFilter` through its five other uses: the query `filters` (`:402`), `activeFilterCount`
  (`:415`), the selection-reset effect (`:452`), the bulk `select_all` filters (`:525`), the
  empty-state condition (`:825`), and both clear-filters buttons.
- `useItems` param builder: `if (filters.types?.length) params.types = filters.types.join(',')`
  (`lib/hooks/use-items.ts:35`); `BulkOperationParams.filters.type` → `types?: string[]`
  (`use-items.ts:667`).

## 6. Fit / Fill toggle for card images

Frontend only, no backend, no migration, no preference column — a per-device toggle in
`localStorage`, defaulting to **contain** (nothing cropped, which is the ask).

- [app/dashboard/wardrobe/page.tsx](../../frontend/app/dashboard/wardrobe/page.tsx):
  `imageFit: 'contain' | 'fill'` state initialised from `localStorage['wardrobe-image-fit']`,
  persisted in a `useEffect`, both wrapped in the same `typeof window` + `try/catch` pattern the
  `dismissedErrors` state already uses at `:345-364` (private browsing / quota just loses the
  preference).
- Icon `Button` beside the filters button at `:688-700`, `variant={imageFit === 'fill' ? 'default'
  : 'outline'}`, lucide `Crop` icon, title from i18n.
- Passed to `ItemCard` → `ImageCarousel`'s **existing** `className` prop (`object-contain` /
  `object-fill`), which already defaults to `object-cover`. No change to `image-carousel.tsx`.
- Note the trade: `object-fill` **stretches** the photo to the square box (distorts), it doesn't
  crop like today's `object-cover`. That's what was asked for; if the distortion looks wrong on
  real photos, changing `'object-fill'` to `'object-cover'` is a one-word revert.
- Scope: the wardrobe grid only. The detail dialog keeps `object-cover` — it's a bigger box and
  nobody complained about it.

## 7. Hover auto-advance on multi-image cards

In `ItemCard` only (~12 lines); `ImageCarousel` is untouched — it already accepts controlled
`index` / `onIndexChange`.

- `const [imgIndex, setImgIndex] = useState(0)` in `ItemCard`, passed to `ImageCarousel`.
- `onMouseEnter` / `onMouseLeave` on the existing `<div className="relative aspect-square bg-muted">`
  at `wardrobe/page.tsx:110` set a `hovering` flag; leaving resets `imgIndex` to 0.
- `useEffect`: when `hovering && carouselImages.length > 1`, `setInterval(() => setImgIndex(i => (i
  + 1) % n), 1200)`, cleared on unmount/leave.
- Guard the enter handler with `window.matchMedia('(hover: hover)').matches` so a tap on mobile
  doesn't start a timer behind the opening detail dialog.
- Only the active slide is mounted (deliberate — see the previous plan), so the first cycle fetches
  each thumbnail as it appears; expect one brief flash per image on the first hover, cached after.
  `# ponytail: no prefetch, add a hidden <link rel=prefetch> pass only if the first cycle looks bad`

---

## i18n

English only — `i18n/request.ts` falls back per namespace. New keys:
`wardrobe.addItem.tagsLabel` + placeholder, `wardrobe.addItem.imageCountHint`,
`wardrobe.addItem.extraImagesFailed`, `wardrobe.selectAll`, `wardrobe.selectNone`,
`wardrobe.typesSelected`, `wardrobe.moreTags`, `wardrobe.imageFit.contain`, `wardrobe.imageFit.fill`.
Run `npm run i18n:check` (note: `i18n:scan` has a
pre-existing Windows path bug documented in the previous plan; `i18n:keys` / `i18n:parity` are the
ones that must pass).

## Verification

Backend, appended to `backend/tests/test_items.py`:
1. `POST /items` (multipart) with `user_tags=" Summer ,summer,"` creates an item with
   `user_tags == ["summer"]`.
2. `GET /items?types=shirt,pants` returns only those two types; omitting `types` returns everything;
   a stale `?type=shirt` still filters to shirts.
3. `POST /items/bulk/delete` with `select_all` and `filters.types=["shirt"]` deletes only shirts —
   the over-deletion regression.

Run: `docker compose exec backend pytest tests/test_items.py` (no migration in this batch).

Frontend: `npm test`, `npm run i18n:check`, `npm run build`.

By hand: drop 4 photos into the single-item tab, type two tags, submit → one item with the first
photo primary, 3 additional images in the detail dialog's strip, both tags on it; click the empty
tag filter → the full tag list appears with counts, most-used first, floating over the row without
shifting it; a 5-tag item's card shows 2 badges + `+3` that opens on hover and on tap without
opening the detail dialog; deselect all but two types → the grid narrows, the URL carries `types=`,
a refresh preserves it, and "select all → delete" removes only those two types' items.

For §6/§7 specifically: a portrait photo shows whole (bars top and bottom) by default, the toggle
stretches it edge to edge, and the choice survives a reload; hovering a 3-image card cycles all
three and snaps back to the primary on leave, while a 1-image card does nothing and a tap on a phone
opens the dialog without starting a cycle.
