from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Blacklist, Rating, Restaurant, Search, User
from app.schemas import NotifyTeamsRequest, RateRequest, RestaurantOut, SuggestRequest, SuggestResponse
from app.services import teams_notify
from app.services.recommend import (
    build_candidates,
    pick_suggestion,
    record_seen_cuisines,
    search_and_cache_restaurants,
)

router = APIRouter(prefix="/api/restaurants", tags=["restaurants"])


def _to_out(candidate: dict) -> RestaurantOut:
    restaurant: Restaurant = candidate["restaurant"]
    out = RestaurantOut.model_validate(restaurant)
    out.distance_m = candidate["distance_m"]
    out.personal_rating = candidate["personal_rating"]
    out.companion_rating = candidate["companion_rating"]
    out.companion_rating_count = candidate["companion_rating_count"]
    out.combined_rating = candidate["combined_rating"]
    return out


@router.post("/suggest", response_model=SuggestResponse)
def suggest(body: SuggestRequest, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    companions = []
    if body.companion_ids:
        companions = list(db.scalars(select(User).where(User.id.in_(body.companion_ids))))

    restaurants = search_and_cache_restaurants(db, body.lat, body.lng, body.radius_m)
    record_seen_cuisines(current, restaurants)
    db.add(Search(user_id=current.id))
    db.commit()
    candidates = build_candidates(db, restaurants, body.lat, body.lng, body.radius_m, current, companions)
    pick = pick_suggestion(candidates)

    alternatives = [c for c in candidates if pick is None or c["restaurant"].id != pick["restaurant"].id]
    return SuggestResponse(
        pick=_to_out(pick) if pick else None,
        alternatives=[_to_out(c) for c in alternatives],
    )


@router.get("/search", response_model=list[RestaurantOut])
def search(q: str, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    """Used to find a restaurant for logging a visit that didn't come from
    "Find lunch". Searches only restaurants already cached locally (from
    past "Find lunch" searches by anyone) rather than calling Google's live
    Text Search -- if it's not in the cache, nobody's searched near it yet."""
    results = db.scalars(select(Restaurant).where(Restaurant.name.ilike(f"%{q}%"))).all()
    return [RestaurantOut.model_validate(r) for r in results[:10]]


@router.post("/{restaurant_id}/rate", response_model=RestaurantOut)
def rate_restaurant(restaurant_id: int, body: RateRequest, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    restaurant = db.get(Restaurant, restaurant_id)
    if restaurant is None:
        raise HTTPException(status_code=404, detail="Restaurant not found")

    existing = db.scalar(
        select(Rating).where(Rating.user_id == current.id, Rating.restaurant_id == restaurant_id)
    )
    if existing:
        existing.stars = body.stars
    else:
        db.add(Rating(user_id=current.id, restaurant_id=restaurant_id, stars=body.stars))
    db.commit()
    return RestaurantOut.model_validate(restaurant)


@router.delete("/{restaurant_id}/rate", status_code=204)
def delete_rating(restaurant_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    existing = db.scalar(
        select(Rating).where(Rating.user_id == current.id, Rating.restaurant_id == restaurant_id)
    )
    if existing is not None:
        db.delete(existing)
        db.commit()


@router.post("/{restaurant_id}/notify-teams", status_code=204)
def notify_teams(
    restaurant_id: int,
    body: NotifyTeamsRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    if not current.can_notify_teams:
        raise HTTPException(status_code=403, detail="Teams notifications aren't enabled for your account")

    if current.team_id is None:
        raise HTTPException(status_code=400, detail="You're not in a team yet -- set one in your account settings")
    webhook_url = current.team.teams_webhook_url
    if not webhook_url:
        raise HTTPException(status_code=400, detail="Your team doesn't have a Teams webhook configured yet -- ask an admin to set one")

    restaurant = db.get(Restaurant, restaurant_id)
    if restaurant is None:
        raise HTTPException(status_code=404, detail="Restaurant not found")

    companions = []
    if body.companion_ids:
        companions = list(db.scalars(select(User).where(User.id.in_(body.companion_ids))))
    names = [current.display_name] + [c.display_name for c in companions]

    lines = [f"🍽️ {current.display_name} picked {restaurant.name}", restaurant.address]
    if len(names) > 1:
        lines.append(f"Joining: {', '.join(names)}")
    if restaurant.maps_url:
        lines.append(restaurant.maps_url)

    try:
        teams_notify.notify(
            webhook_url,
            {
                "text": "\n".join(lines),
                "restaurant": restaurant.name,
                "address": restaurant.address,
                "mapsUrl": restaurant.maps_url,
                "requestedBy": current.display_name,
                "companions": names,
            },
        )
    except teams_notify.TeamsNotifyError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.post("/{restaurant_id}/blacklist", status_code=204)
def blacklist_restaurant(restaurant_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    restaurant = db.get(Restaurant, restaurant_id)
    if restaurant is None:
        raise HTTPException(status_code=404, detail="Restaurant not found")

    existing = db.scalar(
        select(Blacklist).where(Blacklist.user_id == current.id, Blacklist.restaurant_id == restaurant_id)
    )
    if existing is None:
        db.add(Blacklist(user_id=current.id, restaurant_id=restaurant_id))
        db.commit()


@router.delete("/{restaurant_id}/blacklist", status_code=204)
def unblacklist_restaurant(restaurant_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    existing = db.scalar(
        select(Blacklist).where(Blacklist.user_id == current.id, Blacklist.restaurant_id == restaurant_id)
    )
    if existing is not None:
        db.delete(existing)
        db.commit()
