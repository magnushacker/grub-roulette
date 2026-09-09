from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.database import init_db
from app.routers import admin, api_groups, api_restaurants, api_stats, api_users, api_visits, auth, pages

app = FastAPI(title="Grub Roulette")
app.add_middleware(SessionMiddleware, secret_key=settings.secret_key)
app.mount("/static", StaticFiles(directory="app/static"), name="static")

app.include_router(pages.router)
app.include_router(auth.router)
app.include_router(api_users.router)
app.include_router(api_groups.router)
app.include_router(api_restaurants.router)
app.include_router(api_visits.router)
app.include_router(api_stats.router)
app.include_router(admin.router)


@app.on_event("startup")
def on_startup():
    init_db()
