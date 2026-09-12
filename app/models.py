from __future__ import annotations

import datetime as dt

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db_base import Base


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)

    members: Mapped[list["User"]] = relationship(back_populates="team")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    display_name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_admin: Mapped[bool] = mapped_column(default=False)
    # Accounts created before email verification existed have no email on file,
    # so they're grandfathered in as verified rather than being locked out.
    email_verified: Mapped[bool] = mapped_column(default=True)
    verification_token: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True, index=True)
    verification_sent_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"), nullable=True)
    disliked_cuisines: Mapped[list[str]] = mapped_column(JSON, default=list)
    preferred_cuisines: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Every cuisine this user has ever had turn up in a nearby/text search
    # result, so the settings page can offer more than whatever happens to
    # be in the current page session's in-memory list.
    seen_cuisines: Mapped[list[str]] = mapped_column(JSON, default=list)
    default_companion_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    default_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    default_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    default_radius_m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    team: Mapped["Team | None"] = relationship(back_populates="members")
    ratings: Mapped[list["Rating"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    blacklist_entries: Mapped[list["Blacklist"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    visits: Mapped[list["Visit"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Restaurant(Base):
    __tablename__ = "restaurants"

    id: Mapped[int] = mapped_column(primary_key=True)
    google_place_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    yelp_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    address: Mapped[str] = mapped_column(String(512), default="")
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    cuisines: Mapped[list[str]] = mapped_column(JSON, default=list)
    price_level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    google_rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    google_rating_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    yelp_rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    yelp_rating_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    maps_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    website_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    last_fetched: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    ratings: Mapped[list["Rating"]] = relationship(back_populates="restaurant", cascade="all, delete-orphan")
    blacklist_entries: Mapped[list["Blacklist"]] = relationship(back_populates="restaurant", cascade="all, delete-orphan")
    visits: Mapped[list["Visit"]] = relationship(back_populates="restaurant", cascade="all, delete-orphan")


class Rating(Base):
    __tablename__ = "ratings"
    __table_args__ = (UniqueConstraint("user_id", "restaurant_id", name="uq_rating_user_restaurant"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id"))
    stars: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="ratings")
    restaurant: Mapped["Restaurant"] = relationship(back_populates="ratings")


class Blacklist(Base):
    __tablename__ = "blacklist"
    __table_args__ = (UniqueConstraint("user_id", "restaurant_id", name="uq_blacklist_user_restaurant"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="blacklist_entries")
    restaurant: Mapped["Restaurant"] = relationship(back_populates="blacklist_entries")


class Search(Base):
    """One row per POST /api/restaurants/suggest call, purely for the admin
    usage-stats panel -- nothing else in the app reads this table."""

    __tablename__ = "searches"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class Visit(Base):
    __tablename__ = "visits"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id"))
    visit_date: Mapped[dt.date] = mapped_column(Date, default=dt.date.today)
    was_suggested: Mapped[bool] = mapped_column(default=True)
    companion_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="visits")
    restaurant: Mapped["Restaurant"] = relationship(back_populates="visits")
