# workers/manager.py
import os
import sys
import time
import threading
import multiprocessing
from typing import Dict
from loguru import logger

# Add root folder to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.database import SessionLocal
from models.orm import Camera
from .vision_pipeline import run_pipeline

class CameraProcessManager:
    """Manages spawning, monitoring, and restarting of isolated camera workers."""

    def __init__(self):
        self.processes: Dict[str, multiprocessing.Process] = {}
        self.manager = None
        self.queue = None
        # camera_id -> target_fps, shared across the process pool. Workers poll this every
        # processed frame so an fps change takes effect without a restart (see vision_pipeline.py).
        self.fps_config = None
        self.running = False
        self.monitor_thread = None

    def start_all(self):
        if self.running:
            return

        self.running = True
        logger.info("Initializing Camera Process Manager...")

        # Defer creating the Manager and Queue until execution start_all
        self.manager = multiprocessing.Manager()
        self.queue = self.manager.Queue(maxsize=1000)
        self.fps_config = self.manager.dict()

        # Initial spawn of active cameras
        self._start_camera_workers()

        # Start background health monitoring thread
        self.monitor_thread = threading.Thread(target=self._monitor_workers, daemon=True)
        self.monitor_thread.start()

    def _start_camera_workers(self):
        db = SessionLocal()
        try:
            cameras = db.query(Camera).filter(Camera.is_active == True).all()
            for cam in cameras:
                self._spawn_worker(cam)
        except Exception as e:
            logger.error(f"Error querying active cameras: {e}")
        finally:
            db.close()

    def _spawn_worker(self, camera: Camera):
        if camera.id in self.processes and self.processes[camera.id].is_alive():
            return

        self.fps_config[camera.id] = camera.target_fps or 20

        p = multiprocessing.Process(
            target=run_pipeline,
            args=(
                camera.id,
                camera.rtsp_url,
                camera.latitude,
                camera.longitude,
                camera.bearing,
                camera.density_threshold,
                camera.homography_matrix,
                self.queue,
                self.fps_config,
            ),
            name=f"Worker-{camera.id}"
        )
        p.daemon = True
        p.start()
        self.processes[camera.id] = p
        logger.success(f"Spawned child worker process {p.pid} for {camera.id} at {self.fps_config[camera.id]} fps")

    def set_fps(self, camera_id: str, target_fps: int):
        """Live-updates a running worker's sampling rate — picked up on its next processed frame,
        no restart. Safe to call even if the camera isn't running yet (spawn will read the DB)."""
        if self.fps_config is None:
            return
        clamped = max(1, min(30, target_fps))
        self.fps_config[camera_id] = clamped

    def _monitor_workers(self):
        """Monitors workers, restarts crashes, and stops workers for cameras marked inactive."""
        while self.running:
            time.sleep(5)
            db = SessionLocal()
            try:
                cameras = db.query(Camera).filter(Camera.is_active == True).all()
                active_ids = {c.id for c in cameras}
                
                # 1. Cleanup and terminate inactive or deleted camera workers
                for cam_id in list(self.processes.keys()):
                    if cam_id not in active_ids:
                        p = self.processes[cam_id]
                        if p.is_alive():
                            logger.info(f"Stopping worker process for inactive camera {cam_id}")
                            p.terminate()
                            p.join(timeout=2)
                            if p.is_alive():
                                p.kill()
                        self.processes.pop(cam_id)
                
                # 2. Restart crashed workers or spawn newly added cameras
                for cam in cameras:
                    p = self.processes.get(cam.id)
                    if p is None or not p.is_alive():
                        if p is not None:
                            logger.warning(f"Worker for camera {cam.id} has crashed or terminated. Restarting...")
                        else:
                            logger.info(f"Detected new camera config {cam.id}. Starting worker...")
                        self._spawn_worker(cam)
                        
            except Exception as e:
                logger.error(f"Error in health monitor loop: {e}")
            finally:
                db.close()

    def stop_all(self):
        self.running = False
        logger.info("Terminating all camera worker processes...")
        for cam_id, p in self.processes.items():
            if p.is_alive():
                p.terminate()
                p.join(timeout=2)
                if p.is_alive():
                    p.kill()
        self.processes.clear()
        if self.manager:
            self.manager.shutdown()
            self.manager = None
        logger.info("All camera workers terminated successfully.")

# Singleton — main.py's lifecycle hooks and api/routes/cameras.py's fps endpoints both need the
# same instance (routes call set_fps() on a *running* pool; they can't own their own copy).
process_manager = CameraProcessManager()
