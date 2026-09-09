import datetime as dt

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Blacklist, Rating, User, Visit
from app.schemas import BlacklistEntryOut, PreferencesRequest, RatingEntryOut, UpdateGroupRequest, UserOut, VisitEntryOut

RECENT_VISIT_DAYS = 7

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    users = db.scalars(select(User).order_by(User.display_name)).all()
    others = [u for u in users if u.id != current.id]
    if current.group_id is not None:
        others.sort(key=lambda u: u.group_id != current.group_id)
    return others


@router.get("/me", response_model=UserOut)
def get_me(current: User = Depends(get_current_user)):
    return current


@router.patch("/me", response_model=UserOut)
def update_preferences(body: PreferencesRequest, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    # A cuisine in both lists is a state the UI can't produce and the algorithm
    # can't honour — build_candidates filters disliked before the preferred
    # bonus applies — so drop the contradiction rather than store it.
    disliked_lower = {c.lower() for c in body.disliked_cuisines}
    current.disliked_cuisines = body.disliked_cuisines
    current.preferred_cuisines = [c for c in body.preferred_cuisines if c.lower() not in disliked_lower]
    current.default_companion_ids = body.default_companion_ids
    current.default_lat = body.default_lat
    current.default_lng = body.default_lng
    current.default_radius_m = body.default_radius_m
    db.commit()
    db.refresh(current)
    return current


@router.patch("/me/group", response_model=UserOut)
def update_my_group(body: UpdateGroupRequest, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    current.group_id = body.group_id
    db.commit()
    db.refresh(current)
    return current


@router.get("/me/blacklist", response_model=list[BlacklistEntryOut])
def my_blacklist(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    entries = db.scalars(select(Blacklist).where(Blacklist.user_id == current.id)).all()
    return [
        BlacklistEntryOut(restaurant_id=e.restaurant_id, name=e.restaurant.name, address=e.restaurant.address)
        for e in entries
    ]


@router.get("/me/ratings", response_model=list[RatingEntryOut])
def my_ratings(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    entries = db.scalars(select(Rating).where(Rating.user_id == current.id)).all()
    return [
        RatingEntryOut(restaurant_id=e.restaurant_id, name=e.restaurant.name, address=e.restaurant.address, stars=e.stars)
        for e in entries
    ]


@router.get("/me/visits", response_model=list[VisitEntryOut])
def my_visits(all: bool = False, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    query = select(Visit).where(Visit.user_id == current.id)
    if not all:
        query = query.where(Visit.visit_date >= dt.date.today() - dt.timedelta(days=RECENT_VISIT_DAYS))
    entries = db.scalars(query.order_by(Visit.visit_date.desc())).all()

    return [
        VisitEntryOut(
            id=e.id,
            restaurant_id=e.restaurant_id,
            name=e.restaurant.name,
            address=e.restaurant.address,
            visit_date=e.visit_date,
            was_suggested=e.was_suggested,
        )
        for e in entries
    ]
