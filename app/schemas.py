import datetime as dt

from pydantic import BaseModel, Field


class SuggestRequest(BaseModel):
    lat: float
    lng: float
    radius_m: int = Field(default=1500, ge=300, le=2000)
    companion_ids: list[int] = Field(default_factory=list)


class RestaurantOut(BaseModel):
    id: int
    name: str
    address: str
    lat: float
    lng: float
    cuisines: list[str]
    price_level: int | None
    google_rating: float | None
    google_rating_count: int | None
    yelp_rating: float | None
    yelp_rating_count: int | None
    maps_url: str | None
    distance_m: float | None = None
    personal_rating: float | None = None
    combined_rating: float | None = None

    model_config = {"from_attributes": True}


class SuggestResponse(BaseModel):
    pick: RestaurantOut | None
    alternatives: list[RestaurantOut]


class RateRequest(BaseModel):
    stars: int = Field(ge=1, le=5)


class VisitRequest(BaseModel):
    restaurant_id: int
    was_suggested: bool = True
    companion_ids: list[int] = Field(default_factory=list)


class PreferencesRequest(BaseModel):
    disliked_cuisines: list[str]
    preferred_cuisines: list[str] = Field(default_factory=list)
    default_companion_ids: list[int] = Field(default_factory=list)
    default_lat: float | None = None
    default_lng: float | None = None


class UserOut(BaseModel):
    id: int
    display_name: str
    group_id: int | None
    disliked_cuisines: list[str]
    preferred_cuisines: list[str]
    default_companion_ids: list[int]
    default_lat: float | None
    default_lng: float | None

    model_config = {"from_attributes": True}


class GroupOut(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class GroupCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class AdminUserOut(BaseModel):
    id: int
    display_name: str
    is_admin: bool
    group_id: int | None
    created_at: dt.datetime

    model_config = {"from_attributes": True}


class UpdateGroupRequest(BaseModel):
    group_id: int | None = None


class AdminResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8)


class BlacklistEntryOut(BaseModel):
    restaurant_id: int
    name: str
    address: str


class RatingEntryOut(BaseModel):
    restaurant_id: int
    name: str
    address: str
    stars: int
