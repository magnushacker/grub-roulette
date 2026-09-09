import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Restaurant, User, Visit
from app.schemas import VisitDateRequest, VisitRequest

router = APIRouter(prefix="/api/visits", tags=["visits"])


@router.post("", status_code=201)
def log_visit(body: VisitRequest, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    restaurant = db.get(Restaurant, body.restaurant_id)
    if restaurant is None:
        raise HTTPException(status_code=404, detail="Restaurant not found")

    visit = Visit(
        user_id=current.id,
        restaurant_id=body.restaurant_id,
        was_suggested=body.was_suggested,
        companion_ids=body.companion_ids,
        visit_date=body.visit_date or dt.date.today(),
    )
    db.add(visit)
    db.commit()
    return {"ok": True}


@router.patch("/{visit_id}", status_code=204)
def update_visit_date(
    visit_id: int, body: VisitDateRequest, db: Session = Depends(get_db), current: User = Depends(get_current_user)
):
    visit = db.get(Visit, visit_id)
    if visit is None or visit.user_id != current.id:
        raise HTTPException(status_code=404, detail="Visit not found")
    visit.visit_date = body.visit_date
    db.commit()


@router.delete("/{visit_id}", status_code=204)
def delete_visit(visit_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    visit = db.get(Visit, visit_id)
    if visit is None or visit.user_id != current.id:
        raise HTTPException(status_code=404, detail="Visit not found")
    db.delete(visit)
    db.commit()
