"""add user_tags, is_public to clothing_items and custom_item_types to preferences

Revision ID: d7e8f9a0b1c2
Revises: b1c2d3e4f5a6
Create Date: 2026-08-19

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d7e8f9a0b1c2"
down_revision: str | None = "b1c2d3e4f5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "clothing_items",
        sa.Column(
            "user_tags",
            postgresql.ARRAY(sa.String),
            nullable=False,
            server_default="{}",
        ),
    )
    op.create_index(
        "idx_clothing_items_user_tags",
        "clothing_items",
        ["user_tags"],
        postgresql_using="gin",
    )
    # Existing items become private, which is the requested default.
    op.add_column(
        "clothing_items",
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "user_preferences",
        sa.Column(
            "custom_item_types",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
    )


def downgrade() -> None:
    op.drop_column("user_preferences", "custom_item_types")
    op.drop_column("clothing_items", "is_public")
    op.drop_index("idx_clothing_items_user_tags", table_name="clothing_items")
    op.drop_column("clothing_items", "user_tags")
