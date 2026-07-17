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
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/urgis")
    YOLO_MODEL: str = os.getenv("YOLO_MODEL", "yolov8s.pt")
    YOLO_CONFIDENCE: float = float(os.getenv("YOLO_CONFIDENCE", "0.25"))
    YOLO_DEVICE: str = auto_device()
    FRAME_SKIP: int = int(os.getenv("FRAME_SKIP", "2"))
    JWT_SECRET: str = os.getenv("JWT_SECRET", "supersecretkeyurgis")
    JWT_ALGORITHM: str = "HS256"
    BOTSORT_BUFFER_FRAMES: int = int(os.getenv("BOTSORT_BUFFER_FRAMES", "90"))
    CALIB_DIR: str = os.getenv("CALIB_DIR", "data/calib")
    AUTO_CALIB_ON_STARTUP: bool = os.getenv("AUTO_CALIB_ON_STARTUP", "false").lower() == "true"

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
