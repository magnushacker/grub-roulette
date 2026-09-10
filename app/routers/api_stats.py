import datetime as dt

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Blacklist, Group, Rating, Restaurant, Search, User, Visit
from app.schemas import SearchDayCount, StatsOut

router = APIRouter(prefix="/api/stats", tags=["stats"])

SEARCHES_BY_DAY_WINDOW = 14


@router.get("", response_model=StatsOut)
def get_stats(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    def count(model, *where) -> int:
        stmt = select(func.count()).select_from(model)
        if where:
            stmt = stmt.where(*where)
        return db.scalar(stmt)

    week_ago = dt.datetime.utcnow() - dt.timedelta(days=7)

    # SQLite has no native date type, so func.date() gives back "YYYY-MM-DD"
    # strings -- which is also exactly dt.date.isoformat(), so the two line
    # up as dict keys below without extra parsing.
    window_start = dt.date.today() - dt.timedelta(days=SEARCHES_BY_DAY_WINDOW - 1)
    rows = db.execute(
        select(func.date(Search.created_at), func.count())
        .where(Search.created_at >= dt.datetime.combine(window_start, dt.time.min))
        .group_by(func.date(Search.created_at))
    ).all()
    counts_by_day = dict(rows)
    searches_by_day = [
        SearchDayCount(
            date=window_start + dt.timedelta(days=i),
            count=counts_by_day.get((window_start + dt.timedelta(days=i)).isoformat(), 0),
        )
        for i in range(SEARCHES_BY_DAY_WINDOW)
    ]

    return StatsOut(
        total_users=count(User),
        total_groups=count(Group),
        total_searches=count(Search),
        searches_last_7_days=count(Search, Search.created_at >= week_ago),
        searches_by_day=searches_by_day,
        total_visits=count(Visit),
        total_ratings=count(Rating),
        average_rating=db.scalar(select(func.avg(Rating.stars))),
        total_blacklist_entries=count(Blacklist),
        total_restaurants_cached=count(Restaurant),
    )
