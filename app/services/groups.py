from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Group


def get_or_create_group(db: Session, name: str) -> Group:
    name = name.strip()
    existing = db.scalar(select(Group).where(func.lower(Group.name) == name.lower()))
    if existing is not None:
        return existing
    group = Group(name=name)
    db.add(group)
    db.flush()
    return group
