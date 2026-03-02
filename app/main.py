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
    correct_password = secrets.compare_digest(credentials.password, os.getenv("APP_PASSWORD", "admin"))
    
    if not correct_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return True

# Create the database tables on startup
models.Base.metadata.create_all(bind=database.engine)

# --- DATABASE DEPENDENCY ---
def get_db():
    """Provides a transactional scope for database operations."""
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # This runs when the server starts
    models.Base.metadata.create_all(bind=database.engine)
    db = database.SessionLocal()
    # Check if any trip exists, if not, create one
    if not db.query(models.Trip).first():
        first_trip = models.Trip(name="My First Trip", default_transport_mode="train")
        db.add(first_trip)
        db.commit()
    db.close()
    yield

# Front
app = FastAPI(title="NoFly Planner", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- ROUTES ---

@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.get("/", response_class=HTMLResponse)
async def home(request: Request, username: str = Depends(get_current_user)):
    return templates.TemplateResponse("index.html", {
        "request": request,
        "MAPBOX_TOKEN": os.getenv("MAPBOX_TOKEN")
    })

@app.get("/trips/{trip_id}/steps/", response_model=List[schemas.Step])
def get_steps(trip_id: int, db: Session = Depends(get_db), username: str = Depends(get_current_user)):
    return db.query(models.Step).filter(models.Step.trip_id == trip_id).order_by(models.Step.position).all()


@app.post("/trips/", response_model=schemas.Trip)
def create_trip(trip: schemas.TripCreate, db: Session = Depends(get_db), username: str = Depends(get_current_user)):
    """Initializes a new itinerary."""
    db_trip = models.Trip(name=trip.name, default_transport_mode=trip.default_transport_mode)
    db.add(db_trip)
    db.commit()
    db.refresh(db_trip)
    return db_trip

@app.get("/trips/{trip_id}", response_model=schemas.Trip)
def read_trip(trip_id: int, db: Session = Depends(get_db), username: str = Depends(get_current_user)):
    """Fetches a specific itinerary with all its steps."""
    db_trip = db.query(models.Trip).filter(models.Trip.id == trip_id).first()
    if not db_trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return db_trip

@app.post("/trips/{trip_id}/steps/", response_model=schemas.Step)
def add_step(trip_id: int, step: schemas.StepCreate, db: Session = Depends(get_db), username: str = Depends(get_current_user)):
    """Adds a city (node) to the trip."""
    db_step = models.Step(**step.model_dump(), trip_id=trip_id)
    db.add(db_step)
    db.commit()
    db.refresh(db_step)
    return db_step

@app.patch("/steps/{step_id}", response_model=schemas.Step)
def update_step(step_id: int, step_update: dict, db: Session = Depends(get_db), username: str = Depends(get_current_user)):
    db_step = db.query(models.Step).filter(models.Step.id == step_id).first()
    if not db_step:
        raise HTTPException(status_code=404, detail="Step not found")
    
    # This loop allows you to update 'nights', 'notes', or 'transport_mode' 
    # without needing three separate functions.
    for key, value in step_update.items():
        if hasattr(db_step, key):
            setattr(db_step, key, value)
    
    db.commit()
    db.refresh(db_step)
    return db_step

@app.delete("/steps/{step_id}")
def delete_step(step_id: int, db: Session = Depends(get_db), username: str = Depends(get_current_user)):
    """Removes a step from the database."""
    db_step = db.query(models.Step).filter(models.Step.id == step_id).first()
    if not db_step:
        raise HTTPException(status_code=404, detail="Step not found")
    
    db.delete(db_step)
    db.commit()
    return {"message": "Step deleted successfully"}

@app.put("/steps/reorder")
def reorder_steps(step_ids: List[int], db: Session = Depends(get_db), username: str = Depends(get_current_user)):
    """Updates the position of multiple steps at once."""
    for index, step_id in enumerate(step_ids):
        db.query(models.Step).filter(models.Step.id == step_id).update({"position": index})
    db.commit()
    return {"message": "Reorder successful"}