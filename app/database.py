from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# 1. Connection String: Standard URI format.
SQLALCHEMY_DATABASE_URL = "sqlite:///./nofly.db"

# 2. Engine: The Engine maintains a Connection Pool. 
# For SQLite, we set check_same_thread=False because FastAPI handles 
# concurrency at the request level, and we want to allow the 
# database driver to be accessed across threads safely.
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)

# 3. Session Factory: This is a configured 'callable' that produces
# new Session instances. We disable autocommit to ensure ACID 
# compliance—we must explicitly call session.commit().
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 4. Declarative Base: A registry for our Metadata. 
# It keeps track of all tables mapped to this base for DDL generation.
Base = declarative_base()