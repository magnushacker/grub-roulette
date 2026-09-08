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

    Base.metadata.create_all(bind=engine)
    _add_missing_columns()


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
