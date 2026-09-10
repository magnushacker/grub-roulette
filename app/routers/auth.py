import datetime as dt
import secrets

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Team, User
from app.security import hash_password, verify_password
from app.services.email import EmailError, send_verification_email
from app.services.teams import get_or_create_team
from app.templates_env import templates

router = APIRouter()

RESEND_COOLDOWN = dt.timedelta(seconds=60)


def _sync_admin_status(user: User, db: Session) -> None:
    should_be_admin = user.email is not None and user.email.lower() in settings.admin_email_set
    if should_be_admin and not user.is_admin:
        user.is_admin = True
        db.commit()


def _issue_and_send_verification(user: User, db: Session) -> None:
    user.verification_token = secrets.token_urlsafe(32)
    user.verification_sent_at = dt.datetime.utcnow()
    db.commit()
    verify_url = f"{settings.app_base_url}/verify?token={user.verification_token}"
    try:
        send_verification_email(user.email, user.display_name, verify_url)
    except EmailError as e:
        # The account still exists at this point -- don't 500 and strand the
        # user with no explanation just because the send itself failed.
        print(f"[email] failed to send verification email to {user.email}: {e}")


@router.get("/login")
def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request, "error": None, "unverified_email": None})


@router.post("/login")
def login_submit(request: Request, identifier: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(or_(User.email == identifier, User.display_name == identifier)))
    if user is None or not verify_password(password, user.password_hash):
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Invalid email/name or password", "unverified_email": None},
            status_code=401,
        )
    if settings.require_email_verification and not user.email_verified:
        return templates.TemplateResponse(
            "login.html",
            {
                "request": request,
                "error": "Please verify your email first — check your inbox for the link we sent when you registered.",
                "unverified_email": user.email,
            },
            status_code=403,
        )
    _sync_admin_status(user, db)
    request.session["user_id"] = user.id
    return RedirectResponse(url="/", status_code=303)


@router.post("/resend-verification")
def resend_verification(request: Request, email: str = Form(...), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == email))
    if user is not None and not user.email_verified:
        stale = user.verification_sent_at is None or dt.datetime.utcnow() - user.verification_sent_at > RESEND_COOLDOWN
        if stale:
            _issue_and_send_verification(user, db)
    # Same response either way (unknown email, already-verified, or freshly
    # resent) so this can't be used to probe which emails are registered.
    return templates.TemplateResponse(
        "verify_pending.html",
        {"request": request, "email": email, "sender": settings.email_from},
    )


@router.get("/register")
def register_page(request: Request, db: Session = Depends(get_db)):
    teams = db.scalars(select(Team).order_by(Team.name)).all()
    return templates.TemplateResponse("register.html", {"request": request, "error": None, "teams": teams})


@router.post("/register")
def register_submit(
    request: Request,
    display_name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    team_id: str = Form(""),
    new_team_name: str = Form(""),
    db: Session = Depends(get_db),
):
    teams = db.scalars(select(Team).order_by(Team.name)).all()
    existing = db.scalar(select(User).where(func.lower(User.display_name) == display_name.lower()))
    if existing is not None:
        return templates.TemplateResponse(
            "register.html", {"request": request, "error": "That name is taken", "teams": teams}, status_code=400
        )
    existing_email = db.scalar(select(User).where(func.lower(User.email) == email.lower()))
    if existing_email is not None:
        return templates.TemplateResponse(
            "register.html",
            {"request": request, "error": "That email is already registered", "teams": teams},
            status_code=400,
        )

    resolved_team_id: int | None
    if team_id == "__new__" and new_team_name.strip():
        resolved_team_id = get_or_create_team(db, new_team_name).id
    elif team_id and team_id != "__new__":
        resolved_team_id = int(team_id)
    else:
        resolved_team_id = None

    user = User(
        display_name=display_name,
        email=email,
        password_hash=hash_password(password),
        team_id=resolved_team_id,
        email_verified=not settings.require_email_verification,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    _sync_admin_status(user, db)

    if not settings.require_email_verification:
        request.session["user_id"] = user.id
        return RedirectResponse(url="/", status_code=303)

    _issue_and_send_verification(user, db)

    return templates.TemplateResponse(
        "verify_pending.html",
        {"request": request, "email": email, "sender": settings.email_from},
    )


@router.get("/verify")
def verify_email(token: str, request: Request, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.verification_token == token))
    if user is None:
        return templates.TemplateResponse("verify_result.html", {"request": request}, status_code=400)
    user.email_verified = True
    user.verification_token = None
    db.commit()
    request.session["user_id"] = user.id
    return RedirectResponse(url="/", status_code=303)


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/login", status_code=303)
