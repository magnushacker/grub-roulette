"""Restaurant search, merge, and scoring/selection logic."""

from __future__ import annotations

import datetime as dt
import difflib
import math
import random

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Blacklist, Rating, Restaurant, User, Visit
from app.services import google_places, yelp

# Weights for the final ranking score. Rating matters most, then distance,
# then whether the cuisine is one a participant prefers, then a random nudge
# so the same top pick doesn't always win.
RATING_WEIGHT = 0.45
DISTANCE_WEIGHT = 0.25
PREFERRED_CUISINE_WEIGHT = 0.15
RANDOM_WEIGHT = 0.15

# How many of the top-scored candidates are eligible for the final weighted-random pick.
TOP_K = 8

# When a participant has rated this exact restaurant, that rating dominates the external
# one. When nobody has, but a participant has rated other restaurants sharing a cuisine
# with this one, that inferred "cuisine affinity" is used instead, with less confidence
# than a direct rating would get.
DIRECT_RATING_BLEND = 0.7
CUISINE_AFFINITY_BLEND = 0.4

NAME_MATCH_THRESHOLD = 0.6
MERGE_DISTANCE_M = 75


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _merge_sources(google_results: list[dict], yelp_results: list[dict]) -> list[dict]:
    """Attach a matching Yelp business (if any) onto each Google result."""
    remaining_yelp = list(yelp_results)
    merged = []
    for g in google_results:
        match = None
        for y in remaining_yelp:
            if g["lat"] is None or y["lat"] is None:
                continue
            dist = haversine_m(g["lat"], g["lng"], y["lat"], y["lng"])
            if dist > MERGE_DISTANCE_M:
                continue
            similarity = difflib.SequenceMatcher(None, g["name"].lower(), y["name"].lower()).ratio()
            if similarity >= NAME_MATCH_THRESHOLD:
                match = y
                break
        combined = dict(g)
        if match:
            combined["yelp_id"] = match["yelp_id"]
            combined["yelp_rating"] = match["yelp_rating"]
            combined["yelp_rating_count"] = match["yelp_rating_count"]
            combined["cuisines"] = sorted(set(g["cuisines"]) | set(match["cuisines"]))
            remaining_yelp.remove(match)
        merged.append(combined)

    # Any Yelp-only businesses (Google found nothing nearby that matched) still count.
    for y in remaining_yelp:
        merged.append(
            {
                "google_place_id": None,
                "yelp_id": y["yelp_id"],
                "name": y["name"],
                "address": y["address"],
                "lat": y["lat"],
                "lng": y["lng"],
                "cuisines": y["cuisines"],
                "price_level": y["price_level"],
                "google_rating": None,
                "google_rating_count": None,
                "yelp_rating": y["yelp_rating"],
                "yelp_rating_count": y["yelp_rating_count"],
                "maps_url": None,
            }
        )
    return merged


def _upsert_restaurant(db: Session, data: dict) -> Restaurant:
    restaurant = None
    if data.get("google_place_id"):
        restaurant = db.scalar(select(Restaurant).where(Restaurant.google_place_id == data["google_place_id"]))
    if restaurant is None and data.get("yelp_id"):
        restaurant = db.scalar(select(Restaurant).where(Restaurant.yelp_id == data["yelp_id"]))

    if restaurant is None:
        restaurant = Restaurant(
            google_place_id=data.get("google_place_id"),
            yelp_id=data.get("yelp_id"),
            name=data["name"],
            address=data.get("address", ""),
            lat=data["lat"],
            lng=data["lng"],
            cuisines=[],
        )
        db.add(restaurant)

    restaurant.name = data["name"] or restaurant.name
    restaurant.address = data.get("address") or restaurant.address
    restaurant.lat = data["lat"]
    restaurant.lng = data["lng"]
    restaurant.cuisines = data.get("cuisines") or restaurant.cuisines or []
    if data.get("price_level") is not None:
        restaurant.price_level = data["price_level"]
    if data.get("google_rating") is not None:
        restaurant.google_rating = data["google_rating"]
        restaurant.google_rating_count = data.get("google_rating_count")
    if data.get("yelp_rating") is not None:
        restaurant.yelp_rating = data["yelp_rating"]
        restaurant.yelp_rating_count = data.get("yelp_rating_count")
    if data.get("google_place_id"):
        restaurant.google_place_id = data["google_place_id"]
    if data.get("yelp_id"):
        restaurant.yelp_id = data["yelp_id"]
    if data.get("maps_url"):
        restaurant.maps_url = data["maps_url"]
    restaurant.last_fetched = dt.datetime.utcnow()
    return restaurant


def search_and_cache_restaurants(db: Session, lat: float, lng: float, radius_m: int) -> list[Restaurant]:
    google_results = google_places.nearby_restaurants(lat, lng, radius_m)
    yelp_results = yelp.nearby_restaurants(lat, lng, radius_m)
    merged = _merge_sources(google_results, yelp_results)

    restaurants = [_upsert_restaurant(db, data) for data in merged if data.get("lat") is not None]
    db.commit()
    return restaurants


def record_seen_cuisines(user: User, restaurants: list[Restaurant]) -> None:
    """Grow the user's all-time "cuisines I've encountered while searching"
    list, case-insensitively deduped against what's already there."""
    seen = {c.lower(): c for c in user.seen_cuisines}
    changed = False
    for restaurant in restaurants:
        for cuisine in restaurant.cuisines or []:
            key = cuisine.lower()
            if key not in seen:
                seen[key] = cuisine
                changed = True
    if changed:
        user.seen_cuisines = list(seen.values())


def _external_rating(restaurant: Restaurant) -> float:
    ratings = [r for r in (restaurant.google_rating, restaurant.yelp_rating) if r is not None]
    return sum(ratings) / len(ratings) if ratings else 3.0


def _personal_rating(restaurant: Restaurant, participant_ids: list[int]) -> float | None:
    scores = [r.stars for r in restaurant.ratings if r.user_id in participant_ids]
    return sum(scores) / len(scores) if scores else None


def _rating_for_user(restaurant: Restaurant, user_id: int) -> int | None:
    for rating in restaurant.ratings:
        if rating.user_id == user_id:
            return rating.stars
    return None


def _companion_rating_summary(restaurant: Restaurant, companion_ids: list[int]) -> tuple[float | None, int]:
    """Average + count of companions' (not the requester's own) ratings, so
    the UI can show "you rated this" and "colleagues rated this" as two
    distinct, honestly-labeled numbers instead of one blended figure that
    silently mixes the two."""
    scores = [r.stars for r in restaurant.ratings if r.user_id in companion_ids]
    if not scores:
        return None, 0
    return sum(scores) / len(scores), len(scores)


def _cuisine_affinity_map(db: Session, participant_ids: list[int]) -> dict[str, float]:
    """Average star rating participants have given, per cuisine, across all restaurants they've rated."""
    rows = db.execute(
        select(Rating.stars, Restaurant.cuisines)
        .join(Restaurant, Rating.restaurant_id == Restaurant.id)
        .where(Rating.user_id.in_(participant_ids))
    ).all()
    cuisine_stars: dict[str, list[int]] = {}
    for stars, cuisines in rows:
        for c in cuisines or []:
            cuisine_stars.setdefault(c.lower(), []).append(stars)
    return {c: sum(stars) / len(stars) for c, stars in cuisine_stars.items()}


def _cuisine_affinity_rating(restaurant: Restaurant, cuisine_affinity: dict[str, float]) -> float | None:
    matches = [cuisine_affinity[c.lower()] for c in restaurant.cuisines if c.lower() in cuisine_affinity]
    return sum(matches) / len(matches) if matches else None


def build_candidates(
    db: Session,
    restaurants: list[Restaurant],
    origin_lat: float,
    origin_lng: float,
    radius_m: int,
    requester: User,
    companions: list[User],
) -> list[dict]:
    participants = [requester] + companions
    participant_ids = [u.id for u in participants]
    disliked_cuisines = {c.lower() for u in participants for c in u.disliked_cuisines}
    preferred_cuisines = {c.lower() for u in participants for c in u.preferred_cuisines}
    cuisine_affinity = _cuisine_affinity_map(db, participant_ids)

    blacklisted_ids = {
        b.restaurant_id
        for b in db.scalars(select(Blacklist).where(Blacklist.user_id.in_(participant_ids)))
    }

    cutoff = dt.date.today() - dt.timedelta(days=settings.exclude_days)
    recently_visited_ids = {
        v.restaurant_id
        for v in db.scalars(
            select(Visit).where(Visit.user_id == requester.id, Visit.visit_date >= cutoff)
        )
    }

    candidates = []
    for restaurant in restaurants:
        if restaurant.id in blacklisted_ids or restaurant.id in recently_visited_ids:
            continue
        if disliked_cuisines and any(c.lower() in disliked_cuisines for c in restaurant.cuisines):
            continue

        distance_m = haversine_m(origin_lat, origin_lng, restaurant.lat, restaurant.lng)
        if distance_m > radius_m:
            continue

        personal = _personal_rating(restaurant, participant_ids)
        requester_rating = _rating_for_user(restaurant, requester.id)
        companion_rating, companion_rating_count = _companion_rating_summary(
            restaurant, [c.id for c in companions]
        )
        external = _external_rating(restaurant)
        if personal is not None:
            combined_rating = DIRECT_RATING_BLEND * personal + (1 - DIRECT_RATING_BLEND) * external
        else:
            affinity = _cuisine_affinity_rating(restaurant, cuisine_affinity)
            if affinity is not None:
                combined_rating = CUISINE_AFFINITY_BLEND * affinity + (1 - CUISINE_AFFINITY_BLEND) * external
            else:
                combined_rating = external

        norm_distance = min(distance_m / radius_m, 1.0)
        is_preferred = any(c.lower() in preferred_cuisines for c in restaurant.cuisines)
        score = (
            RATING_WEIGHT * (combined_rating / 5)
            + DISTANCE_WEIGHT * (1 - norm_distance)
            + PREFERRED_CUISINE_WEIGHT * (1.0 if is_preferred else 0.0)
            + RANDOM_WEIGHT * random.random()
        )

        candidates.append(
            {
                "restaurant": restaurant,
                "distance_m": distance_m,
                "combined_rating": combined_rating,
                "personal_rating": requester_rating,
                "companion_rating": companion_rating,
                "companion_rating_count": companion_rating_count,
                "score": score,
            }
        )

    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates


def pick_suggestion(candidates: list[dict]) -> dict | None:
    if not candidates:
        return None
    top = candidates[:TOP_K]
    weights = [max(c["score"], 0.001) for c in top]
    return random.choices(top, weights=weights, k=1)[0]
