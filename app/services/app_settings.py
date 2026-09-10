from sqlalchemy.orm import Session

from app.models import AppSettings


def get_app_settings(db: Session) -> AppSettings:
    """The single AppSettings row, creating it on first access -- there's no
    setup step that seeds it, so the first read or write just makes it."""
    row = db.get(AppSettings, 1)
    if row is None:
        row = AppSettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row
