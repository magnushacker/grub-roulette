"""Thin client for the Places API (New) "Nearby Search" and "Text Search" endpoints.

Unlike the legacy Places API, this one returns cuisine-specific place types
(italian_restaurant, asian_restaurant, ...) instead of just generic venue
categories, which is what actually lets us show/filter by cuisine.
"""

import httpx

from app.config import settings

NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"

FIELD_MASK = ",".join(
    [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.location",
        "places.types",
        "places.priceLevel",
        "places.rating",
        "places.userRatingCount",
        "places.googleMapsUri",
    ]
)

# Nationality/style types from the Places API (New) taxonomy that actually mean
# something as a "cuisine". Most of Google's food-related types are venue
# formats (bakery, cafe, fast_food_restaurant, ...) rather than cuisines, so we
# whitelist the ones that are instead of trying to blacklist everything that isn't.
CUISINE_TYPES = {
    "afghani_restaurant",
    "african_restaurant",
    "american_restaurant",
    "asian_restaurant",
    "barbecue_restaurant",
    "brazilian_restaurant",
    "chinese_restaurant",
    "french_restaurant",
    "greek_restaurant",
    "hamburger_restaurant",
    "indian_restaurant",
    "indonesian_restaurant",
    "italian_restaurant",
    "japanese_restaurant",
    "korean_restaurant",
    "lebanese_restaurant",
    "mediterranean_restaurant",
    "mexican_restaurant",
    "middle_eastern_restaurant",
    "pizza_restaurant",
    "ramen_restaurant",
    "seafood_restaurant",
    "spanish_restaurant",
    "steak_house",
    "sushi_restaurant",
    "thai_restaurant",
    "turkish_restaurant",
    "vegan_restaurant",
    "vegetarian_restaurant",
    "vietnamese_restaurant",
}

PRICE_LEVELS = {
    "PRICE_LEVEL_FREE": 0,
    "PRICE_LEVEL_INEXPENSIVE": 1,
    "PRICE_LEVEL_MODERATE": 2,
    "PRICE_LEVEL_EXPENSIVE": 3,
    "PRICE_LEVEL_VERY_EXPENSIVE": 4,
}


class GooglePlacesError(RuntimeError):
    pass


def _cuisine_label(place_type: str) -> str:
    return place_type.removesuffix("_restaurant").replace("_", " ")


def _normalize(place: dict) -> dict:
    location = place.get("location", {})
    return {
        "google_place_id": place.get("id"),
        "name": place.get("displayName", {}).get("text", ""),
        "address": place.get("formattedAddress") or "",
        "lat": location.get("latitude"),
        "lng": location.get("longitude"),
        "cuisines": [_cuisine_label(t) for t in place.get("types", []) if t in CUISINE_TYPES],
        "price_level": PRICE_LEVELS.get(place.get("priceLevel")),
        "google_rating": place.get("rating"),
        "google_rating_count": place.get("userRatingCount"),
        "maps_url": place.get("googleMapsUri"),
    }


def _headers() -> dict:
    return {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": FIELD_MASK,
    }


def nearby_restaurants(lat: float, lng: float, radius_m: int) -> list[dict]:
    if not settings.google_places_api_key:
        return []

    body = {
        "includedTypes": ["restaurant"],
        "maxResultCount": 20,
        "locationRestriction": {
            "circle": {"center": {"latitude": lat, "longitude": lng}, "radius": min(radius_m, 50000)}
        },
    }
    with httpx.Client(timeout=10.0) as client:
        resp = client.post(NEARBY_URL, json=body, headers=_headers())
        if resp.status_code != 200:
            raise GooglePlacesError(f"Google Places error: {resp.status_code} - {resp.text}")
        data = resp.json()
        return [_normalize(p) for p in data.get("places", [])]


def text_search_restaurants(query: str, lat: float | None = None, lng: float | None = None) -> list[dict]:
    if not settings.google_places_api_key or not query.strip():
        return []

    body: dict = {"textQuery": f"{query} restaurant"}
    if lat is not None and lng is not None:
        body["locationBias"] = {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": 20000}}

    with httpx.Client(timeout=10.0) as client:
        resp = client.post(TEXT_SEARCH_URL, json=body, headers=_headers())
        if resp.status_code != 200:
            raise GooglePlacesError(f"Google Places error: {resp.status_code} - {resp.text}")
        data = resp.json()
        return [_normalize(p) for p in data.get("places", [])]
