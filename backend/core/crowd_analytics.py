# core/crowd_analytics.py
import time
from typing import List, Dict, Tuple
from loguru import logger
from core.database import SessionLocal
from models.orm import Zone, ZoneHistory

def point_in_polygon(lat: float, lng: float, polygon: List[List[float]]) -> bool:
    """Ray-casting algorithm to check if a lat/lng coordinate is inside a polygon."""
    inside = False
    n = len(polygon)
    if n < 3:
        return False
        
    p1lat, p1lng = polygon[0]
    for i in range(1, n + 1):
        p2lat, p2lng = polygon[i % n]
        if lng > min(p1lng, p2lng):
            if lng <= max(p1lng, p2lng):
                if lat <= max(p1lat, p2lat):
                    if p1lng != p2lng:
                        lat_int = (lng - p1lng) * (p2lat - p1lat) / (p2lng - p1lng) + p1lat
                    if p1lat == p2lat or lat <= lat_int:
                        inside = not inside
        p1lat, p1lng = p2lat, p2lng
        
    return inside

class CrowdAnalyticsService:
    """Computes geofenced zone headcounts, capacity risk metrics, and manages historical log writes."""
    
    def __init__(self):
        self.zones: List[Zone] = []
        self.zone_headcounts: Dict[str, int] = {}
        self.last_db_write = time.time()
        self.load_zones()

    def load_zones(self):
        """Loads geofenced zones configuration from PostgreSQL."""
        db = SessionLocal()
        try:
            self.zones = db.query(Zone).all()
            self.zone_headcounts = {z.id: 0 for z in self.zones}
            logger.info(f"CrowdAnalyticsService loaded {len(self.zones)} geofenced zones.")
        except Exception as e:
            logger.error(f"Failed to load zones in CrowdAnalyticsService: {e}")
        finally:
            db.close()

    def process_entities(self, entities: List[dict]) -> bool:
        """
        Processes live entity tracks to update zone headcounts (fast, in-memory — safe to call
        directly from the event loop). Returns True when a historical DB write is now due; the
        caller is responsible for running write_historical_records() off the event loop (see
        main.py's websocket_queue_reader) rather than this method doing it inline, so a SQLite
        write-lock can't stall the fleet-wide WS broadcast.
        """
        # Reset current zone headcounts
        current_counts = {z.id: 0 for z in self.zones}

        for entity in entities:
            coords = entity.get("coordinates")
            if not coords:
                continue
            lng, lat = coords.get("x"), coords.get("y")
            if lng is None or lat is None:
                continue

            # Check which zone(s) this coordinate falls in
            for zone in self.zones:
                if point_in_polygon(lat, lng, zone.boundary_polygon):
                    current_counts[zone.id] += 1

        self.zone_headcounts = current_counts

        # Due for a historical write every 5 minutes — timestamp is updated here (not by the
        # caller) so the 5-minute window stays correct regardless of how long the actual write
        # takes to run on its executor thread.
        now = time.time()
        if now - self.last_db_write >= 300:
            self.last_db_write = now
            return True
        return False

    def write_historical_records(self):
        """Writes current zone headcount metrics to database."""
        db = SessionLocal()
        try:
            for zone in self.zones:
                headcount = self.zone_headcounts.get(zone.id, 0)
                density_pct = (headcount / zone.capacity) * 100.0 if zone.capacity > 0 else 0.0
                
                history = ZoneHistory(
                    zone_id=zone.id,
                    headcount=headcount,
                    density_percentage=round(density_pct, 2)
                )
                db.add(history)
            db.commit()
            logger.info("Zone analytics service successfully wrote 5-minute historical records.")
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to write zone history: {e}")
        finally:
            db.close()

    def get_zone_metrics(self) -> Dict[str, dict]:
        """Returns zone severity, headcount, and capacity usage for state endpoints."""
        metrics = {}
        for zone in self.zones:
            count = self.zone_headcounts.get(zone.id, 0)
            capacity_pct = (count / zone.capacity) * 100.0 if zone.capacity > 0 else 0.0
            
            # Severity evaluation
            if capacity_pct >= zone.density_threshold:
                status = "CRITICAL"
                color = "#ff1744"
            elif capacity_pct >= (zone.density_threshold * 0.7):
                status = "WARNING"
                color = "#ffeb3b"
            else:
                status = "NORMAL"
                color = "#00e676"
                
            metrics[zone.id] = {
                "name": zone.name,
                "status": status,
                "headcount": count,
                "capacity_percentage": round(capacity_pct, 2),
                "color": color
            }
        return metrics

# Singleton instance
analytics_service = CrowdAnalyticsService()
