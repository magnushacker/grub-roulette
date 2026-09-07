from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Group, User
from app.schemas import GroupCreateRequest, GroupOut
from app.services.groups import get_or_create_group

router = APIRouter(prefix="/api/groups", tags=["groups"])


@router.get("", response_model=list[GroupOut])
def list_groups(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    return db.scalars(select(Group).order_by(Group.name)).all()


@router.post("", response_model=GroupOut)
def create_group(body: GroupCreateRequest, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    group = get_or_create_group(db, body.name)
    db.commit()
    db.refresh(group)
    return group
