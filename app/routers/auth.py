from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Group, User
from app.security import hash_password, verify_password
from app.services.groups import get_or_create_group
from app.templates_env import templates

router = APIRouter()


@router.get("/login")
def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request, "error": None})


@router.post("/login")
def login_submit(request: Request, display_name: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.display_name == display_name))
    if user is None or not verify_password(password, user.password_hash):
        return templates.TemplateResponse(
            "login.html", {"request": request, "error": "Invalid name or password"}, status_code=401
        )
    request.session["user_id"] = user.id
    return RedirectResponse(url="/", status_code=303)


@router.get("/register")
def register_page(request: Request, db: Session = Depends(get_db)):
    groups = db.scalars(select(Group).order_by(Group.name)).all()
    return templates.TemplateResponse("register.html", {"request": request, "error": None, "groups": groups})


@router.post("/register")
def register_submit(
    request: Request,
    display_name: str = Form(...),
    password: str = Form(...),
    group_id: str = Form(""),
    new_group_name: str = Form(""),
    db: Session = Depends(get_db),
):
    groups = db.scalars(select(Group).order_by(Group.name)).all()
    existing = db.scalar(select(User).where(User.display_name == display_name))
    if existing is not None:
        return templates.TemplateResponse(
            "register.html", {"request": request, "error": "That name is taken", "groups": groups}, status_code=400
        )

    resolved_group_id: int | None
    if group_id == "__new__" and new_group_name.strip():
        resolved_group_id = get_or_create_group(db, new_group_name).id
    elif group_id and group_id != "__new__":
        resolved_group_id = int(group_id)
    else:
        resolved_group_id = None

    user = User(
        display_name=display_name,
        password_hash=hash_password(password),
        group_id=resolved_group_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    request.session["user_id"] = user.id
    return RedirectResponse(url="/", status_code=303)


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/login", status_code=303)
