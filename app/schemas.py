from pydantic import BaseModel
from typing import List, Optional

# --- STEP SCHEMAS ---

class StepBase(BaseModel):
    city_name: str
    lat: float
    lon: float
    position: int
    nights: int = 1
    country: Optional[str] = None
    country_code: Optional[str] = None
    duration: Optional[str] = None
    notes: Optional[str] = None
    transport_mode: Optional[str] = "stop"
    is_fixed_date: bool = False
    fixed_date: Optional[str] = None

class StepCreate(StepBase):
    """Schema for receiving a new step from the frontend."""
    pass

class Step(StepBase):
    """Schema for sending a step back to the frontend (includes DB fields)."""
    id: int
    trip_id: int

    class Config:
        # This allows Pydantic to read SQLAlchemy models as dictionaries
        from_attributes = True


# --- TRIP SCHEMAS ---

class TripBase(BaseModel):
    name: str
    default_transport_mode: str = "car"

class TripCreate(TripBase):
    pass

class Trip(TripBase):
    id: int
    steps: List[Step] = []

    class Config:
        from_attributes = True