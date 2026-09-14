from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user_optional
from app.models import User
from app.services import app_settings
from app.templates_env import templates

router = APIRouter()


@router.get("/")
def dashboard(
    request: Request,
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    if user is None:
        return RedirectResponse(url="/login", status_code=303)
    response = templates.TemplateResponse(
        "dashboard.html",
        {
            "request": request,
            "user": user,
            "default_radius_m": user.default_radius_m or settings.default_radius_m,
            "google_maps_api_key": settings.google_maps_js_api_key or settings.google_places_api_key,
            "exclude_days": app_settings.get_settings(db).exclude_days,
        },
    )
    # Admin-configurable settings (exclude_days) are baked into this page at
    # render time, so a stale cached copy (e.g. the browser's back/forward
    # cache) can silently show an outdated value after an admin changes it.
    response.headers["Cache-Control"] = "no-store"
    return response
