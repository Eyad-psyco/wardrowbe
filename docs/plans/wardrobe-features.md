# Eight wardrobe features

## Progress

Tick as each lands. Ordered by dependency — later items assume earlier ones.

- [x] **§1 Migration** — `user_tags`, `is_public`, `custom_item_types` (one file)
- [x] **§2 Feature 6** — drop the worn-before-wash requirement
- [x] **§3 Feature 7** — secondary colors (multiple colors per item)
  - [x] extract `ColorPicker` to `components/color-picker.tsx`
  - [x] secondary-color multi-select in the item edit form
  - [x] show all colors in read-only view + wardrobe card
- [x] **§4 Feature 2** — free-text tags with suggestions
  - [x] `user_tags` column, schemas, normalizing validator
  - [x] `GET /items/tags` + tag filter on `GET /items`
  - [x] `components/tag-input.tsx` + wire into edit form
  - [x] tag filter on the wardrobe page
- [x] **§5 Feature 3** — bulk image upload per item + ordering
  - [x] multi-file `POST /items/{id}/images`, `max_item_images` config
  - [x] dropzone on the thumbnail strip
  - [x] native drag-reorder, incl. drop-on-primary
- [x] **§6 Feature 4** — card thumbnail carousel
  - [x] extract `components/image-carousel.tsx`
  - [x] use it in `ItemCard` and the detail dialog
- [x] **§7 Feature 5** — private / public items
  - [x] `is_public` column + schemas + toggle UI
  - [x] `GET /items?user_id=` family gate + public `GET /items/{id}`
  - [x] "whose wardrobe" switcher + `readOnly` detail dialog
- [x] **§8 Feature 1** — custom clothing types from settings
  - [x] `CustomItemType` schema + validators
  - [x] body-slot `role_overrides` through the 3 call sites
  - [x] outfit exclusion for `role=None`
  - [x] per-user AI type vocabulary
  - [x] per-type default wash interval
  - [x] settings UI card + `useClothingTypes()` merge
- [x] **§9 Feature 8** — convert uploads to WebP
- [x] i18n keys + `npm run i18n:check`
- [x] verification pass (§ Verification)

### Deviations from the plan

- **`db.refresh(item)` was already broken.** Dropping the wash guard (§2) exposed it: the
  wash/wear/rotate/set-primary routes all called `await db.refresh(item)` before
  `ItemResponse.model_validate(item)`, which expires the eager-loaded `additional_images`
  and 422s on the lazy load. Replaced at all four call sites with one
  `_reloaded_response()` helper in `api/items.py`. The write always succeeded; only the
  response failed, which is why no test caught it.
- **`custom_type_roles(user.preferences)` can't be read off a lazy relationship.**
  `StudioService` and `PairingService` fetch the row with `db.get(UserPreference, user.id)`
  instead — free on the request path (identity map), safe off it. `role_overrides` params
  were still added to `utils/clothing` as planned; only the studio helper's signature
  changed (it takes `user` and is now `async`).
- **Body slots and the built-in type list are derived, not retyped.** `BODY_SLOTS` comes
  from `_CANONICAL_ROLE_ORDER` and `BUILTIN_ITEM_TYPES` from `ITEM_ROLE`, so the schema
  validator can't drift from the tables it validates against.
- **Shared view gets `components/pagination.tsx`**, not the bulk toolbar — hiding the
  toolbar (as planned) would otherwise have hidden the pager it carries.
- **`npm run i18n:scan` fails on a pre-existing, unrelated finding:** `components/ui/dialog.tsx`
  is in the script's `SKIP_DIRS`, but the check compares `'components/ui'` against a
  Windows path (`components\ui`), so the shadcn primitives get walked on Windows only.
  `i18n:keys` and `i18n:parity` pass.

## Context

Eight user-requested additions to Wardrowbe. Four are near-free because the schema or an existing
component already covers them; four need real work. Ordered by dependency, not by request number.

Already in place — do not rebuild:
- `clothing_items.colors ARRAY(String)` exists and is already wired through `ItemUpdate` /
  `ItemResponse`. **Feature 7 (secondary colors) is frontend-only, no migration.**
- `item_images` table with `position`, plus `PATCH /items/{id}/images/reorder` and
  `POST /items/{id}/images/{image_id}/set-primary`. **Feature 3 needs a multi-file param and a
  drag UI, not new endpoints.**
- `additional_images` is already eager-loaded in `ItemService.get_list` and present on every
  `ItemResponse`. **Feature 4 (card carousel) needs zero backend work.**
- A hand-rolled carousel already exists at
  [item-detail-dialog.tsx:415-458](frontend/components/item-detail-dialog.tsx#L415-L458) — extract it,
  don't write a second one.
- A swatch-toggle multi-select `ColorPicker` already exists at
  [settings/page.tsx:70-139](frontend/app/dashboard/settings/page.tsx#L70-L139) — extract it.

One migration covers all three schema changes. Head is `b1c2d3e4f5a6`; `revision: str = "..."`
annotated form is required by `backend/scripts/check_migration_heads.py`.

---

## 1. Migration (single file)

`backend/migrations/versions/<rev>_add_tags_visibility_custom_types.py`, `down_revision = "b1c2d3e4f5a6"`:

- `clothing_items.user_tags ARRAY(String)`, `nullable=False`, `server_default="{}"` + GIN index
  `idx_clothing_items_user_tags` (mirrors the existing GIN on `colors` in `001_initial_schema.py`).
- `clothing_items.is_public BOOLEAN`, `nullable=False`, `server_default=sa.false()` — existing
  items become private, which is the requested default.
- `user_preferences.custom_item_types JSONB`, `nullable=False`, `server_default="[]"`.

---

## 2. Feature 6 — drop the worn-before-wash requirement

Delete the guard at [items.py:963-967](backend/app/api/items.py#L963-L967). Nothing else: there is
no client-side guard, and no test asserts the 400.

---

## 3. Feature 7 — secondary colors (frontend only)

- Extract `ColorPicker` from [settings/page.tsx:70-139](frontend/app/dashboard/settings/page.tsx#L70-L139)
  into `frontend/components/color-picker.tsx` unchanged; import it back into settings.
- In the edit form of [item-detail-dialog.tsx](frontend/components/item-detail-dialog.tsx), below the
  existing primary-color `Select`, add a "Secondary colors" `ColorPicker` bound to new
  `editForm.secondary_colors`, hydrated as `item.colors.filter(c => c !== item.primary_color)`.
- On save send `colors: [primary, ...secondary]` deduped, alongside the existing `primary_color`.
  Send `colors` only, never `tags` — `ItemService.update` mirrors `tags` → columns and the two would
  fight. `tags.colors` staying stale matches today's behaviour for `primary_color`.
- Show all colors (not just primary) as dots in the read-only view and in the wardrobe card tooltip
  at [wardrobe/page.tsx:214-228](frontend/app/dashboard/wardrobe/page.tsx#L214-L228).

---

## 4. Feature 2 — free-text tags with suggestions

**Backend**
- `ClothingItem.user_tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)` in
  [models/item.py](backend/app/models/item.py) near `colors`.
- `schemas/item.py`: `user_tags: list[str] | None` on `ItemCreate` / `ItemUpdate`,
  `user_tags: list[str] = Field(default_factory=list)` on `ItemResponse`;
  `tags: list[str] | None` on `ItemFilter`.
- `ItemService`: add `get_tag_distribution(user_id)` — copy `get_color_distribution`
  ([item_service.py:563-578](backend/app/services/item_service.py#L563-L578)) with `user_tags`.
  In `get_list`, add `ClothingItem.user_tags.overlap(filters.tags)` next to the existing `colors`
  overlap, and add `ClothingItem.user_tags.any(filters.search, operator=operators.ilike_op)` to the
  search `or_`.
- Normalize on write: lowercase, strip, dedupe, drop empties, cap length 30 / count 20. Do it in a
  Pydantic `field_validator` on `ItemCreate`/`ItemUpdate` so both routes get it for free.
- `GET /items/tags` next to `GET /items/colors` ([items.py:664](backend/app/api/items.py#L664)),
  returning `[{tag, count}]`. Add `"user_tags"` to `TAG_WRITEBACK_FIELDS`? **No** — that set marks
  an item AI-tagged; user tags are not AI attributes.
- `tags: str | None` (csv) query param on `GET /items`, split like `colors`.

**Frontend**
- New `frontend/components/tag-input.tsx`: `Input` + `Badge` chips with an X, and a filtered
  suggestion list rendered below the input from the `/items/tags` query. ~40 lines, no new
  dependency — `cmdk`/`Command` is not installed and is not worth adding; a native `<datalist>`
  is free but behaves badly on mobile Safari, and this app is mobile-conscious.
  Enter / comma commits, Backspace on empty removes the last chip.
- `useItemTags()` in [use-items.ts](frontend/lib/hooks/use-items.ts) mirroring `useColorDistribution`.
- Wire into the edit form in `item-detail-dialog.tsx`, show chips in the read-only view, and add a
  tag filter to the wardrobe page filter row (URL-synced like the existing filters).
- `Item.user_tags: string[]` in [lib/types.ts](frontend/lib/types.ts).

---

## 5. Feature 3 — bulk image upload per item + ordering

**Backend** — [items.py:1389-1454](backend/app/api/items.py#L1389-L1454)
- `image: UploadFile = File(...)` → `images: list[UploadFile] = File(...)`; loop, assigning
  `position = current_count + i`.
- Replace the hardcoded `if current_count >= 4` with `settings.max_item_images` (new field in
  [config.py](backend/app/config.py), default 20, beside `max_bulk_upload_count`). Reject the batch
  if `current_count + len(images) > cap`.
- Response becomes `AddImagesResponse { images: list[ItemImageResponse], errors: list[str] }` so one
  corrupt file in twenty doesn't discard the batch and doesn't get silently swallowed. Per-file
  failures append `f"{filename}: {reason}"`.
- No idempotency key / no IndexedDB queue (decided): a closed tab mid-upload loses the remaining
  files. Mark it: `# ponytail: non-durable, reuse lib/upload-queue.ts if losing a batch matters`.

**Frontend** — thumbnail strip at
[item-detail-dialog.tsx:466-533](frontend/components/item-detail-dialog.tsx#L466-L533)
- `useAddItemImage` takes `files: File[]`, appends each as `images`; the hidden `<input>` gets
  `multiple`. Wrap the strip in a `react-dropzone` (already a dependency) so files can be dropped
  straight onto it. Toast `errors`.
- Reordering: native HTML5 drag — `draggable`, `onDragStart`, `onDragOver`, `onDrop` on each thumb.
  No drag library; none is installed and none is needed for a single-row list.
  On drop, update local order optimistically, then call the existing reorder endpoint via a new
  `useReorderItemImages` hook.
  - Dropping onto index 0 (the primary slot) calls `set-primary` instead of `reorder`, since the
    primary image lives on `clothing_items`, not in `item_images`. That is what makes "order them as
    I see fit" actually include the first position.
- Bump the `< 4` gate at [line 509](frontend/components/item-detail-dialog.tsx#L509) to the new cap;
  expose it via the existing `useFeatures()`/capabilities response rather than hardcoding twice.

---

## 6. Feature 4 — card thumbnail carousel

- New `frontend/components/image-carousel.tsx`: props `{ images: {id: string; url: string}[];
  alt: string; className?: string }`. Body is the block already written at
  [item-detail-dialog.tsx:415-458](frontend/components/item-detail-dialog.tsx#L415-L458), lifted
  as-is: arrows when `length > 1`, dot indicators, `next/image fill`.
  Add `e.stopPropagation()` + `e.preventDefault()` on arrows and dots — on the wardrobe card the
  whole tile is a click target that opens the detail dialog.
- `ItemCard` at [wardrobe/page.tsx:94-107](frontend/app/dashboard/wardrobe/page.tsx#L94-L107) renders
  it with `[thumbnail_url, ...additional_images.map(thumbnail_url)]`. Single-image items get the
  identical markup as today (no arrows, no dots).
- Replace the inline IIFE in `item-detail-dialog.tsx` with the same component, keeping its
  controlled `activeImageIndex` (the thumbnail strip drives it) — so the component takes optional
  `index` / `onIndexChange` and falls back to internal state when they're absent.
- Non-active slides are simply not mounted, so a 100-item page does not fetch 500 images.

---

## 7. Feature 5 — private / public items

**Backend**
- `ClothingItem.is_public: Mapped[bool] = mapped_column(Boolean, default=False)`;
  `is_public` on `ItemUpdate` and `ItemResponse`; `is_public: bool | None` on `ItemFilter` with the
  obvious `if` in `get_list`.
- `GET /items` gains `user_id: UUID | None`. When present and `!= current_user.id`:
  require `current_user.family_id is not None and target.family_id == current_user.family_id`
  (404 otherwise, not 403 — don't confirm the user exists), then force
  `filters.is_public = True` and `filters.is_archived = False`. Pass `user_id=target_id` into
  `get_list`, which is already parameterized by owner.
- `GET /items/{item_id}`: on owner-scoped miss, fall back to a lookup by id that allows the item if
  `is_public` and the owner shares the viewer's family. Needed so the deep-link `?item=<id>` path
  and `useItem()` work in the shared view. ~10 lines in the route; no service change beyond a
  `get_public_by_id(item_id, family_id)` helper.
- Leave `/items/{id}/history`, `/wear-stats`, `/wash-history`, and every mutation owner-scoped —
  they 404 for other members, which is correct.
- Note, not fixing: [images.py:47-59](backend/app/api/images.py#L47-L59) already grants any
  same-family user access to any image path. Storage filenames are timestamp + 8 random hex so they
  aren't enumerable, and tightening it costs a DB lookup per image request. Flagging it because
  "private by default" now implies a promise that layer doesn't strictly keep.

**Frontend**
- Toggle in the item edit form and in the read-only view header (a `Switch` + lock/users icon),
  writing `is_public` via the existing `useUpdateItem`. A small badge on the wardrobe card for
  public items.
- "Whose wardrobe" `Select` at the top of [wardrobe/page.tsx](frontend/app/dashboard/wardrobe/page.tsx),
  populated from `useFamily()` (`family.members`, already fetched on the family page) and hidden
  entirely when the user has no family. Selecting a member sets `ownerId` state, URL-synced with the
  existing filter params, and appends `user_id` to the items query key + query string.
- When `ownerId !== me`: hide the add-item button, the selection `Checkbox`es, the bulk toolbar, and
  the processing/error retry overlays; open `ItemDetailDialog` with a new `readOnly` prop that hides
  the edit pencil, all action buttons, and passes `enabled: false` to the wear/wash-history queries.
- No bulk public/private toggle in this pass — per-item was the ask. The bulk toolbar already exists
  if it turns out to be needed for a big existing wardrobe.

---

## 8. Feature 1 — custom clothing types from settings

The deepest change: `type` is a bare `String(50)` today, with four disagreeing hardcoded lists
([ai_service.py:54](backend/app/services/ai_service.py#L54),
[utils/clothing.py:6](backend/app/utils/clothing.py#L6),
[schemas/item.py:11](backend/app/schemas/item.py#L11),
[prompts/clothing_analysis.txt:6](backend/app/prompts/clothing_analysis.txt#L6)) and
[lib/types.ts:159](frontend/lib/types.ts#L159) on the client. No taxonomy table — custom types live
in `UserPreference`, which is already the per-user settings store and already has a settings UI.

**Shape** — `schemas/preference.py`:
```python
BODY_SLOTS = {"base_top", "bottom", "full_body", "mid_layer", "outer_layer",
              "footwear", "socks", "neckwear", "accessory"}

class CustomItemType(BaseModel):
    value: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,49}$")
    label: str = Field(min_length=1, max_length=50)
    role: str | None = None            # None => excluded from outfits AND from AI detection
    wash_interval: int | None = Field(None, ge=1, le=100)
```
`role=None` is the lingerie case: one toggle in the UI ("include in outfit suggestions"), off means
the type gets no body slot, is never offered to the vision model, and items of that type are dropped
from outfit candidate sets. Add `custom_item_types: list[CustomItemType]` to `PreferenceBase` and
`PreferenceUpdate`, plus a validator rejecting duplicate `value`s, `role` outside `BODY_SLOTS`, and
collisions with the 30 built-in types.

**Body-slot role** — [utils/clothing.py](backend/app/utils/clothing.py)
- `deduplicate_by_body_slot` and `canonical_item_order` take
  `role_overrides: dict[str, str] | None = None`; every `ITEM_ROLE.get(t)` becomes
  `(role_overrides or {}).get(t) or ITEM_ROLE.get(t)`. Existing behaviour for unknown types
  (kept, sorted last) is untouched, so nothing regresses.
- Three call sites, prefs already in scope or one hop away:
  [recommendation_service.py:582](backend/app/services/recommendation_service.py#L582) (prefs at
  `:692`, carried on the existing `RecommendationContext.preferences`),
  [pairing_service.py:269](backend/app/services/pairing_service.py#L269) (prefs at `:199`),
  [studio_service.py:81](backend/app/services/studio_service.py#L81) (`_order_items_canonically`
  gains a `role_overrides` param; its callers all take `user: User`, whose `preferences` is
  eager-loaded by `get_current_user`).
- One helper — `custom_type_roles(prefs) -> dict[str,str]` and
  `outfit_excluded_types(prefs) -> set[str]` — in `utils/clothing.py`, so the three services don't
  each reimplement the `role is None` rule.

**Outfit exclusion (role=None)**
- [recommendation_service.py:110-111](backend/app/services/recommendation_service.py#L110-L111) —
  one more in-Python filter beside the existing `needs_wash` / unknown-type ones.
- [pairing_service.py:52-62](backend/app/services/pairing_service.py#L52-L62) — `get_available_items`
  reads `user.preferences` itself (it's already an eager-loaded attribute) and applies the same
  filter. Note this function honours neither `needs_wash` nor `excluded_item_ids` today; not fixing
  that here, just don't copy the omission.

**AI detection**
- `AIService.__init__` gains `custom_types: list[dict] | None = None`
  ([ai_service.py:261](backend/app/services/ai_service.py#L261)). Store
  `self._valid_types = VALID_TYPES | {t["value"] for t in custom_types if t.get("role")}` and
  `self._tagging_prompt = TAGGING_PROMPT` with the enabled custom values appended to the TYPE line.
  `_parse_tags_from_response` uses `self._valid_types` instead of the module constant
  ([:427](backend/app/services/ai_service.py#L427)); `analyze_image` uses `self._tagging_prompt`
  ([:536](backend/app/services/ai_service.py#L536)). Module constants stay as the defaults, so the
  two other `AIService(...)` construction sites need no change.
- [workers/tagging.py:220-236](backend/app/workers/tagging.py#L220-L236) already loads the prefs row
  three lines above the `AIService(...)` call — pass `custom_types=prefs.custom_item_types`.

**Per-type default wash interval**
- Do *not* thread prefs into the four `DEFAULT_WASH_INTERVALS` readers
  ([schemas/item.py:160](backend/app/schemas/item.py#L160),
  [item_service.py:435](backend/app/services/item_service.py#L435),
  [outfits.py:880](backend/app/api/outfits.py#L880),
  [studio_service.py:107](backend/app/services/studio_service.py#L107)) — one of them is a Pydantic
  computed field with no db access.
- Instead materialize it: in `ItemService.create` and `ItemService.update`, when `type` is set to a
  custom type that declares a `wash_interval` and `item.wash_interval is None`, write the type's
  value onto `item.wash_interval`. Both paths already have the db session; both need the prefs row,
  which the routes' `current_user.preferences` already carries.
  `# ponytail: interval snapshotted at type-assign time; editing a type default won't
  retro-update existing items`.

**Frontend**
- New "Clothing types" `Card` in [settings/page.tsx](frontend/app/dashboard/settings/page.tsx),
  built on the AI-endpoints list pattern at
  [:1015-1245](frontend/app/dashboard/settings/page.tsx#L1015-L1245): rows of
  label + slug + role `Select` + wash-interval number input + a "use in outfit suggestions" `Switch`
  (off ⇒ `role: null`, role `Select` disabled) + delete, plus "Add type". Saved through the existing
  `useUpdatePreferences` / `hasChanges` machinery — no new mutation.
- `useClothingTypes()` in
  [use-translated-constants.ts:14-57](frontend/lib/hooks/use-translated-constants.ts#L14-L57)
  appends the user's custom types (raw `label`, no i18n lookup) after the translated built-ins. Both
  type dropdowns and the wardrobe type filter pick this up with no edits, since they already map
  over that hook's result.
- `CustomItemType` type in `lib/types.ts`, `custom_item_types` on `Preferences`.

---

## 9. Feature 8 — convert all uploads to WebP

Entirely contained in [services/image_service.py](backend/app/services/image_service.py) — the
serving route already needs **zero** changes: `FILENAME_PATTERN`
([images.py:18](backend/app/api/images.py#L18)) already whitelists `webp` and the content-type map
([images.py:83-89](backend/app/api/images.py#L83-L89)) already has it. Nothing outside
`image_service.py` constructs a `_medium` / `_thumb` / `_orig` path (verified by grep), so the
format lives in one file.

Input formats are unchanged — JPEG/PNG/WebP/HEIC in, WebP out.

- New `image_format: str = Field(default="webp")` in [config.py](backend/app/config.py) beside the
  other image knobs, so this is a switch rather than a hardcode. Module map in `image_service.py`:
  `PIL_FORMAT = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".webp": "WEBP"}`.
- `_resize_image(image, max_size, quality, fmt="WEBP")` — thread the format into the single
  `image.save(output, format=..., quality=..., optimize=True)` at
  [:84](backend/app/services/image_service.py#L84). (`optimize` is a no-op for WebP; harmless.)
- `process_and_store` ([:115](backend/app/services/image_service.py#L115),
  [:133](backend/app/services/image_service.py#L133)) — derive `ext` from `settings.image_format`
  instead of the two literal `".jpg"`s.
- **`_save_all_sizes` must derive its format from the existing `image_path` suffix, not from config**
  ([:238-265](backend/app/services/image_service.py#L238-L265)). This is the one place that can
  break data: `rotate`, `remove_background` and `restore_original` all overwrite files whose paths
  are already stored on the row, so a legacy `.jpg` item must keep regenerating `.jpg` derivatives.
  Writing `foo_medium.webp` while the DB still says `foo_medium.jpg` orphans the row and the image
  404s. New WebP items regenerate as WebP by the same rule.
- `remove_background` backup path ([:278](backend/app/services/image_service.py#L278)) —
  `f"{base_path}_orig{ext}"` with `ext` from `image_path`, same reasoning.
- Keep the existing RGBA → flatten-onto-white behaviour ([:70-77](backend/app/services/image_service.py#L70-L77))
  even though WebP supports alpha. `remove_background` composites onto a solid colour deliberately,
  and preserving transparency here would silently change what background removal produces.
- Keep the existing 95 / 90 / 88 quality numbers. WebP at those values is smaller than the JPEG it
  replaces, and re-tuning is a separate measurement job.
  `# ponytail: quality numbers carried over from JPEG, tune against real photos if size matters`
- **No backfill.** Existing `.jpg` files keep working: paths are per-row and the serve route handles
  both extensions. A converting backfill script is a separate ask, not part of this.

Tests to update: `backend/tests/test_image_undo_replace.py:75` and `:132` assert
`endswith("_orig.jpg")` → `_orig.webp`. Everything else in the suite that mentions `.jpg` is either
an *input* filename or a hand-seeded DB path, both unaffected.

---

## Files touched

Backend: one new migration; `models/item.py`, `models/preference.py`, `schemas/item.py`,
`schemas/preference.py`, `api/items.py`, `services/item_service.py`, `services/image_service.py`,
`services/ai_service.py`, `services/recommendation_service.py`, `services/pairing_service.py`,
`services/studio_service.py`, `utils/clothing.py`, `workers/tagging.py`, `config.py`.
`api/images.py` needs no change.

Frontend: new `components/tag-input.tsx`, `components/image-carousel.tsx`,
`components/color-picker.tsx`; edits to `components/item-detail-dialog.tsx`,
`app/dashboard/wardrobe/page.tsx`, `app/dashboard/settings/page.tsx`, `lib/hooks/use-items.ts`,
`lib/hooks/use-translated-constants.ts`, `lib/types.ts`, `messages/en/{items,settings,wardrobe}.json`.

i18n: add English keys only. [i18n/request.ts](frontend/i18n/request.ts) merges the English fallback
under every namespace, so the other seven locales won't break. Run `npm run i18n:check` — if
`i18n-parity` demands full coverage, copy the English strings across rather than leaving gaps.

---

## Verification

Backend, appended to `backend/tests/test_items.py` (and `test_preferences.py` for the schema
validator) — the smallest set that fails if any of this breaks:
1. `POST /items/{id}/wash` with `wears_since_wash == 0` returns 200 (was 400).
2. `PATCH /items/{id}` with `user_tags: [" Summer ", "summer", ""]` stores `["summer"]`;
   `GET /items?tags=summer` finds it; `GET /items/tags` returns `[{tag: "summer", count: 1}]`.
3. `GET /items?user_id=<other family member>` returns only their `is_public` items;
   `?user_id=<stranger>` 404s; `GET /items/{public_id}` succeeds for a family member and
   `GET /items/{private_id}` 404s.
4. `POST /items/{id}/images` with 3 files creates positions 0,1,2; a batch exceeding
   `max_item_images` 400s; one invalid file in a batch lands in `errors` while the rest are stored.
5. `PreferenceUpdate` rejects a `custom_item_types` entry colliding with a built-in type, a bad
   `role`, and duplicate `value`s.
6. `deduplicate_by_body_slot(..., role_overrides={"kimono": "outer_layer"})` drops a second
   outer-layer item — extend `backend/tests/test_clothing_utils.py`.
7. `process_and_store` with a `.jpg` input returns three `.webp` paths and the files open as WebP;
   `rotate_image("user/legacy.jpg")` still writes `legacy_medium.jpg` (not `.webp`) — the
   regression that would orphan every pre-existing row.

Run: `docker compose exec backend alembic upgrade head` then
`docker compose exec backend pytest tests/test_items.py tests/test_clothing_utils.py tests/test_preferences.py tests/test_image_undo_replace.py tests/test_background_removal.py`,
plus `alembic downgrade -1` once to prove the migration reverses.

Frontend: `npm test` (existing suite must stay green — `use-items` hook shapes change),
`npm run i18n:check`, `npm run build`.

End-to-end, by hand: add a custom type "lingerie" with the outfit toggle **off** and one with it
**on** and a role → the new type appears in the item type dropdown; tag an item, confirm the
suggestion list offers it on the next item; drag-add 6 images to one item, reorder them, drop one
onto the primary slot, confirm the wardrobe card carousel shows the new order; mark an unworn item
washed; flip one item public and view it from a second family account via the wardrobe switcher,
confirming a private item is absent; generate an outfit and confirm no `lingerie` item appears;
upload a HEIC photo and confirm the stored files are `.webp` and render, then rotate a pre-existing
`.jpg` item and confirm its thumbnail still loads.
