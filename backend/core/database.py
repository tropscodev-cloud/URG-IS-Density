# core/database.py
from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker
from loguru import logger
from .config import settings

_is_sqlite = settings.DATABASE_URL.startswith("sqlite")

engine = create_engine(
    settings.DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_recycle=300,
    # SQLite only: wait up to 30s on a locked db file instead of failing immediately, and use
    # WAL so readers (the API's own request handlers) don't block on writers (the camera worker
    # processes' periodic history writes, each in a separate OS process from this one).
    connect_args={"timeout": 30} if _is_sqlite else {},
)

if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    """Initializes the database schema and seeds default cameras/zones, and a bootstrap ADMIN
    user, if empty."""
    from models.orm import Camera, Zone, User
    
    # Create all tables
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        # Seed Cameras
        if db.query(Camera).count() == 0:
            default_cameras = [
                Camera(
                    id="CAM_001",
                    name="Entrance & Foyer",
                    rtsp_url="data/cam1.mp4",
                    latitude=16.996,
                    longitude=81.766,
                    bearing=45.0,
                    fov_radius=50.0,
                    fov_angle=60.0,
                    density_threshold=15,
                    homography_matrix=None,
                    is_active=True
                ),
                Camera(
                    id="CAM_002",
                    name="Fresh Produce Aisle",
                    rtsp_url="data/cam2.mp4",
                    latitude=16.998,
                    longitude=81.772,
                    bearing=120.0,
                    fov_radius=60.0,
                    fov_angle=60.0,
                    density_threshold=10,
                    homography_matrix=None,
                    is_active=True
                ),
                Camera(
                    id="CAM_003",
                    name="Bakery & Dairy Section",
                    rtsp_url="data/cam3.mp4",
                    latitude=17.001,
                    longitude=81.776,
                    bearing=270.0,
                    fov_radius=40.0,
                    fov_angle=60.0,
                    density_threshold=12,
                    homography_matrix=None,
                    is_active=True
                )
            ]
            db.add_all(default_cameras)
            db.commit()
            logger.info("Database seeded with default cameras.")

        # Seed Zones
        if db.query(Zone).count() == 0:
            default_zones = [
                Zone(
                    id="ZONE_001",
                    name="Foyer Queue Zone",
                    boundary_polygon=[
                        [16.995, 81.765],
                        [16.997, 81.765],
                        [16.997, 81.767],
                        [16.995, 81.767]
                    ],
                    capacity=40,
                    density_threshold=80
                ),
                Zone(
                    id="ZONE_002",
                    name="Produce Counter Area",
                    boundary_polygon=[
                        [16.997, 81.771],
                        [16.999, 81.771],
                        [16.999, 81.773],
                        [16.997, 81.773]
                    ],
                    capacity=30,
                    density_threshold=80
                )
            ]
            db.add_all(default_zones)
            db.commit()
            logger.info("Database seeded with default geofenced zones.")

        # Bootstrap the very first ADMIN account. There is no self-registration and every other
        # user is admin-provisioned (see api/routes/users.py) — but that first admin has to come
        # from somewhere. Generate a random one-time temp password and print it to the server log
        # instead of hardcoding a guessable default in source; must_reset_password=True forces it
        # to be replaced (and MFA enrolled) before it grants a real session.
        if db.query(User).count() == 0:
            from core.security import generate_temp_password, hash_password
            import uuid

            temp_password = generate_temp_password()
            bootstrap_admin = User(
                id=f"USR_{uuid.uuid4().hex[:10]}",
                username="admin",
                display_name="Admin User",
                password_hash=hash_password(temp_password),
                role="ADMIN",
                is_active=True,
                must_reset_password=True,
                created_by=None,
            )
            db.add(bootstrap_admin)
            db.commit()
            logger.warning(
                "Bootstrap ADMIN user created — username='admin' temp password='{}'. "
                "This is only ever shown once in this log; it must be reset (and MFA enrolled) "
                "on first login.",
                temp_password,
            )

    except Exception as e:
        logger.error(f"Error initializing and seeding database: {e}")
        db.rollback()
    finally:
        db.close()
