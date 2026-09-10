import json

from sqlalchemy import JSON, create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.db_base import Base

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    from app import models  # noqa: F401  (ensure models are registered on Base)

    _apply_renames()
    Base.metadata.create_all(bind=engine)
    _add_missing_columns()


# Renames this codebase has made to already-deployed tables/columns, oldest
# first. Same problem as _add_missing_columns below: there's no migration
# framework and the app auto-deploys straight onto the persisted database.
# Without these, create_all() just makes a fresh empty table next to the
# populated one under its old name and the old rows are silently orphaned.
_TABLE_RENAMES = [("groups", "teams")]
_COLUMN_RENAMES = [("users", "group_id", "team_id")]


def _apply_renames() -> None:
    """Run before create_all() so the renamed table is what create_all() then
    sees as already existing. Each rename is skipped once the new name is in
    place, so this is a no-op on a fresh database and on every deploy after
    the one that first applies it."""
    inspector = inspect(engine)
    with engine.begin() as conn:
        for old_name, new_name in _TABLE_RENAMES:
            if inspector.has_table(old_name) and not inspector.has_table(new_name):
                # SQLite (3.25+) rewrites other tables' foreign keys to point
                # at the new name for us; Postgres keeps them by table oid.
                conn.execute(text(f"ALTER TABLE {old_name} RENAME TO {new_name}"))
        for table, old_column, new_column in _COLUMN_RENAMES:
            if not inspector.has_table(table):
                continue
            existing = {col["name"] for col in inspector.get_columns(table)}
            if old_column in existing and new_column not in existing:
                conn.execute(text(f'ALTER TABLE {table} RENAME COLUMN "{old_column}" TO "{new_column}"'))


def _default_value(column):
    """Best-effort backfill value for a newly added column, from the model's
    Python-side `default=`. Only handles the JSON-list-default pattern this
    codebase actually uses (disliked_cuisines and friends); anything else is
    left NULL, which is fine for the nullable scalar columns this repo adds."""
    if column.default is None:
        return None
    # SQLAlchemy wraps a zero-arg callable default (like `default=list`) to
    # always take an ExecutionContext, even when the callable itself ignores
    # it -- so a callable default must always be invoked as arg(None), never
    # arg() directly.
    value = column.default.arg(None) if column.default.is_callable else column.default.arg
    return json.dumps(value) if isinstance(column.type, JSON) else value


def _add_missing_columns() -> None:
    """create_all() only creates tables that don't exist yet -- it never
    alters an existing one, so adding a column to a model (as this app has
    already done more than once) does nothing for a database that already
    has that table from a previous deploy. There's no migration framework
    here (see CLAUDE.md) and the app auto-deploys on every push with no
    manual step in between, so without this, every such model change is a
    ticking outage for the next deploy against the persisted database file.
    Additive only: no renames, drops, or type changes -- exactly the
    `ALTER TABLE ADD COLUMN` a developer would otherwise run by hand."""
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {col["name"] for col in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                ddl_type = column.type.compile(engine.dialect)
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN "{column.name}" {ddl_type}'))
                default = _default_value(column)
                if default is not None:
                    conn.execute(
                        text(f'UPDATE {table.name} SET "{column.name}" = :value WHERE "{column.name}" IS NULL'),
                        {"value": default},
                    )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
