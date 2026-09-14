from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_admin, get_current_user_optional
from app.models import Team, User
from app.schemas import (
    AdminResetPasswordRequest,
    AdminUserOut,
    RenameTeamRequest,
    RenameUserRequest,
    TeamOut,
    UpdateEmailRequest,
    UpdateTeamRequest,
)
from app.security import hash_password
from app.templates_env import templates

router = APIRouter()


@router.get("/admin")
def admin_page(request: Request, user: User | None = Depends(get_current_user_optional)):
    if user is None:
        return RedirectResponse(url="/login", status_code=303)
    if not user.is_admin:
        return RedirectResponse(url="/", status_code=303)
    return templates.TemplateResponse("admin.html", {"request": request, "user": user})


@router.get("/api/admin/users", response_model=list[AdminUserOut])
def list_users(db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    return db.scalars(select(User).order_by(User.display_name)).all()


@router.delete("/api/admin/users/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="You can't delete your own account")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()


@router.patch("/api/admin/users/{user_id}/name", response_model=AdminUserOut)
def rename_user(
    user_id: int,
    body: RenameUserRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    existing = db.scalar(
        select(User).where(func.lower(User.display_name) == body.display_name.lower(), User.id != user_id)
    )
    if existing is not None:
        raise HTTPException(status_code=400, detail="That name is taken")
    user.display_name = body.display_name
    db.commit()
    db.refresh(user)
    return user


@router.patch("/api/admin/users/{user_id}/email", response_model=AdminUserOut)
def update_user_email(
    user_id: int,
    body: UpdateEmailRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    existing = db.scalar(select(User).where(func.lower(User.email) == body.email.lower(), User.id != user_id))
    if existing is not None:
        raise HTTPException(status_code=400, detail="That email is already registered")
    user.email = body.email
    db.commit()
    db.refresh(user)
    return user


@router.post("/api/admin/users/{user_id}/reset-password", status_code=204)
def reset_password(
    user_id: int,
    body: AdminResetPasswordRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = hash_password(body.new_password)
    db.commit()


@router.patch("/api/admin/users/{user_id}/team", response_model=AdminUserOut)
def set_user_team(
    user_id: int,
    body: UpdateTeamRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if body.team_id is not None and db.get(Team, body.team_id) is None:
        raise HTTPException(status_code=404, detail="Team not found")
    user.team_id = body.team_id
    db.commit()
    db.refresh(user)
    return user


@router.patch("/api/admin/teams/{team_id}", response_model=TeamOut)
def rename_team(
    team_id: int,
    body: RenameTeamRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    existing = db.scalar(select(Team).where(Team.name == body.name, Team.id != team_id))
    if existing is not None:
        raise HTTPException(status_code=400, detail="That team name is taken")
    team.name = body.name
    db.commit()
    db.refresh(team)
    return team


@router.delete("/api/admin/teams/{team_id}", status_code=204)
def delete_team(team_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    for member in team.members:
        member.team_id = None
    db.delete(team)
    db.commit()
