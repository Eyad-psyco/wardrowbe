import logging
from uuid import UUID

logger = logging.getLogger(__name__)

ITEM_ROLE: dict[str, str] = {
    "shirt": "base_top",
    "t-shirt": "base_top",
    "blouse": "base_top",
    "polo": "base_top",
    "tank-top": "base_top",
    "top": "base_top",
    "sweater": "base_top",
    "pants": "bottom",
    "jeans": "bottom",
    "shorts": "bottom",
    "skirt": "bottom",
    "dress": "full_body",
    "jumpsuit": "full_body",
    "cardigan": "mid_layer",
    "vest": "mid_layer",
    "jacket": "outer_layer",
    "blazer": "outer_layer",
    "coat": "outer_layer",
    "hoodie": "outer_layer",
    "shoes": "footwear",
    "sneakers": "footwear",
    "boots": "footwear",
    "sandals": "footwear",
    "socks": "socks",
    "tie": "neckwear",
    "hat": "accessory",
    "scarf": "accessory",
    "belt": "accessory",
    "bag": "accessory",
    "accessories": "accessory",
}


ALLOWED_TYPE_ICONS = frozenset({
    "Shirt", "ShoppingBag", "Footprints", "Watch", "Glasses", "Crown", "Gem",
    "Umbrella", "Scissors", "Palette", "Star", "Heart", "Tag", "Layers",
    "Package", "Sparkles", "Backpack", "Briefcase", "Gift", "CircleDot",
})


def custom_type_roles(preferences) -> dict[str, str]:
    """Body-slot role for every custom type that declares one.

    Types with role=None are deliberately absent, so a `.get()` against this map
    falls through to ITEM_ROLE and then to the unknown-type path.
    """
    roles: dict[str, str] = {}
    for entry in getattr(preferences, "custom_item_types", None) or []:
        value, role = entry.get("value"), entry.get("role")
        if value and role:
            roles[value] = role
    return roles


def outfit_excluded_types(preferences) -> set[str]:
    """Custom types with no body slot - never offered to outfits or the vision model."""
    return {
        entry["value"]
        for entry in (getattr(preferences, "custom_item_types", None) or [])
        if entry.get("value") and not entry.get("role")
    }


def custom_type_wash_intervals(preferences) -> dict[str, int]:
    """Per-type default wash interval declared by the user's custom types."""
    return {
        entry["value"]: entry["wash_interval"]
        for entry in (getattr(preferences, "custom_item_types", None) or [])
        if entry.get("value") and entry.get("wash_interval")
    }


def deduplicate_by_body_slot(
    item_ids: list[UUID],
    item_type_map: dict[UUID, str],
    role_overrides: dict[str, str] | None = None,
) -> list[UUID]:
    overrides = role_overrides or {}

    def role_of(item_type: str) -> str | None:
        return overrides.get(item_type) or ITEM_ROLE.get(item_type)

    seen_roles: dict[str, UUID] = {}
    result: list[UUID] = []
    has_full_body = any(role_of(item_type_map.get(iid, "")) == "full_body" for iid in item_ids)
    for iid in item_ids:
        item_type = item_type_map.get(iid, "")
        role = role_of(item_type)
        if not role:
            result.append(iid)
            continue
        if role == "accessory":
            result.append(iid)
            continue
        if has_full_body and role in ("base_top", "bottom"):
            logger.warning(f"Removing {item_type} item {iid}: full_body item present")
            continue
        if role in seen_roles:
            logger.warning(
                f"Removing duplicate {role} item {iid} ({item_type}): "
                f"role already filled by {seen_roles[role]}"
            )
            continue
        seen_roles[role] = iid
        result.append(iid)
    return result


_CANONICAL_ROLE_ORDER = [
    "full_body",
    "base_top",
    "mid_layer",
    "outer_layer",
    "bottom",
    "footwear",
    "socks",
    "neckwear",
    "accessory",
]

_ROLE_SORT_INDEX: dict[str, int] = {role: idx for idx, role in enumerate(_CANONICAL_ROLE_ORDER)}

# The body slots a custom clothing type may claim, and the built-in type vocabulary
# a custom type may not collide with. Both derive from the tables above so there is
# exactly one place to add a slot or a built-in type.
BODY_SLOTS: frozenset[str] = frozenset(_CANONICAL_ROLE_ORDER)
BUILTIN_ITEM_TYPES: frozenset[str] = frozenset(ITEM_ROLE)


def canonical_item_order(
    item_ids: list[UUID],
    item_type_map: dict[UUID, str],
    role_overrides: dict[str, str] | None = None,
) -> list[UUID]:
    original_positions = {iid: idx for idx, iid in enumerate(item_ids)}
    overrides = role_overrides or {}

    def sort_key(item_id: UUID) -> tuple[int, int]:
        item_type = item_type_map.get(item_id, "")
        role = overrides.get(item_type) or ITEM_ROLE.get(item_type)
        role_idx = (
            _ROLE_SORT_INDEX.get(role, len(_CANONICAL_ROLE_ORDER))
            if role
            else len(_CANONICAL_ROLE_ORDER)
        )
        return (role_idx, original_positions[item_id])

    return sorted(item_ids, key=sort_key)
