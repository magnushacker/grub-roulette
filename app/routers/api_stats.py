import datetime as dt

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Blacklist, Rating, Restaurant, Search, Team, User, Visit
from app.schemas import StatsOut

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("", response_model=StatsOut)
def get_stats(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    def count(model, *where) -> int:
        stmt = select(func.count()).select_from(model)
        if where:
            stmt = stmt.where(*where)
        return db.scalar(stmt)

    week_ago = dt.datetime.utcnow() - dt.timedelta(days=7)
    return StatsOut(
        total_users=count(User),
        total_teams=count(Team),
        total_searches=count(Search),
        searches_last_7_days=count(Search, Search.created_at >= week_ago),
        total_visits=count(Visit),
        total_ratings=count(Rating),
        average_rating=db.scalar(select(func.avg(Rating.stars))),
        total_blacklist_entries=count(Blacklist),
        total_restaurants_cached=count(Restaurant),
    )
