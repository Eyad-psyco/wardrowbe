# AI autofill, defaults, and duplicate warnings

Six asks, ordered by dependency. §1 is shared by §4 and §7.

## Progress

- [x] **§1 Migration** — `user_preferences.default_item_public`, `clothing_items.ai_excluded_fields` (one file)
- [x] **§2 AI fills every field** — extend the tagging prompt + parser + worker writeback
- [x] **§3 Auto-rotate** — EXIF transpose on store (root cause) + AI-reported rotation
- [x] **§4 Default item privacy** — preference field applied at create + settings toggle
- [x] **§5 Default image fit `cover`**
- [x] **§6 Duplicate warning** — near-duplicate scan, structured 409, "add anyway"
- [x] **§7 Per-field AI toggle in the upload modal**
- [x] **§8 AI-filled tags, from the user's own vocabulary only**
- [x] en i18n keys + `npm run i18n:check`
- [x] verification pass

---

## §1 Migration

One revision on head `e9f0a1b2c3d4`:

- `user_preferences.default_item_public BOOLEAN NOT NULL DEFAULT false` — §4.
- `clothing_items.ai_excluded_fields VARCHAR[] NOT NULL DEFAULT '{}'` — §7. The set of
  fields the user took manual control of; the tagging worker must never write them.

Why a column and not a JSONB corner: the tagging worker reads it on a different connection
from a plain `select(ClothingItem)`, and `tags` is already the AI's own output blob.

## §2 AI fills every field

Today `clothing_analysis.txt` asks for 10 keys and `ClothingTags` carries 18. `occasion`,
`brand`, `condition`, `features` are declared, parsed nowhere, and land in the `tags` JSONB
as permanent empties. `name` is never AI-filled at all.

- `clothing_analysis.txt`: add `NAME`, `BRAND`, `OCCASION`, `CONDITION`, `FEATURES` (and
  `ROTATION`, see §3) to the vocabulary block and the output JSON skeleton.
- `ai_service.py`: `VALID_OCCASIONS` / `VALID_CONDITIONS` sets, parse the six new keys in
  `_parse_tags_from_response`. `name`/`brand`/`features` are free text — length-clamped and
  stripped, not vocabulary-validated, because brand names are unbounded.
- `tagging.py`: `tags_to_item_fields` gains `name`, `brand`, `fit` (fit was computed and
  dropped). The worker's existing "only if the user left it empty" guard covers them.

## §3 Auto-rotate

Two causes, both handled:

1. **EXIF.** `_process_and_store_sync` and `compute_phash` never call
   `ImageOps.exif_transpose`, so a phone photo is stored (and hashed) sideways —
   `_preprocess_image` transposes only for the AI's copy. One call each, at the load site.
2. **Genuinely rotated garment.** Add `ROTATION` (0/90/180/270, degrees CCW needed to make
   the item upright) to the tagging prompt; the worker calls `ImageService.rotate_image`
   when it is non-zero. `rotate_image` grows a `degrees` parameter and keeps `direction`
   working for the existing manual buttons.

Rotation happens after tagging, so the stored `image_hash` is the pre-rotation one — fine,
and consistent: §6 hashes uploads before storing too.

## §4 Default item privacy

`default_item_public` on `UserPreference` + `PreferenceBase`/`PreferenceUpdate`.
`ItemService.create` already receives `preferences`, so `is_public` is set there next to
`_apply_custom_wash_interval`. Settings gets a Privacy card with one `Switch`.

## §5 Default image fit

`wardrobe/page.tsx` — the `useState` initializer and its `catch` default flip to `'cover'`;
stored `'contain'` still wins. Also adds the missing `wardrobe.imageFit.cover` key the
toggle's `title` already asks for.

## §6 Duplicate warning

Today `POST /items` hard-blocks an exact hash match with an opaque 409 string, and the
modal surfaces it as a toast with no way through.

- `find_duplicate_by_hash` also does a near-duplicate pass: exact-match query first, then a
  Hamming scan over the user's hashes within `threshold`.
- `POST /items` takes `force: bool = Form(False)`; without it the 409 detail becomes
  `{code: "duplicate_item", item: {...}, distance: n}` so the client can show the item.
- Modal catches the 409, shows the existing item's thumbnail in an `AlertDialog`, and
  "Add anyway" re-submits with `force=true`.
- Bulk keeps failing the file, but reports `existing_item_id` (the field already exists on
  `BulkUploadResult`) instead of a bare string.

## §7 Per-field AI toggle

A `Sparkles` toggle button beside Type / Name / Brand / Primary color in the single-item
tab. On = AI will fill this. Typing or picking a value turns it off automatically; clicking
it off means "leave it blank, don't let the AI touch it".

The off set posts as `ai_excluded_fields` (comma-separated form field) and is stored on the
item so the worker — running minutes later in another process — can honour it. Without the
column the worker's "fill if empty" rule would refill exactly the fields the user muted.

Only these four: they are the only single-tab inputs that map to a column the AI writes.
`notes` and `tags` are user-only already.

## §8 AI-filled tags, from the user's own vocabulary only

Tags join §7's toggle set (`user_tags`), with one extra rule: the AI may **reuse** a tag this
user has typed before and may **never** invent one. Lenient by design — most items will match
nothing, and `[]` is a correct answer.

Two layers, because a prompt is a hint and not a guarantee:

- **Offered.** `set_tag_vocabulary` replaces the prompt's `TAGS … (none)` placeholder with the
  user's own tags. It *replaces* rather than appends (unlike `extend_type_vocabulary`, which
  extends a real built-in list) — there is no global tag vocabulary, and the placeholder must not
  survive as a suggestion. A user with no tags keeps `(none)`, which reads as "always answer `[]`".
- **Enforced.** `_parse_tags_from_response` runs the model's `tags` through the existing
  `validate_list` against `self._known_tags`. Anything invented is dropped here. With an empty
  vocabulary nothing can get through at all, whatever the model says.

The worker reads the vocabulary per job from `ItemService.get_tag_distribution` (already ordered
by usage), capped at `MAX_PROMPT_TAGS = 60` so a long-lived wardrobe doesn't paste hundreds of
tags into every prompt. Writeback goes through `normalize_user_tags`, the same validator the API
write path uses, so an AI-filled list is stored in exactly the shape a typed one would be — and
the existing "only if the user left it empty" guard means tags typed in the upload modal win.

### Deviations from the plan

- **§5, the toggle's tooltip now reads `wardrobe.imageFit.fill`, not `imageFit.cover`.** The code
  was already asking for `imageFit.cover`, which exists in no locale — `fill` is the key that was
  actually shipped, and it is present in all eight. Pointing the code at the existing key fixes the
  silent fallback without adding an en-only key the other locales would never get.

- **`ItemService.create` takes `is_public` explicitly instead of reading it off `preferences`.**
  Bulk upload cannot hold the `UserPreference` ORM object across its `IntegrityError` rollback
  branch (the same expiry hazard the existing `user_id` snapshot comment documents), so it can only
  pass a plain bool. One parameter with one meaning beats two ways to set the same column.

- **Bulk upload checks duplicates at `threshold=0`, the single-item path at the default 8.**
  Near-match rejection is only safe where there is a prompt to override it. Bulk has none, so a
  fuzzy match would silently drop files — twenty similar white tees are a normal wardrobe. Bulk
  behaviour is therefore unchanged; it just names the item it matched instead of a bare string.

- **Extracted `errorMessageFrom` into `lib/api.ts`.** `useCreateItem` hand-rolled its own
  `data.detail || fallback`, which renders the new structured 409 detail as `"[object Object]"`.
  `fetchApi` already had the correct logic inline; both call the shared helper now.

- **The worker intersects `ai_excluded_fields` with a `MUTABLE_AI_FIELDS` allowlist.** Not in the
  plan: without it a malformed value (`["status"]`) would suppress the write that moves the item out
  of `processing`, stranding it until the stale sweep. Covered by a test.

- **`find_similar_by_hash` scans two columns and re-fetches the winner.** Selecting whole rows would
  eager-load every candidate's image gallery just to serialize exactly one of them.

- **`compute_tag_completeness` was left alone.** Its weights already sum to 1.0; folding the new
  fields in would shift every existing item's displayed confidence relative to new ones, for no gain
  the user asked for.

- **§8 needed no migration.** `user_tags` is an existing column and rides §7's existing
  `ai_excluded_fields`; only `MUTABLE_AI_FIELDS` had to grow.

- **§8 extended the fake session in `test_capabilities.py`.** Its `_Result` double only
  implemented `scalar_one_or_none`, and the tag-vocabulary lookup shares that session and calls
  `.all()`. A test-double gap, not a behaviour change — the test's own comment already anticipated
  the prefs lookup growing.

### Verification

Run inside the containers, per CLAUDE.md.

- `alembic upgrade head` — applied `f4a5b6c7d8e9`.
- `pytest` — 603 passed (22 new: extended-field parsing, muted fields, auto-rotation,
  duplicate 409 + force, privacy default, bulk near-match tolerance, tag vocabulary offered
  and enforced).
- `npx tsc --noEmit`, `npm run lint` — clean (only pre-existing warnings).
- `npm run i18n:keys` — every `t()` call resolves. `i18n:parity` still fails on the seven
  non-en locales, as it did before this work and as CLAUDE.md intends.
- `npm test` — 149 passed; the 7 failures are the locale-parity test, failing identically on a
  clean tree.
- Runtime check in the backend container: a JPEG tagged EXIF orientation 6 stores transposed
  (60×100 → 100×60), its upload hash matches the stored file's hash, and `rotate_image(degrees=…)`
  swaps dimensions at 90 and preserves them at 180.
