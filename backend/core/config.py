# core/config.py
import os
import torch
from pydantic_settings import BaseSettings

def auto_device() -> str:
    """Auto-detect best available compute device (MPS for Apple Silicon, CUDA for NVIDIA, fallback to CPU)."""
    if os.getenv("YOLO_DEVICE"):
        return os.getenv("YOLO_DEVICE")
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"

class Settings(BaseSettings):
    # No default — a hardcoded postgres:postgres@localhost credential shipping as a fallback is
    # exactly the kind of thing that quietly works in every environment until it's pointed at a
    # real one. Fail fast instead, same as JWT_SECRET below.
    DATABASE_URL: str = os.getenv("DATABASE_URL")
    YOLO_MODEL: str = os.getenv("YOLO_MODEL", "yolov8s.pt")
    YOLO_CONFIDENCE: float = float(os.getenv("YOLO_CONFIDENCE", "0.25"))
    YOLO_DEVICE: str = auto_device()
    FRAME_SKIP: int = int(os.getenv("FRAME_SKIP", "2"))
    JWT_SECRET: str = os.getenv("JWT_SECRET")
    JWT_ALGORITHM: str = "HS256"
    BOTSORT_BUFFER_FRAMES: int = int(os.getenv("BOTSORT_BUFFER_FRAMES", "90"))
    CALIB_DIR: str = os.getenv("CALIB_DIR", "data/calib")
    AUTO_CALIB_ON_STARTUP: bool = os.getenv("AUTO_CALIB_ON_STARTUP", "false").lower() == "true"
    # Comma-separated explicit allowlist — never combined with a wildcard, since allow_credentials
    # requires the browser to see one specific origin echoed back, not "*".
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "http://localhost:5173")

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()

if not settings.JWT_SECRET:
    raise RuntimeError("JWT_SECRET not set")

if not settings.DATABASE_URL:
    raise RuntimeError("DATABASE_URL not set")
