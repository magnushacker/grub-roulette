"""Thin client for the Yelp Fusion "Business Search" endpoint."""

import httpx

from app.config import settings

SEARCH_URL = "https://api.yelp.com/v3/businesses/search"

# Yelp's category list mixes real cuisines ("Italian", "Thai") with venue formats,
# meal times, and drink types ("Food Trucks", "Sports Bars", "Breakfast & Brunch").
# There's no clean flag to tell them apart, so we blacklist the common non-cuisine
# ones instead of trying to whitelist the much longer (and Yelp-specific) list of
# actual cuisines.
NON_CUISINE_CATEGORIES = {
    "food trucks", "food stands", "food court", "buffets", "diners", "delis",
    "fast food", "comfort food", "breakfast & brunch", "brunch", "cafes",
    "coffee & tea", "coffeeshops", "coffee roasteries", "bakeries", "desserts",
    "ice cream & frozen yogurt", "juice bars & smoothies", "bars", "sports bars",
    "dive bars", "pubs", "beer bar", "wine bars", "cocktail bars", "gastropubs",
    "lounges", "bagels", "donuts", "candy stores", "chocolatiers & shops",
    "food delivery services", "grocery", "convenience stores", "caterers",
    "personal chefs", "specialty food", "farmers market", "imported food",
    "butcher", "fishmonger", "cheese shops", "beer, wine & spirits", "beer gardens",
}


def _normalize(biz: dict) -> dict:
    coords = biz.get("coordinates", {})
    return {
        "yelp_id": biz.get("id"),
        "name": biz.get("name", ""),
        "address": ", ".join(biz.get("location", {}).get("display_address", [])),
        "lat": coords.get("latitude"),
        "lng": coords.get("longitude"),
        "cuisines": [
            c.get("title")
            for c in biz.get("categories", [])
            if c.get("title", "").lower() not in NON_CUISINE_CATEGORIES
        ],
        "price_level": len(biz.get("price", "")) or None,
        "yelp_rating": biz.get("rating"),
        "yelp_rating_count": biz.get("review_count"),
        "yelp_url": biz.get("url"),
    }


def nearby_restaurants(lat: float, lng: float, radius_m: int) -> list[dict]:
    if not settings.yelp_api_key:
        return []

    headers = {"Authorization": f"Bearer {settings.yelp_api_key}"}
    params = {
        "latitude": lat,
        "longitude": lng,
        "radius": min(radius_m, 40000),
        "term": "restaurants",
        "categories": "restaurants",
        "limit": 50,
        "sort_by": "best_match",
    }
    with httpx.Client(timeout=10.0) as client:
        resp = client.get(SEARCH_URL, headers=headers, params=params)
        if resp.status_code != 200:
            raise YelpError(f"Yelp error: {resp.status_code} - {resp.text}")
        data = resp.json()
        return [_normalize(b) for b in data.get("businesses", [])]
