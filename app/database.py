import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

# 1. Connection String: Standard URI format.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./nofly.db")

# 2. Engine: The Engine maintains a Connection Pool. 
# We set check_same_thread=False because FastAPI handles 
# concurrency at the request level, and we want to allow the 
# database driver to be accessed across threads safely.
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,  # Checks if connection is alive before using it
        pool_recycle=300     # Refreshes connections every 5 mins to match Neon's sleep timer
    )

# 3. Session Factory: This is a configured 'callable' that produces
# new Session instances. We disable autocommit to ensure ACID 
# compliance—we must explicitly call session.commit().
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 4. Declarative Base: A registry for our Metadata. 
# It keeps track of all tables mapped to this base for DDL generation.
Base = declarative_base()