from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from app.config import settings
from app.deps import get_current_user_optional
from app.models import User
from app.templates_env import templates

router = APIRouter()


@router.get("/")
def dashboard(request: Request, user: User | None = Depends(get_current_user_optional)):
    if user is None:
        return RedirectResponse(url="/login", status_code=303)
    return templates.TemplateResponse(
        "dashboard.html",
        {
            "request": request,
            "user": user,
            "default_radius_m": user.default_radius_m or settings.default_radius_m,
            "google_maps_api_key": settings.google_maps_js_api_key or settings.google_places_api_key,
        },
    )
