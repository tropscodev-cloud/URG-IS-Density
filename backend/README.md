# URG-IS Crowd Density Analytics Backend

Production-grade crowd density assessment, flow analysis, and risk severity alerting engine.

---

## **Prerequisites**
- **Python**: `>=3.12, <3.13`
- **Redis**: Running on port `6379`
- **Neo4j** (Optional): Running on port `7687` / `7474`
- **Poetry**: For dependency management

---

## **How to Run (Step-by-Step)**

### **Step 1: Start Databases (Redis & Neo4j)**
Make sure you have Redis and Neo4j services running. 

If you are using Docker, you can start them via:
```bash
docker-compose up -d redis neo4j
```

---

### **Step 2: Install Dependencies**
Install python package dependencies using Poetry inside the `/backend` directory:
```bash
poetry install
```

---

### **Step 3: Start the Video Processing Pipeline**
This script reads the camera video feeds (e.g. `data/cam1.mp4`), tracks people, and publishes their live positions to the `detection_stream` Redis channel:
```bash
poetry run python -m src.core.pipeline
```

---

### **Step 4: Start the Graph Writer Service**
This background listener consumes the live tracking events from the Redis stream and writes coordinates and metadata into the Graph Database:
```bash
poetry run python -m src.services.graph_writer
```

---

### **Step 5: Start the Crowd Publisher Service**
This starts the `CrowdDensityAgent` loop. It queries the active people in the Graph Database every 2 seconds, calculates density and flow metrics, and publishes alerts on `crowd_alerts`:
```bash
poetry run python -m src.analytics.crowd_publisher
```

---

### **Step 6: Start the FastAPI API Server**
Run the main FastAPI web server that provides HTTP endpoints and Websocket connections for the Next.js React frontend:
```bash
poetry run uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
```
You can access the interactive API docs at `http://localhost:8000/docs`.

---

## **Alternative: Run Everything using Docker-Compose**
To build and spin up the database and backend services all at once:
```bash
docker-compose up --build
```
This automatically configures environment variables, establishes network routes, and starts all the pipeline services.
