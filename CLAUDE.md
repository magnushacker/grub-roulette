# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Grub Roulette: a small internal web app for picking where to go for lunch. Sorts
nearby restaurants by distance from a chosen point, blends in ratings, and makes a
weighted-random pick so the group doesn't always land on the same place. Supports
per-user blacklists, disliked/preferred cuisines, companions (whose dislikes also
get filtered), and recent-visit exclusion.

## Stack

- **Backend:** FastAPI + SQLAlchemy 2.0 (typed `Mapped[...]` models), SQLite
- **Frontend:** server-rendered Jinja2 pages + vanilla JS (no build step, no bundler) + Google Maps JavaScript API
- **Auth:** built-in name/password accounts, signed session cookies (`SessionMiddleware`), optional email verification via Resend
- **External data:** Google Places API (New)

There is no test suite, linter, or formatter configured in this repo.

## Commands

```
python -m venv .venv && source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env      # then fill in SECRET_KEY at minimum; see .env.example for API keys
python run.py             # runs uvicorn app.main:app on 127.0.0.1:8000 with reload=True
```

The app runs with no external API keys set, but restaurant search returns nothing
until `GOOGLE_PLACES_API_KEY` is set, and the map won't render until
`GOOGLE_MAPS_JS_API_KEY` (or a fallback to `GOOGLE_PLACES_API_KEY`) is usable.

Database tables are created automatically on startup (`init_db()` in
`app/database.py`, called from the `startup` event in `app/main.py`) — there are
no migrations; schema changes just require an updated model plus a fresh
`lunch.db` (or manual `ALTER TABLE`) in dev.

## Architecture

**Request flow:** `app/main.py` wires up `SessionMiddleware` and mounts each
router in `app/routers/`. Routers depend on `app/deps.py`
(`get_current_user_optional` / `get_current_user` / `get_current_admin`) for auth,
reading `request.session["user_id"]` set at login. `app/routers/pages.py` serves
the two server-rendered pages (`dashboard.html`, `admin.html`); everything else the
frontend needs comes from JSON endpoints under `/api/*` consumed by
`app/static/js/{dashboard,admin,account}.js`.

**The suggestion algorithm** (`app/services/recommend.py`) is the core logic, run
per-request from `POST /api/restaurants/suggest`:
1. `search_and_cache_restaurants` fetches from `google_places.nearby_restaurants`
   and upserts each result into the `restaurants` table (`_upsert_restaurant`,
   keyed on `google_place_id`) so ratings, blacklist entries, and visit history
   persist across searches.
2. `build_candidates` filters out anything blacklisted by the requester or any
   companion, anything matching a disliked cuisine of the requester or a
   companion, and anything the *requester* (not companions) visited within the
   admin-configurable `AppSettings.exclude_days` window (`app/services/app_settings.py`,
   editable from `/admin`). Each remaining restaurant gets a blended rating — a direct
   personal rating if any participant rated it (`DIRECT_RATING_BLEND`), else an
   inferred "cuisine affinity" from participants' ratings of *other* restaurants
   sharing a cuisine (`CUISINE_AFFINITY_BLEND`), else just the external Google
   rating — then a weighted score from rating + distance + preferred cuisine +
   a random term (`RATING_WEIGHT`/`DISTANCE_WEIGHT`/`PREFERRED_CUISINE_WEIGHT`/
   `RANDOM_WEIGHT`, must sum to 1.0).
3. `pick_suggestion` does a weighted-random choice among the top `TOP_K` scored
   candidates, so it isn't purely deterministic on score.

A user later confirms what actually happened via `POST /api/visits` (`was_suggested`
true/false, with a text-search fallback via `GET /api/restaurants/search` +
Google's Text Search endpoint for "went somewhere else" cases) — this is what
populates `Visit` rows for the recent-visit exclusion above.

**The external API client** (`app/services/google_places.py`) is a thin, stateless
`httpx` wrapper returning a list of normalized dicts (`name`, `address`, `lat`,
`lng`, `cuisines`, `price_level`, rating fields, etc.). It silently returns `[]`
when `GOOGLE_PLACES_API_KEY` isn't configured rather than erroring, but raises
`GooglePlacesError` on a non-200 response. It whitelists known `*_restaurant`
place types (`CUISINE_TYPES`) for cuisine classification — adding a new cuisine
type means adding to that set. `google_places.nearby_restaurants` splits the
search circle into 4 overlapping quadrant sub-searches (`_search_quadrants`) to
work around the Nearby Search API's hard 20-result cap.

**Auth/admin model:** admin rights are granted by matching a verified email
against the comma-separated `ADMIN_EMAILS` setting (`_sync_admin_status` in
`app/routers/auth.py`, called on every login/registration) — this is the only way
to bootstrap the first admin. Admins get an `/admin` console
(`app/routers/admin.py` + `admin.html`/`admin.js`) for renaming/deleting users,
resetting passwords, managing teams (offices/locations), and editing app-wide
settings (currently just `exclude_days`, backed by the `AppSettings` singleton
row — see `app/services/app_settings.py`), all under `get_current_admin`.

**Teams** (`app/services/teams.py`) are just named locations users belong to,
used only to sort the companion list in `GET /api/users` (same-team colleagues
first) — no other behavior depends on team membership.

**Data model** (`app/models.py`): `User` — `Restaurant` is a many-to-many-ish hub
joined by `Rating`, `Blacklist`, and `Visit`, each scoped to a single user +
restaurant (with unique constraints preventing duplicate ratings/blacklist
entries). Preferences that used to be simple scalars (disliked/preferred cuisines,
default companions) are stored as JSON list columns directly on `User`, alongside
scalar prefs like `dark_mode`.

**Theme:** dark mode is a per-user boolean (`User.dark_mode`), toggled from the
topbar button in `base.html` (`PATCH /api/users/me/theme`). The chosen theme is
rendered server-side as `data-theme="dark"` on `<html>` (set in `pages.py`/
`admin.py`'s template context via `user.dark_mode`) to avoid a flash of the
wrong theme, and every color in `style.css` is a CSS custom property with a
`:root[data-theme="dark"]` override — new UI should keep using those variables
rather than hardcoded colors so it stays theme-correct for free. The toggle also
flips the Google Map's style array live via `window.setMapTheme` (`dashboard.js`).

## Conventions worth knowing

- Deploy-time config (API keys, `DATABASE_URL`, etc.) is centralized in
  `app/config.py` (`pydantic-settings`, reads `.env`); don't reach for
  `os.environ` directly elsewhere. Runtime settings an admin should be able to
  change without a redeploy (currently just `exclude_days`) live instead in the
  `AppSettings` DB singleton (`app/services/app_settings.py`), edited from `/admin`.
- Routers depend on `get_db`/`get_current_user` from `app/deps.py` /
  `app/database.py` rather than constructing sessions or checking
  `request.session` inline.
- Pydantic schemas (`app/schemas.py`) are the API contract; `RestaurantOut` is
  built from an ORM `Restaurant` via `model_validate` and then has
  request-specific fields (`distance_m`, `personal_rating`, `combined_rating`)
  patched on afterward since those aren't columns on the model.
- Frontend has no build step: templates extend `base.html`, and each page's JS is
  a single plain `<script>` file under `app/static/js/` with no framework or
  module bundler. `templates_env.py`'s `static_version` global cache-busts static
  assets on every process restart.
