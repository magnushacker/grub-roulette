from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Team


def get_or_create_team(db: Session, name: str) -> Team:
    name = name.strip()
    existing = db.scalar(select(Team).where(func.lower(Team.name) == name.lower()))
    if existing is not None:
        return existing
    team = Team(name=name)
    db.add(team)
    db.flush()
    return team
