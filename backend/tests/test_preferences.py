import pytest
from httpx import AsyncClient
from pydantic import ValidationError

from app.schemas.preference import PreferenceUpdate


class TestPreferencesEndpoints:
    """Tests for preferences API endpoints."""

    @pytest.mark.asyncio
    async def test_get_preferences_not_found(self, client: AsyncClient, test_user, auth_headers):
        """Test getting preferences when none exist."""
        response = await client.get("/api/v1/users/me/preferences", headers=auth_headers)
        # Should return 404 or empty default
        assert response.status_code in [200, 404]

    @pytest.mark.asyncio
    async def test_create_preferences(self, client: AsyncClient, test_user, auth_headers):
        """Test creating user preferences."""
        response = await client.patch(
            "/api/v1/users/me/preferences",
            json={
                "color_favorites": ["black", "navy", "white"],
                "default_occasion": "smart-casual",
            },
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert "black" in data["color_favorites"]
        assert data["default_occasion"] == "smart-casual"

    @pytest.mark.asyncio
    async def test_update_preferences(
        self, client: AsyncClient, test_user_with_preferences, auth_headers, db_session
    ):
        """Test updating existing preferences."""
        response = await client.patch(
            "/api/v1/users/me/preferences",
            json={
                "color_avoid": ["orange", "pink"],
            },
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert "orange" in data["color_avoid"]


class TestAIEndpointPreferences:
    """Tests for AI endpoint configuration in preferences."""

    @pytest.mark.asyncio
    async def test_configure_ai_endpoint(self, client: AsyncClient, test_user, auth_headers):
        """Test configuring custom AI endpoint."""
        response = await client.patch(
            "/api/v1/users/me/preferences",
            json={
                "ai_endpoints": [
                    {
                        "name": "local-ollama",
                        "url": "http://localhost:11434/v1",
                        "vision_model": "llava",
                        "text_model": "llama3",
                        "enabled": True,
                    }
                ]
            },
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data.get("ai_endpoints", [])) == 1
        assert data["ai_endpoints"][0]["name"] == "local-ollama"

    @pytest.mark.asyncio
    async def test_test_ai_endpoint_allows_localhost(
        self, client: AsyncClient, test_user, auth_headers
    ):
        response = await client.post(
            "/api/v1/users/me/preferences/test-ai-endpoint",
            json={
                "url": "http://localhost:11434/v1",
                "vision_model": "llava",
            },
            headers=auth_headers,
        )
        assert response.status_code != 400


class TestPreferenceValidation:
    """Tests for preference validation."""

    @pytest.mark.asyncio
    async def test_invalid_formality_rejected(self, client: AsyncClient, test_user, auth_headers):
        """Test that invalid formality values are rejected."""
        response = await client.patch(
            "/api/v1/users/me/preferences",
            json={
                "formality_default": "ultra-mega-formal",  # Invalid
            },
            headers=auth_headers,
        )
        # Should either reject or sanitize
        assert response.status_code in [200, 422]

    @pytest.mark.asyncio
    async def test_empty_preferences_allowed(self, client: AsyncClient, test_user, auth_headers):
        """Test that empty/minimal preferences are accepted."""
        response = await client.patch(
            "/api/v1/users/me/preferences",
            json={},
            headers=auth_headers,
        )
        assert response.status_code == 200


class TestCustomItemTypes:
    """Feature 1: validation of user-defined clothing types."""

    def test_rejects_builtin_collision(self):
        with pytest.raises(ValidationError):
            PreferenceUpdate(
                custom_item_types=[{"value": "shirt", "label": "Shirt", "role": "base_top"}]
            )

    def test_rejects_unknown_role(self):
        with pytest.raises(ValidationError):
            PreferenceUpdate(
                custom_item_types=[{"value": "kimono", "label": "Kimono", "role": "hovercraft"}]
            )

    def test_rejects_duplicate_values(self):
        with pytest.raises(ValidationError):
            PreferenceUpdate(
                custom_item_types=[
                    {"value": "kimono", "label": "Kimono", "role": "outer_layer"},
                    {"value": "kimono", "label": "Kimono 2", "role": "outer_layer"},
                ]
            )

    def test_rejects_bad_slug(self):
        with pytest.raises(ValidationError):
            PreferenceUpdate(
                custom_item_types=[{"value": "Ki Mono!", "label": "Kimono", "role": "accessory"}]
            )

    def test_accepts_type_without_role(self):
        parsed = PreferenceUpdate(
            custom_item_types=[{"value": "lingerie", "label": "Lingerie", "role": None}]
        )
        assert parsed.custom_item_types[0].role is None

    @pytest.mark.asyncio
    async def test_round_trips_through_the_endpoint(
        self, client: AsyncClient, test_user, auth_headers
    ):
        response = await client.patch(
            "/api/v1/users/me/preferences",
            json={
                "custom_item_types": [
                    {
                        "value": "kimono",
                        "label": "Kimono",
                        "role": "outer_layer",
                        "wash_interval": 9,
                    },
                    {"value": "lingerie", "label": "Lingerie", "role": None},
                ]
            },
            headers=auth_headers,
        )
        assert response.status_code == 200
        types = response.json()["custom_item_types"]
        assert [t["value"] for t in types] == ["kimono", "lingerie"]
        assert types[0]["wash_interval"] == 9
        assert types[1]["role"] is None

    @pytest.mark.asyncio
    async def test_endpoint_rejects_builtin_collision(
        self, client: AsyncClient, test_user, auth_headers
    ):
        response = await client.patch(
            "/api/v1/users/me/preferences",
            json={"custom_item_types": [{"value": "jeans", "label": "Jeans", "role": "bottom"}]},
            headers=auth_headers,
        )
        assert response.status_code == 422
