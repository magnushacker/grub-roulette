# Grub Roulette

A small web app for picking where to go for lunch. Sort nearby restaurants by
distance from a point you choose on a map, rate places so good ones bubble up,
get a randomized pick so you don't end up at the same place every week,
blacklist places you never want to see again, and bring colleagues along so
their cuisine dislikes get filtered out too.

## Stack

- **Backend:** FastAPI + SQLAlchemy, SQLite database
- **Frontend:** server-rendered pages (Jinja2) + vanilla JS + Google Maps JavaScript API for the map
- **Restaurant data:** Google Places (primary) + Yelp Fusion (supplemental ratings), merged by proximity/name matching
- **Auth:** simple built-in name/password accounts with signed session cookies, plus an admin console for user/office management

## Setup

1. Create a virtual environment and install dependencies:

   ```
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. Copy `.env.example` to `.env` and fill in:
   - `SECRET_KEY` — generate with `python -c "import secrets; print(secrets.token_hex(32))"`
   - `GOOGLE_PLACES_API_KEY` — from https://console.cloud.google.com/google/maps-apis/credentials (enable **"Places API (New)"**, not the older "Places API" — it's what returns cuisine-specific place types)
   - `GOOGLE_MAPS_JS_API_KEY` — same Cloud project, enable **"Maps JavaScript API"**. This key is embedded in the page HTML and sent to the browser, so before deploying anywhere public, use a separate key from `GOOGLE_PLACES_API_KEY` and restrict it by HTTP referrer. Leave blank to reuse `GOOGLE_PLACES_API_KEY` (fine for local dev only).
   - `YELP_API_KEY` — from https://www.yelp.com/developers/v3/manage_app

   The app runs without any of these keys, but restaurant search returns no results until
   `GOOGLE_PLACES_API_KEY` is set, and the map won't render until `GOOGLE_MAPS_JS_API_KEY`
   (or a fallback to `GOOGLE_PLACES_API_KEY`) is usable for the Maps JavaScript API.

3. Run the app:

   ```
   python run.py
   ```

   Then open http://127.0.0.1:8000. Register an account for yourself and one for each colleague.

## How the suggestion algorithm works

For a given origin point, radius, and set of lunch companions:

1. Fetch nearby restaurants from Google Places and Yelp, merge matching entries (same name/location), and cache them in the local database.
2. Drop any restaurant that:
   - you or a companion has blacklisted,
   - matches a cuisine you or a companion has marked as disliked, or
   - you personally visited in the last `EXCLUDE_DAYS` (default 7) days.
3. Score each remaining restaurant from a blend of distance, rating (your own rating if you've rated it before, otherwise the external Google/Yelp rating), and a random component.
4. Pick a winner via weighted random choice among the top-scored candidates — good, close restaurants are favored, but it won't always be the literal top score.

After a suggestion, confirm what you actually did ("I went here" / "I went somewhere else" with a search box) — this is what feeds the recent-visit exclusion so the same place won't come up again for a week.

## Deploying to the cloud later

The `Dockerfile` builds a container that reads `DATABASE_URL` and expects a
writable volume mounted at `/data` for the SQLite file — this works as-is on
most container platforms (Fly.io, Render, Railway, etc.) that support a
persistent volume. Set the same environment variables from `.env` as secrets
on whichever platform you pick.
