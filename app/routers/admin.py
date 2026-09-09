import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_admin, get_current_user_optional
from app.models import Blacklist, Group, Rating, Restaurant, Search, User, Visit
from app.schemas import (
    AdminResetPasswordRequest,
    AdminStatsOut,
    AdminUserOut,
    GroupOut,
    RenameGroupRequest,
    RenameUserRequest,
    UpdateEmailRequest,
    UpdateGroupRequest,
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


@router.get("/api/admin/stats", response_model=AdminStatsOut)
def get_stats(db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    def count(model, *where) -> int:
        stmt = select(func.count()).select_from(model)
        if where:
            stmt = stmt.where(*where)
        return db.scalar(stmt)

    week_ago = dt.datetime.utcnow() - dt.timedelta(days=7)
    return AdminStatsOut(
        total_users=count(User),
        total_admins=count(User, User.is_admin.is_(True)),
        total_groups=count(Group),
        users_without_group=count(User, User.group_id.is_(None)),
        total_searches=count(Search),
        searches_last_7_days=count(Search, Search.created_at >= week_ago),
        total_visits=count(Visit),
        visits_confirmed_suggested=count(Visit, Visit.was_suggested.is_(True)),
        visits_logged_elsewhere=count(Visit, Visit.was_suggested.is_(False)),
        total_ratings=count(Rating),
        average_rating=db.scalar(select(func.avg(Rating.stars))),
        total_blacklist_entries=count(Blacklist),
        total_restaurants_cached=count(Restaurant),
    )


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


@router.patch("/api/admin/users/{user_id}/group", response_model=AdminUserOut)
def set_user_group(
    user_id: int,
    body: UpdateGroupRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if body.group_id is not None and db.get(Group, body.group_id) is None:
        raise HTTPException(status_code=404, detail="Group not found")
    user.group_id = body.group_id
    db.commit()
    db.refresh(user)
    return user


@router.patch("/api/admin/groups/{group_id}", response_model=GroupOut)
def rename_group(
    group_id: int,
    body: RenameGroupRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    group = db.get(Group, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    existing = db.scalar(select(Group).where(Group.name == body.name, Group.id != group_id))
    if existing is not None:
        raise HTTPException(status_code=400, detail="That group name is taken")
    group.name = body.name
    db.commit()
    db.refresh(group)
    return group


@router.delete("/api/admin/groups/{group_id}", status_code=204)
def delete_group(group_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    group = db.get(Group, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    for member in group.members:
        member.group_id = None
    db.delete(group)
    db.commit()
