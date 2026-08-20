# Item gallery vertical thumbnails, bulk image rotate, category icons

## Progress

- [x] **§1** Vertical, scrollable thumbnail strip in the item dialog
- [x] **§2** Bulk rotate (primary + selected additional images)
  - [x] backend `RotateImagesRequest`/`RotateImagesResponse` + `/images/rotate-bulk` endpoint
  - [x] frontend `useBulkRotateImages()` hook
  - [x] per-thumbnail checkboxes + rotate toolbar in `item-detail-dialog.tsx`
- [x] **§3** Curated icon per category, shown in the wardrobe type filter
  - [x] backend `ALLOWED_TYPE_ICONS` + `CustomItemType.icon` validator
  - [x] frontend `lib/type-icons.ts` curated list + `getTypeIcon()`
  - [x] `useClothingTypes()` attaches `icon` per entry
  - [x] icon picker in settings "Clothing types" card
  - [x] icon shown in wardrobe page type-filter popover
- [x] verification pass (tsc, i18n:check, pytest, manual code review)

### Deviations from the plan

- §1: instead of a single-column vertical list, the thumbnail strip uses
  `flex flex-wrap` (fixed-size 48×48 thumbnails wrap to fill the row width across
  multiple rows) with `overflow-y-auto max-h-40` — fills available width per row,
  grows down for more rows, then scrolls. User-requested refinement after the initial
  vertical-column plan.
- Added tests: `backend/tests/test_image_undo_replace.py::TestBulkRotateImagesEndpoint`
  (4 cases: primary-only, additional-image-by-id, unknown-id-reported-as-error,
  missing-both-fields-422) and `test_preferences.py::TestCustomItemTypes` gained
  `test_rejects_unknown_icon`/`test_accepts_known_icon`.
- `docker compose exec backend pytest tests/` has 55 pre-existing failures (AI
  tagging/worker/capabilities infra) on `main` with none of this work applied —
  confirmed via `git stash`. Unrelated to §1–§3; not investigated further here.
- Not done: no in-browser manual pass (no browser tool available in this session) —
  verified via `tsc --noEmit`, `i18n:check`, and the pytest suite above only.
