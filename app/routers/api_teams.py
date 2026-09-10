from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Team, User
from app.schemas import TeamCreateRequest, TeamOut
from app.services.teams import get_or_create_team

router = APIRouter(prefix="/api/teams", tags=["teams"])


@router.get("", response_model=list[TeamOut])
def list_teams(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    return db.scalars(select(Team).order_by(Team.name)).all()


@router.post("", response_model=TeamOut)
def create_team(body: TeamCreateRequest, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    team = get_or_create_team(db, body.name)
    db.commit()
    db.refresh(team)
    return team
