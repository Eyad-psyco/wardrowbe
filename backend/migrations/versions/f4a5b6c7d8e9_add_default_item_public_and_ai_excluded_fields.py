"""add default_item_public and ai_excluded_fields

Revision ID: f4a5b6c7d8e9
Revises: e9f0a1b2c3d4
Create Date: 2026-09-04

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f4a5b6c7d8e9"
down_revision: str | None = "e9f0a1b2c3d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_preferences",
        sa.Column(
            "default_item_public",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    # Fields the user took manual control of in the upload modal. The tagging
    # worker runs minutes later on its own connection, so this has to live on the
    # row - there is nowhere else for it to read the user's intent from.
    op.add_column(
        "clothing_items",
        sa.Column(
            "ai_excluded_fields",
            sa.ARRAY(sa.String()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("clothing_items", "ai_excluded_fields")
    op.drop_column("user_preferences", "default_item_public")
