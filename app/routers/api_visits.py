from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Restaurant, User, Visit
from app.schemas import VisitRequest

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
    )
    db.add(visit)
    db.commit()
    return {"ok": True}
