from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Blacklist, Rating, Restaurant, User
from app.schemas import RateRequest, RestaurantOut, SuggestRequest, SuggestResponse
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
    db.commit()
    candidates = build_candidates(db, restaurants, body.lat, body.lng, body.radius_m, current, companions)
    pick = pick_suggestion(candidates)

    alternatives = [c for c in candidates if pick is None or c["restaurant"].id != pick["restaurant"].id]
    return SuggestResponse(
        pick=_to_out(pick) if pick else None,
        alternatives=[_to_out(c) for c in alternatives],
    )


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
