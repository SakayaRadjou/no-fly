from sqlalchemy import Column, Integer, String, Float, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
from .database import Base

class Trip(Base):
    """
    The Parent container for an entire journey (e.g., 'Europe 2026').
    Acts as the 'Header' for a collection of waypoints.
    """
    __tablename__ = "trips"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    
    # Global default transport for the trip
    # Useful for Phase 2 logic (car, stop, bus, train, walk, ferry)
    default_transport_mode = Column(String, default="train")

    # Relationships
    # cascade="all, delete-orphan" ensures referential integrity 
    # (deleting a trip deletes all associated steps).
    steps = relationship("Step", back_populates="trip", cascade="all, delete-orphan")


class Step(Base):
    """
    Represents a specific City/Waypoint (The 'Nodes').
    Data for the 'Leg' (The 'Edges') is derived from the gap between steps.
    """
    __tablename__ = "steps"

    id = Column(Integer, primary_key=True, index=True)
    trip_id = Column(Integer, ForeignKey("trips.id"))
    
    # Logic & Sorting
    position = Column(Integer, index=True, nullable=False) # 0 = Start, N = End
    
    # Location Data
    city_name = Column(String, nullable=False)
    country = Column(String, nullable=True)
    country_code = Column(String, nullable=True)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    
    # Phase 2 & 3: Segment & Stay Data
    # We store mode and co2 here to represent the leg ARRIVING at this city.
    transport_mode = Column(String, nullable=True) 
    co2_kg = Column(Float, default=0.0)
    duration = Column(String, nullable=True)
    nights = Column(Integer, default=1)
    notes = Column(Text, nullable=True)

    is_fixed_date = Column(Boolean, default=False)
    fixed_date = Column(String, nullable=True) # Stores "YYYY-MM-DD"

    # Relationships
    trip = relationship("Trip", back_populates="steps")