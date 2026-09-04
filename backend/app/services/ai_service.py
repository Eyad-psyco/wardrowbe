import asyncio
import base64
import io
import json
import logging
import math
import re
from pathlib import Path
from typing import Literal

import httpx
from PIL import Image, ImageOps
from pydantic import BaseModel

from app.config import get_settings
from app.utils.prompts import load_prompt

logger = logging.getLogger(__name__)

AI_RETRY_MAX_BACKOFF_S = 30


class TextGenerationResult(BaseModel):
    content: str
    model: str
    endpoint: str


class ClothingTags(BaseModel):
    type: str = "unknown"
    subtype: str | None = None
    primary_color: str | None = None
    colors: list[str] = []
    pattern: str | None = None
    material: str | None = None
    style: list[str] = []
    formality: str | None = None
    season: list[str] = []
    fit: str | None = None
    occasion: list[str] = []
    brand: str | None = None
    condition: str | None = None
    features: list[str] = []
    # Only ever tags this user has typed before - never new vocabulary.
    user_tags: list[str] = []
    name: str | None = None
    # Degrees counter-clockwise the stored image needs to sit upright. 0 = leave alone.
    rotation: int = 0
    confidence: float = 0.0
    logprobs_confidence: float | None = None
    description: str | None = None
    raw_response: str | None = None


TAGGING_PROMPT = load_prompt("clothing_analysis")
DESCRIPTION_PROMPT = load_prompt("clothing_description")

_TYPE_VOCABULARY_MARKER = "TYPE (required, pick one):"
_TAG_VOCABULARY_MARKER = "TAGS (pick only from this exact list"


def extend_type_vocabulary(prompt: str, extra_types: list[str]) -> str:
    """Append user-defined type slugs to the prompt's TYPE line.

    Located by marker rather than hardcoded, so editing clothing_analysis.txt
    doesn't silently stop the append from happening.
    """
    if not extra_types:
        return prompt
    marker_at = prompt.find(_TYPE_VOCABULARY_MARKER)
    if marker_at < 0:
        logger.warning("TYPE vocabulary marker missing from tagging prompt")
        return prompt
    line_start = prompt.find("\n", marker_at)
    if line_start < 0:
        return prompt
    line_end = prompt.find("\n", line_start + 1)
    if line_end < 0:
        line_end = len(prompt)
    return f"{prompt[:line_end]}, {', '.join(extra_types)}{prompt[line_end:]}"


def set_tag_vocabulary(prompt: str, known_tags: list[str]) -> str:
    """Replace the TAGS placeholder line with the user's own tags.

    Replaces rather than appends (unlike the TYPE vocabulary, which extends a real
    built-in list): there is no global tag vocabulary, only whatever this user has
    typed before, and the placeholder must not survive as a suggestion. A user with
    no tags yet keeps the "(none)" line, which reads as "always answer []".
    """
    if not known_tags:
        return prompt
    marker_at = prompt.find(_TAG_VOCABULARY_MARKER)
    if marker_at < 0:
        logger.warning("TAGS vocabulary marker missing from tagging prompt")
        return prompt
    line_start = prompt.find("\n", marker_at)
    if line_start < 0:
        return prompt
    line_end = prompt.find("\n", line_start + 1)
    if line_end < 0:
        line_end = len(prompt)
    return f"{prompt[: line_start + 1]}{', '.join(known_tags)}{prompt[line_end:]}"


# Valid values for validation
VALID_TYPES = {
    "shirt",
    "t-shirt",
    "pants",
    "jeans",
    "shorts",
    "dress",
    "skirt",
    "jacket",
    "coat",
    "sweater",
    "hoodie",
    "blazer",
    "vest",
    "cardigan",
    "polo",
    "blouse",
    "tank-top",
    "shoes",
    "sneakers",
    "boots",
    "sandals",
    "hat",
    "scarf",
    "belt",
    "bag",
    "accessories",
    "top",
    "jumpsuit",
    "socks",
    "tie",
}
VALID_COLORS = {
    "black",
    "white",
    "gray",
    "navy",
    "blue",
    "light-blue",
    "red",
    "burgundy",
    "pink",
    "green",
    "olive",
    "yellow",
    "orange",
    "purple",
    "brown",
    "tan",
    "beige",
    "cream",
    "gold",
    "silver",
}
VALID_PATTERNS = {
    "solid",
    "striped",
    "plaid",
    "checkered",
    "floral",
    "graphic",
    "geometric",
    "polka-dot",
    "camouflage",
    "animal-print",
}
VALID_MATERIALS = {
    "cotton",
    "denim",
    "leather",
    "wool",
    "polyester",
    "silk",
    "linen",
    "knit",
    "fleece",
    "suede",
    "velvet",
    "nylon",
    "canvas",
}
VALID_FORMALITY = {"very-casual", "casual", "smart-casual", "business-casual", "formal"}
VALID_FIT = {"slim", "regular", "relaxed", "oversized", "tailored", "cropped"}
VALID_STYLES = {
    "casual",
    "classic",
    "sporty",
    "minimalist",
    "bohemian",
    "preppy",
    "streetwear",
    "elegant",
    "athletic",
    "vintage",
    "modern",
    "rugged",
}
VALID_SEASONS = {"spring", "summer", "fall", "winter", "all-season"}
VALID_OCCASIONS = {
    "everyday",
    "work",
    "formal-event",
    "party",
    "date",
    "sport",
    "travel",
    "lounge",
    "outdoor",
}
VALID_CONDITIONS = {"new", "excellent", "good", "worn", "damaged"}
VALID_FEATURES = {
    "pockets",
    "zipper",
    "buttons",
    "hood",
    "collar",
    "drawstring",
    "embroidery",
    "print",
    "distressed",
    "pleated",
    "belted",
    "cuffed",
    "ribbed",
    "lined",
    "sheer",
    "sequined",
}
VALID_ROTATIONS = {0, 90, 180, 270}


_NULLISH_TEXT = {"", "null", "none", "n/a", "na", "unknown", "unbranded", "no brand"}


def clamp_text(value: object, max_len: int) -> str | None:
    """Accept a free-text model answer, or None if it said nothing useful."""
    if not isinstance(value, str):
        return None
    cleaned = value.strip().strip('"').strip()
    if cleaned.lower() in _NULLISH_TEXT:
        return None
    return cleaned[:max_len]


def validate_rotation(value: object) -> int:
    try:
        rotation = int(value) % 360  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    return rotation if rotation in VALID_ROTATIONS else 0


def compute_tag_completeness(tags: "ClothingTags") -> float:
    score = 0.0
    if tags.type and tags.type != "unknown":
        score += 0.25
    if tags.primary_color:
        score += 0.20
    if tags.pattern:
        score += 0.15
    if tags.formality:
        score += 0.15
    if tags.material:
        score += 0.10
    if tags.season:
        score += 0.05
    if tags.style:
        score += 0.05
    if tags.colors:
        score += 0.05
    return round(score, 2)


def _response_rejects_logprobs(response: httpx.Response) -> bool:
    return response.status_code == 400 and "logprobs" in response.text.lower()


def _response_rejects_json_mode(response: httpx.Response) -> bool:
    # Providers that don't know Ollama's `format` or OpenAI's `response_format`
    # return 400; strip those fields and retry the same attempt.
    if response.status_code != 400:
        return False
    text = response.text.lower()
    return "response_format" in text or "format" in text


def _looks_like_unparsed_prose(tags: ClothingTags, raw: str | None) -> bool:
    """True when the vision model answered in English instead of tag JSON."""
    if not raw or not raw.strip():
        return False
    if tags.type != "unknown":
        return False
    # Parsed JSON with type unknown still has structured raw_response; prose
    # responses are the ones we failed to extract an object from.
    stripped = raw.strip()
    return not stripped.startswith("{") and not stripped.startswith("[")


def _needs_tag_repair(tags: ClothingTags) -> bool:
    """Vision returned something we couldn't turn into clothing fields.

    moondream often emits bounding-box JSON (`top`/`left`/`color`) that parses
    as JSON but leaves type=unknown — prose detection alone misses that case.
    """
    return tags.type == "unknown"


_CONFIDENCE_FIELDS = {"type", "primary_color", "pattern", "material", "formality"}


def compute_confidence_from_logprobs(logprobs_content: list[dict] | None) -> float | None:
    if not logprobs_content:
        return None

    field_probs: dict[str, list[float]] = {}
    current_key = None
    expect_value = False

    for entry in logprobs_content:
        token = entry.get("token", "")
        logprob = entry.get("logprob", 0)
        prob = math.exp(logprob)
        stripped = token.strip().strip('"').strip("'")

        if stripped in _CONFIDENCE_FIELDS:
            current_key = stripped
            expect_value = False
            continue

        if current_key and ":" in token:
            expect_value = True
            continue

        if expect_value and current_key and stripped and stripped not in ("{", "[", ",", "}", "]"):
            if stripped == "null":
                current_key = None
                expect_value = False
                continue
            if current_key not in field_probs:
                field_probs[current_key] = []
            field_probs[current_key].append(prob)
            current_key = None
            expect_value = False

    if not field_probs:
        return None

    weights = {
        "type": 0.30,
        "primary_color": 0.25,
        "pattern": 0.15,
        "material": 0.15,
        "formality": 0.15,
    }
    total_weight = 0.0
    weighted_sum = 0.0

    for field, probs in field_probs.items():
        w = weights.get(field, 0.1)
        weighted_sum += w * min(probs)
        total_weight += w

    if total_weight == 0:
        return None

    return round(weighted_sum / total_weight, 2)


class AIEndpointConfig:
    """Configuration for an AI endpoint."""

    def __init__(
        self,
        url: str,
        vision_model: str = "moondream",
        text_model: str = "phi3:mini",
        name: str = "default",
        enabled: bool = True,
    ):
        self.url = url
        self.vision_model = vision_model
        self.text_model = text_model
        self.name = name
        self.enabled = enabled


class AIService:
    """Service for AI-powered image analysis and text generation."""

    def __init__(
        self,
        endpoints: list[dict] | None = None,
        custom_types: list[dict] | None = None,
        known_tags: list[str] | None = None,
    ):
        """
        Initialize AI service with optional custom endpoints.

        Args:
            endpoints: List of endpoint configs from user preferences.
                      If None or empty, uses default from settings.
            custom_types: User-defined clothing types. Those with a body slot are
                      offered to the vision model and accepted back from it; those
                      without one (role=None) are deliberately never mentioned.
            known_tags: Free-text tags this user has already used. The model may
                      reuse them and nothing else - an empty list means it can
                      never return a tag at all.

        Raises:
            AIDisabledError: backstop when internal AI is disabled; call sites
                should guard with require_internal_ai() first.
        """
        self.settings = get_settings()
        if not self.settings.ai_enabled:
            raise AIDisabledError("Internal AI is disabled; defer to an external agent.")
        self.timeout = self.settings.ai_timeout
        self.api_key = self.settings.ai_api_key

        # Build endpoint list
        self._endpoints: list[AIEndpointConfig] = []

        if endpoints:
            for ep in endpoints:
                if ep.get("enabled", True):
                    self._endpoints.append(
                        AIEndpointConfig(
                            url=ep["url"],
                            vision_model=ep.get("vision_model", "moondream"),
                            text_model=ep.get("text_model", "phi3:mini"),
                            name=ep.get("name", "custom"),
                            enabled=True,
                        )
                    )

        # Always add default endpoint as fallback (even if user has custom endpoints)
        # This ensures we can fall back to in-house Ollama if user endpoints are unreachable
        self._endpoints.append(
            AIEndpointConfig(
                url=self.settings.ai_base_url,
                vision_model=self.settings.ai_vision_model,
                text_model=self.settings.ai_text_model,
                name="default",
            )
        )

        # Legacy properties for backwards compatibility
        self.base_url = self._endpoints[0].url
        self.vision_model = self._endpoints[0].vision_model
        self.text_model = self._endpoints[0].text_model

        # Per-user type vocabulary. Module constants stay the defaults, so the
        # construction sites that pass no custom_types are unaffected.
        enabled_custom = [
            t["value"] for t in (custom_types or []) if t.get("role") and t.get("value")
        ]
        self._valid_types = VALID_TYPES | set(enabled_custom)
        # Tags are already stored lowercase (normalize_user_tags), so the set the
        # parser validates against and the list the prompt offers are the same shape.
        self._known_tags = {t.strip().lower() for t in (known_tags or []) if t and t.strip()}
        self._tagging_prompt = set_tag_vocabulary(
            extend_type_vocabulary(TAGGING_PROMPT, enabled_custom), sorted(self._known_tags)
        )

    def _get_headers(self) -> dict:
        """Get headers for AI API requests, including auth if configured."""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _preprocess_image(self, image_path: str | Path) -> str:
        """
        Preprocess image for AI analysis.
        Returns base64-encoded JPEG string.
        """
        with Image.open(image_path) as img:
            # Convert to RGB if necessary
            if img.mode != "RGB":
                img = img.convert("RGB")

            # Auto-orient based on EXIF
            img = ImageOps.exif_transpose(img)

            # Resize to max 512x512 for faster AI processing
            max_size = 512
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

            # Convert to JPEG bytes
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=85)
            buffer.seek(0)

            return base64.b64encode(buffer.read()).decode("utf-8")

    def _parse_tags_from_response(self, response_text: str) -> ClothingTags:
        def extract_json(text: str) -> dict | None:
            try:
                return json.loads(text.strip())
            except json.JSONDecodeError:
                pass

            json_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
            if json_match:
                try:
                    return json.loads(json_match.group(1))
                except json.JSONDecodeError:
                    pass

            start_idx = text.find("{")
            if start_idx != -1:
                brace_count = 0
                for i, char in enumerate(text[start_idx:], start_idx):
                    if char == "{":
                        brace_count += 1
                    elif char == "}":
                        brace_count -= 1
                        if brace_count == 0:
                            json_str = text[start_idx : i + 1]
                            try:
                                return json.loads(json_str)
                            except json.JSONDecodeError:
                                break
            return None

        COLOR_ALIASES: dict[str, str] = {
            "grey": "gray",
            "light grey": "gray",
            "light gray": "gray",
            "dark grey": "gray",
            "dark gray": "gray",
            "off-white": "cream",
            "ivory": "cream",
            "wine": "burgundy",
            "maroon": "burgundy",
            "forest green": "green",
            "dark blue": "navy",
            "royal blue": "blue",
            "sky blue": "light-blue",
            "baby blue": "light-blue",
            "camel": "tan",
            "khaki": "tan",
            "rust": "orange",
            "coral": "pink",
            "rose": "pink",
            "mauve": "purple",
            "lavender": "purple",
            "mustard": "yellow",
            "gold": "yellow",
            "silver": "gray",
            "charcoal": "gray",
        }

        def validate_value(value: str | None, valid_set: set) -> str | None:
            if value is None:
                return None
            value_lower = value.lower().strip()
            if value_lower in valid_set:
                return value_lower
            alias = COLOR_ALIASES.get(value_lower)
            if alias and alias in valid_set:
                return alias
            return None

        def validate_list(values: list, valid_set: set) -> list:
            if not values:
                return []
            return [v.lower().strip() for v in values if v and v.lower().strip() in valid_set]

        data = extract_json(response_text)
        if not data:
            logger.warning(f"Could not parse JSON from AI response: {response_text[:200]}")
            return ClothingTags(raw_response=response_text)

        if isinstance(data, list):
            data = data[0] if data and isinstance(data[0], dict) else {}

        tags = ClothingTags()
        tags.raw_response = response_text

        item_type = validate_value(data.get("type"), self._valid_types)
        if item_type:
            tags.type = item_type
        else:
            tags.type = "unknown"

        tags.subtype = data.get("subtype") if data.get("subtype") else None
        tags.primary_color = validate_value(data.get("primary_color"), VALID_COLORS)
        tags.colors = validate_list(data.get("colors", []), VALID_COLORS)
        tags.pattern = validate_value(data.get("pattern"), VALID_PATTERNS)
        tags.material = validate_value(data.get("material"), VALID_MATERIALS)
        tags.formality = validate_value(data.get("formality"), VALID_FORMALITY)
        tags.style = validate_list(data.get("style", []), VALID_STYLES)
        tags.season = validate_list(data.get("season", []), VALID_SEASONS)
        tags.fit = validate_value(data.get("fit"), VALID_FIT)
        tags.occasion = validate_list(data.get("occasion", []), VALID_OCCASIONS)
        tags.condition = validate_value(data.get("condition"), VALID_CONDITIONS)
        tags.features = validate_list(data.get("features", []), VALID_FEATURES)
        # The prompt asks for existing tags only; this is what enforces it. Anything
        # the model invents is dropped here rather than growing the user's vocabulary.
        tags.user_tags = validate_list(data.get("tags", []), self._known_tags)
        # Free text, so validated by shape rather than vocabulary: brand names and
        # item names are unbounded, but the columns behind them are String(100).
        tags.name = clamp_text(data.get("name"), 100)
        tags.brand = clamp_text(data.get("brand"), 100)
        tags.rotation = validate_rotation(data.get("rotation"))
        tags.confidence = compute_tag_completeness(tags)

        logger.info(
            f"Parsed tags: type={tags.type}, color={tags.primary_color}, pattern={tags.pattern}"
        )
        return tags

    async def _call_with_fallback(
        self,
        messages: list,
        task_name: str,
        use_vision_model: bool = True,
        request_logprobs: bool = False,
        json_mode: bool = False,
    ) -> tuple[str | None, Exception | None, list | None]:
        last_error = None

        for endpoint in self._endpoints:
            logger.info(f"Trying AI endpoint for {task_name}: {endpoint.name}")
            model = endpoint.vision_model if use_vision_model else endpoint.text_model
            use_logprobs = request_logprobs
            use_json_mode = json_mode

            async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
                attempt = 0
                while attempt < self.settings.ai_max_retries:
                    try:
                        request_body = {
                            "model": model,
                            "messages": messages,
                            "stream": False,
                            "max_tokens": self.settings.ai_max_tokens,
                        }
                        if use_logprobs:
                            request_body["logprobs"] = True
                            request_body["top_logprobs"] = 3
                        if use_json_mode:
                            # Ollama native + OpenAI-compat; providers that reject either
                            # field are retried without json_mode (see below).
                            request_body["format"] = "json"
                            request_body["response_format"] = {"type": "json_object"}

                        response = await client.post(
                            f"{endpoint.url}/chat/completions",
                            headers=self._get_headers(),
                            json=request_body,
                        )
                        response.raise_for_status()

                        data = response.json()
                        choice = data["choices"][0]
                        content = choice["message"]["content"]
                        logprobs_content = None
                        if use_logprobs:
                            lp = choice.get("logprobs")
                            if lp:
                                logprobs_content = lp.get("content")

                        used_model = data.get("model", model)
                        logger.info(
                            f"AI {task_name} successful via {endpoint.name} (model: {used_model})"
                        )
                        return content, None, logprobs_content

                    except httpx.HTTPStatusError as e:
                        # Some providers (e.g. Gemini's OpenAI-compat endpoint, or Gemini
                        # native without the paid tier) reject the logprobs param outright.
                        # Retry the same attempt without it instead of burning the retry
                        # budget or losing the tags entirely - this doesn't count against
                        # ai_max_retries since it's a capability mismatch, not a transient
                        # failure.
                        if use_logprobs and _response_rejects_logprobs(e.response):
                            logger.warning(
                                f"{endpoint.name} rejected logprobs for {task_name}, "
                                f"retrying without it: {e}"
                            )
                            use_logprobs = False
                            continue
                        if use_json_mode and _response_rejects_json_mode(e.response):
                            logger.warning(
                                f"{endpoint.name} rejected json mode for {task_name}, "
                                f"retrying without it: {e}"
                            )
                            use_json_mode = False
                            continue
                        last_error = e
                        logger.warning(f"HTTP error from {endpoint.name}: {e}")
                    except httpx.RequestError as e:
                        last_error = e
                        logger.warning(f"Request error from {endpoint.name}: {e}")

                    attempt += 1
                    if attempt < self.settings.ai_max_retries:
                        # Without this the retries fire back to back in milliseconds,
                        # so a rate-limited or restarting endpoint is hit three times
                        # in the same instant and the user's manual retry reproduces
                        # the identical failure.
                        await asyncio.sleep(min(2**attempt, AI_RETRY_MAX_BACKOFF_S))

        return None, last_error, None

    async def analyze_image(self, image_path: str | Path) -> ClothingTags:
        # PIL preprocessing is CPU-bound and synchronous; run off the event loop so
        # concurrent tagging jobs don't stall each other's in-flight HTTP reads.
        image_base64 = await asyncio.to_thread(self._preprocess_image, image_path)

        # System/user separation for injection protection
        messages_tags = [
            {"role": "system", "content": self._tagging_prompt},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
                    },
                ],
            },
        ]

        messages_desc = [
            {"role": "system", "content": DESCRIPTION_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
                    },
                ],
            },
        ]

        tags = ClothingTags()
        last_error = None
        tags_raw: str | None = None

        # First pass: structured tags with logprobs for real confidence
        content, err, logprobs_content = await self._call_with_fallback(
            messages_tags, "tags", request_logprobs=True, json_mode=True
        )
        if content:
            tags_raw = content
            tags = self._parse_tags_from_response(content)
            logprobs_confidence = compute_confidence_from_logprobs(logprobs_content)
            if logprobs_confidence is not None:
                tags.logprobs_confidence = logprobs_confidence
        if err:
            last_error = err

        # Second pass: human-readable description (also the repair source when
        # the tags call returned bbox JSON / prose instead of the schema).
        desc_content, err, _ = await self._call_with_fallback(messages_desc, "description")
        if desc_content:
            description = desc_content.strip()
            if description.startswith('"') and description.endswith('"'):
                description = description[1:-1]
            tags.description = description
        elif tags_raw and _looks_like_unparsed_prose(tags, tags_raw) and not tags.description:
            tags.description = tags_raw.strip()[:500]

        # Caption / detector models (moondream) rarely emit our schema. Prefer
        # the description for repair — bbox JSON is useless to the text model.
        if _needs_tag_repair(tags):
            repair_source = (tags.description or "").strip()
            if not repair_source and tags_raw and _looks_like_unparsed_prose(tags, tags_raw):
                repair_source = tags_raw.strip()
            if repair_source:
                logger.info("Vision tags unusable; repairing via text model from description")
                # Keep this prompt short: tiny text models (gemma3:1b) lose the
                # long clothing_analysis schema and invent wrong types.
                repair_system = (
                    "Output ONLY a JSON object for one clothing item. No markdown. "
                    "Required keys: type, primary_color, pattern, formality, name. "
                    "Optional: subtype, colors, material, style, season, fit, brand. "
                    "type must be exactly one of: shirt, t-shirt, top, pants, jeans, shorts, "
                    "dress, skirt, jacket, coat, sweater, hoodie, blazer, shoes, sneakers, "
                    "boots, bag, accessories. "
                    "If the description says jeans, type must be jeans (not shirt). "
                    "primary_color must be one of: black, white, gray, navy, blue, light-blue, "
                    "red, burgundy, pink, green, olive, yellow, orange, purple, brown, tan, "
                    "beige, cream. "
                    "pattern one of: solid, striped, plaid, checkered, floral, graphic. "
                    "formality one of: very-casual, casual, smart-casual, business-casual, formal. "
                    "name: short title like 'Blue jeans'. brand: null if unknown."
                )
                repair_messages = [
                    {"role": "system", "content": repair_system},
                    {
                        "role": "user",
                        "content": (
                            "Convert this clothing description into the required JSON object only.\n\n"
                            f"{repair_source}"
                        ),
                    },
                ]
                repaired, repair_err, _ = await self._call_with_fallback(
                    repair_messages,
                    "tags-repair",
                    use_vision_model=False,
                    request_logprobs=False,
                    json_mode=True,
                )
                if repaired:
                    repaired_tags = self._parse_tags_from_response(repaired)
                    if repaired_tags.type != "unknown":
                        kept_description = tags.description
                        tags = repaired_tags
                        if not tags.description:
                            tags.description = kept_description or repair_source[:500]
                elif repair_err and last_error is None:
                    last_error = repair_err

        if err and last_error is None:
            last_error = err

        if tags.type == "unknown" and not tags.description and last_error:
            raise last_error

        return tags

    async def check_health(self) -> dict:
        """Check health of all configured AI endpoints."""
        endpoints_health = []

        for endpoint in self._endpoints:
            try:
                async with httpx.AsyncClient(timeout=5, follow_redirects=True) as client:
                    # Try OpenAI-compatible /v1/models endpoint first
                    response = await client.get(
                        f"{endpoint.url}/models", headers=self._get_headers()
                    )
                    if response.status_code == 200:
                        data = response.json()
                        # OpenAI format: {"data": [{"id": "model-name", ...}]}
                        models = data.get("data", [])
                        model_names = [m.get("id", "") for m in models]
                        endpoints_health.append(
                            {
                                "name": endpoint.name,
                                "url": endpoint.url,
                                "status": "healthy",
                                "vision_model": endpoint.vision_model,
                                "text_model": endpoint.text_model,
                                "available_models": model_names,
                            }
                        )
                        continue

                    # Fallback: Try Ollama-specific endpoint
                    response = await client.get(endpoint.url.replace("/v1", "/api/tags"))
                    if response.status_code == 200:
                        models = response.json().get("models", [])
                        model_names = [m.get("name", "") for m in models]
                        endpoints_health.append(
                            {
                                "name": endpoint.name,
                                "url": endpoint.url,
                                "status": "healthy",
                                "vision_model": endpoint.vision_model,
                                "text_model": endpoint.text_model,
                                "available_models": model_names,
                            }
                        )
                    else:
                        endpoints_health.append(
                            {
                                "name": endpoint.name,
                                "url": endpoint.url,
                                "status": "unhealthy",
                                "error": f"HTTP {response.status_code}",
                            }
                        )
            except Exception as e:
                endpoints_health.append(
                    {
                        "name": endpoint.name,
                        "url": endpoint.url,
                        "status": "unhealthy",
                        "error": str(e),
                    }
                )

        # Overall status is healthy if at least one endpoint is healthy
        any_healthy = any(ep["status"] == "healthy" for ep in endpoints_health)
        return {
            "status": "healthy" if any_healthy else "unhealthy",
            "endpoints": endpoints_health,
        }

    async def generate_text(
        self,
        prompt: str,
        system_prompt: str | None = None,
        return_metadata: bool = False,
    ) -> str | TextGenerationResult:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        last_error = None

        for endpoint in self._endpoints:
            logger.info(f"Trying text generation via {endpoint.name}")

            async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
                for attempt in range(self.settings.ai_max_retries):
                    try:
                        response = await client.post(
                            f"{endpoint.url}/chat/completions",
                            headers=self._get_headers(),
                            json={
                                "model": endpoint.text_model,
                                "messages": messages,
                                "stream": False,
                                "temperature": 0.4,
                                "max_tokens": self.settings.ai_max_tokens,
                            },
                        )
                        response.raise_for_status()

                        data = response.json()
                        used_model = data.get("model", endpoint.text_model)
                        choice = data["choices"][0]
                        message = choice["message"]
                        content = message.get("content")

                        if not content or not content.strip():
                            finish_reason = choice.get("finish_reason")
                            reasoning = message.get("reasoning_content")
                            if finish_reason == "length" and reasoning:
                                detail = (
                                    "its reasoning/thinking output consumed the entire "
                                    "completion token budget before it produced a response"
                                )
                            elif finish_reason == "length":
                                detail = "the response was cut off before any content was generated"
                            else:
                                detail = f"finish_reason={finish_reason!r}"
                            last_error = AIResponseTruncatedError(
                                f"{endpoint.name} (model: {used_model}) returned an empty "
                                f"response: {detail}. Try raising AI_MAX_TOKENS (currently "
                                f"{self.settings.ai_max_tokens}) or disabling extended "
                                "thinking/reasoning mode for this model."
                            )
                            logger.warning(str(last_error))
                            if attempt < self.settings.ai_max_retries - 1:
                                continue
                            break

                        logger.info(
                            f"Text generation successful via {endpoint.name} (model: {used_model})"
                        )

                        if return_metadata:
                            return TextGenerationResult(
                                content=content,
                                model=used_model,
                                endpoint=endpoint.name,
                            )
                        return content

                    except httpx.HTTPStatusError as e:
                        last_error = e
                        logger.warning(f"HTTP error from {endpoint.name}: {e}")
                        if attempt < self.settings.ai_max_retries - 1:
                            continue
                    except httpx.RequestError as e:
                        last_error = e
                        logger.warning(f"Request error from {endpoint.name}: {e}")
                        if attempt < self.settings.ai_max_retries - 1:
                            continue

        if last_error:
            raise last_error
        raise RuntimeError("Failed to generate text - no endpoints available")


class AIResponseTruncatedError(RuntimeError):
    """Raised when a model's response was cut off before it produced any output content.

    Reasoning-capable models (e.g. Qwen3, DeepSeek-R1) return their chain-of-thought in a
    separate ``reasoning_content`` field, distinct from ``content``. If that reasoning
    consumes the entire completion token budget, the API reports ``finish_reason ==
    "length"`` with an empty ``content`` string. Downstream JSON parsing of an empty
    string then fails with an unhelpful message, which used to get swallowed into a
    generic "AI service is not available" error even though the endpoint responded
    successfully. This error preserves the real cause so callers can surface it.
    """


class AIDisabledError(RuntimeError):
    """Raised when an internal AI client is requested while that capability is off."""


def require_internal_ai(capability: Literal["vision", "text"]) -> None:
    """Raise AIDisabledError if the given internal-AI capability is disabled.

    Call before constructing AIService directly so deferred work never builds a
    client or reaches a provider.
    """
    settings = get_settings()
    enabled = (
        settings.effective_ai_vision_enabled
        if capability == "vision"
        else settings.effective_ai_text_enabled
    )
    if not enabled:
        raise AIDisabledError(
            f"Internal AI {capability} is disabled "
            f"(AI_INTERNAL_ENABLED / AI_{capability.upper()}_ENABLED=false). "
            "Defer this work to an external agent."
        )


# Singleton instance
_ai_service: AIService | None = None


def get_ai_service() -> AIService:
    """Return the shared AIService, or raise AIDisabledError if internal AI is off."""
    if not get_settings().ai_enabled:
        raise AIDisabledError("Internal AI is disabled; defer to an external agent.")
    global _ai_service
    if _ai_service is None:
        _ai_service = AIService()
    return _ai_service
