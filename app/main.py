from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from typing import List

from . import models, schemas, database

# Create the database tables on startup
models.Base.metadata.create_all(bind=database.engine)

app = FastAPI(title="NoFly Planner")

# Setup for Frontend Assets
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- DATABASE DEPENDENCY ---
def get_db():
    """Provides a transactional scope for database operations."""
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- ROUTES ---

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """Serves the main map interface."""
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/trips/", response_model=schemas.Trip)
def create_trip(trip: schemas.TripCreate, db: Session = Depends(get_db)):
    """Initializes a new itinerary."""
    db_trip = models.Trip(name=trip.name, default_transport_mode=trip.default_transport_mode)
    db.add(db_trip)
    db.commit()
    db.refresh(db_trip)
    return db_trip

@app.get("/trips/{trip_id}", response_model=schemas.Trip)
def read_trip(trip_id: int, db: Session = Depends(get_db)):
    """Fetches a specific itinerary with all its steps."""
    db_trip = db.query(models.Trip).filter(models.Trip.id == trip_id).first()
    if not db_trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return db_trip

@app.post("/trips/{trip_id}/steps/", response_model=schemas.Step)
def add_step(trip_id: int, step: schemas.StepCreate, db: Session = Depends(get_db)):
    """Adds a city (node) to the trip."""
    db_step = models.Step(**step.model_dump(), trip_id=trip_id)
    db.add(db_step)
    db.commit()
    db.refresh(db_step)
    return db_step

@app.get("/trips/{trip_id}/steps/", response_model=List[schemas.Step])
def get_steps(trip_id: int, db: Session = Depends(get_db)):
    """Returns all steps for a trip, sorted by their position."""
    return db.query(models.Step).filter(models.Step.id == trip_id).order_by(models.Step.position).all()

@app.delete("/steps/{step_id}")
def delete_step(step_id: int, db: Session = Depends(get_db)):
    """Removes a step from the database."""
    db_step = db.query(models.Step).filter(models.Step.id == step_id).first()
    if not db_step:
        raise HTTPException(status_code=404, detail="Step not found")
    
    db.delete(db_step)
    db.commit()
    return {"message": "Step deleted successfully"}

@app.put("/steps/reorder")
def reorder_steps(step_ids: List[int], db: Session = Depends(get_db)):
    """Updates the position of multiple steps at once."""
    for index, step_id in enumerate(step_ids):
        db.query(models.Step).filter(models.Step.id == step_id).update({"position": index})
    db.commit()
    return {"message": "Reorder successful"}