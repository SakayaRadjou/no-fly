import os
import secrets
from fastapi import FastAPI, Depends, HTTPException, status, Request
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from typing import List
from contextlib import asynccontextmanager
from dotenv import load_dotenv

from . import models, schemas, database

load_dotenv()

# --- SECURITY ---
security = HTTPBasic()

def get_current_user(credentials: HTTPBasicCredentials = Depends(security)):
    admin_user = os.getenv("APP_USERNAME")
    guest_user = os.getenv("GUEST_USERNAME")
    admin_pass = os.getenv("APP_PASSWORD")
    guest_pass = os.getenv("GUEST_PASSWORD")

    # Guard clause: If variables aren't set, deny access immediately
    if not all([admin_user, guest_user, admin_pass, guest_pass]):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server authentication configuration missing"
        )
    
    # Check Admin credentials
    is_admin = (secrets.compare_digest(credentials.username, admin_user) and 
                secrets.compare_digest(credentials.password, admin_pass))
    
    # Check Guest credentials
    is_guest = (secrets.compare_digest(credentials.username, guest_user) and 
                 secrets.compare_digest(credentials.password, guest_pass))

    if is_admin:
        return "admin"
    if is_guest:
        return "guest"

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Basic"},
    )

def verify_admin(role: str = Depends(get_current_user)):
    """Dependency to ensure only admins can access write/delete routes."""
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Viewers cannot modify data"
        )
    return role

# --- DATABASE DEPENDENCY ---
def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    models.Base.metadata.create_all(bind=database.engine)
    db = database.SessionLocal()
    if not db.query(models.Trip).first():
        first_trip = models.Trip(name="My First Trip", default_transport_mode="train")
        db.add(first_trip)
        db.commit()
    db.close()
    yield

# --- APP INIT ---
app = FastAPI(title="NoFly Planner", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- ROUTES ---

@app.get("/health")
async def health_check():
    """Keep-alive endpoint for Render."""
    return {"status": "ok"}

# PUBLIC (Requires Guest or Admin login)
@app.get("/", response_class=HTMLResponse)
async def home(request: Request, role: str = Depends(get_current_user)):
    return templates.TemplateResponse("index.html", {
        "request": request,
        "MAPBOX_TOKEN": os.getenv("MAPBOX_TOKEN"),
        "user_role": role  # Injected into <body> class in index.html
    })

# PUBLIC (Requires Guest or Admin login)
@app.get("/trips/all", response_model=List[schemas.Trip])
def get_all_trips(db: Session = Depends(get_db), role: str = Depends(get_current_user)):
    """Returns all trips for the dropdown selector."""
    return db.query(models.Trip).all()

# PUBLIC (Requires Guest or Admin login)
@app.get("/trips/{trip_id}/steps/", response_model=List[schemas.Step])
def get_steps(trip_id: int, db: Session = Depends(get_db), role: str = Depends(get_current_user)):
    return db.query(models.Step).filter(models.Step.trip_id == trip_id).order_by(models.Step.position).all()

# PROTECTED: Trip Creation (Admin Only)
@app.post("/trips/", response_model=schemas.Trip)
def create_trip(trip: schemas.TripCreate, db: Session = Depends(get_db), role: str = Depends(verify_admin)):
    db_trip = models.Trip(name=trip.name, default_transport_mode=trip.default_transport_mode)
    db.add(db_trip)
    db.commit()
    db.refresh(db_trip)
    return db_trip

# PROTECTED: Read Trip Details (Admin Only)
@app.get("/trips/{trip_id}", response_model=schemas.Trip)
def read_trip(trip_id: int, db: Session = Depends(get_db), role: str = Depends(verify_admin)):
    db_trip = db.query(models.Trip).filter(models.Trip.id == trip_id).first()
    if not db_trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return db_trip

# PROTECTED: Add Step (Admin Only)
@app.post("/trips/{trip_id}/steps/", response_model=schemas.Step)
def add_step(trip_id: int, step: schemas.StepCreate, db: Session = Depends(get_db), role: str = Depends(verify_admin)):
    db_step = models.Step(**step.model_dump(), trip_id=trip_id)
    db.add(db_step)
    db.commit()
    db.refresh(db_step)
    return db_step

# PROTECTED: Update Step (Admin Only)
@app.patch("/steps/{step_id}", response_model=schemas.Step)
def update_step(step_id: int, step_update: dict, db: Session = Depends(get_db), role: str = Depends(verify_admin)):
    db_step = db.query(models.Step).filter(models.Step.id == step_id).first()
    if not db_step:
        raise HTTPException(status_code=404, detail="Step not found")
    
    for key, value in step_update.items():
        if hasattr(db_step, key):
            setattr(db_step, key, value)
    
    db.commit()
    db.refresh(db_step)
    return db_step

# PROTECTED: Delete Step (Admin Only)
@app.delete("/steps/{step_id}")
def delete_step(step_id: int, db: Session = Depends(get_db), role: str = Depends(verify_admin)):
    db_step = db.query(models.Step).filter(models.Step.id == step_id).first()
    if not db_step:
        raise HTTPException(status_code=404, detail="Step not found")
    
    db.delete(db_step)
    db.commit()
    return {"message": "Step deleted successfully"}

# PROTECTED: Reorder (Admin Only)
@app.put("/steps/reorder")
def reorder_steps(step_ids: List[int], db: Session = Depends(get_db), role: str = Depends(verify_admin)):
    for index, step_id in enumerate(step_ids):
        db.query(models.Step).filter(models.Step.id == step_id).update({"position": index})
    db.commit()
    return {"message": "Reorder successful"}