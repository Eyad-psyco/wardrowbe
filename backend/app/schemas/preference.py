from pydantic import BaseModel, Field, field_validator

from app.utils.clothing import BODY_SLOTS, BUILTIN_ITEM_TYPES


class CustomItemType(BaseModel):
    value: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,49}$", description="Slug stored on the item")
    label: str = Field(min_length=1, max_length=50, description="Display name")
    # None => excluded from outfit suggestions AND from AI type detection
    role: str | None = Field(default=None, description=f"Body slot, one of {sorted(BODY_SLOTS)}")
    wash_interval: int | None = Field(
        default=None, ge=1, le=100, description="Default wears between washes for this type"
    )

    @field_validator("role")
    @classmethod
    def _known_role(cls, v: str | None) -> str | None:
        if v is not None and v not in BODY_SLOTS:
            raise ValueError(f"role must be null or one of {sorted(BODY_SLOTS)}")
        return v

    @field_validator("value")
    @classmethod
    def _not_builtin(cls, v: str) -> str:
        if v in BUILTIN_ITEM_TYPES:
            raise ValueError(f"'{v}' is already a built-in clothing type")
        return v


def _reject_duplicate_types(v: list[CustomItemType] | None) -> list[CustomItemType] | None:
    if v is None:
        return None
    values = [t.value for t in v]
    if len(values) != len(set(values)):
        raise ValueError("custom_item_types contains duplicate values")
    return v


class AIEndpoint(BaseModel):
    name: str = Field(description="Display name for this endpoint")
    url: str = Field(description="Base URL for the AI API (e.g., http://localhost:11434/v1)")
    vision_model: str = Field(default="moondream", description="Model for image analysis")
    text_model: str = Field(default="phi3:mini", description="Model for text generation")
    enabled: bool = Field(default=True, description="Whether this endpoint is active")


class StyleProfile(BaseModel):
    casual: int = Field(default=50, ge=0, le=100, description="Casual style preference 0-100")
    formal: int = Field(default=50, ge=0, le=100, description="Formal style preference 0-100")
    sporty: int = Field(default=50, ge=0, le=100, description="Sporty style preference 0-100")
    minimalist: int = Field(
        default=50, ge=0, le=100, description="Minimalist style preference 0-100"
    )
    bold: int = Field(default=50, ge=0, le=100, description="Bold/statement style preference 0-100")


class PreferenceBase(BaseModel):
    # Color preferences
    color_favorites: list[str] = Field(default_factory=list, description="Favorite colors")
    color_avoid: list[str] = Field(default_factory=list, description="Colors to avoid")

    # Style preferences
    style_profile: StyleProfile = Field(default_factory=StyleProfile)

    # Occasion settings
    default_occasion: str = Field(
        default="casual", description="Default occasion for recommendations"
    )

    # Temperature/comfort
    temperature_unit: str = Field(
        default="celsius",
        pattern="^(celsius|fahrenheit)$",
        description="Preferred temperature display unit",
    )
    temperature_sensitivity: str = Field(
        default="normal",
        pattern="^(low|normal|high)$",
        description="Temperature sensitivity level",
    )
    cold_threshold: int = Field(
        default=10, ge=-20, le=30, description="Temperature (C) considered cold"
    )
    hot_threshold: int = Field(
        default=25, ge=10, le=45, description="Temperature (C) considered hot"
    )
    layering_preference: str = Field(
        default="moderate",
        pattern="^(minimal|moderate|heavy)$",
        description="Layering preference",
    )

    # Recommendation settings
    avoid_repeat_days: int = Field(
        default=7, ge=0, le=30, description="Days before repeating items"
    )
    prefer_underused_items: bool = Field(default=True, description="Prioritize less worn items")
    variety_level: str = Field(
        default="moderate",
        pattern="^(low|moderate|high)$",
        description="Outfit variety preference",
    )

    # AI Settings
    ai_endpoints: list[AIEndpoint] = Field(
        default_factory=list,
        description="AI endpoints in priority order (first available is used)",
    )

    # User-defined clothing types
    custom_item_types: list[CustomItemType] = Field(default_factory=list)

    @field_validator("custom_item_types")
    @classmethod
    def _unique_types(cls, v: list[CustomItemType]) -> list[CustomItemType]:
        return _reject_duplicate_types(v)


class PreferenceCreate(PreferenceBase):
    pass


class PreferenceUpdate(BaseModel):
    color_favorites: list[str] | None = None
    color_avoid: list[str] | None = None
    style_profile: StyleProfile | None = None
    default_occasion: str | None = None
    temperature_unit: str | None = Field(default=None, pattern="^(celsius|fahrenheit)$")
    temperature_sensitivity: str | None = Field(default=None, pattern="^(low|normal|high)$")
    cold_threshold: int | None = Field(default=None, ge=-20, le=30)
    hot_threshold: int | None = Field(default=None, ge=10, le=45)
    layering_preference: str | None = Field(default=None, pattern="^(minimal|moderate|heavy)$")
    avoid_repeat_days: int | None = Field(default=None, ge=0, le=30)
    prefer_underused_items: bool | None = None
    variety_level: str | None = Field(default=None, pattern="^(low|moderate|high)$")
    ai_endpoints: list[AIEndpoint] | None = None
    custom_item_types: list[CustomItemType] | None = None

    @field_validator("custom_item_types")
    @classmethod
    def _unique_types(cls, v: list[CustomItemType] | None) -> list[CustomItemType] | None:
        return _reject_duplicate_types(v)


class PreferenceResponse(PreferenceBase):
    class Config:
        from_attributes = True
