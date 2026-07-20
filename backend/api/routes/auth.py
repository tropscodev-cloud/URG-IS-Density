# api/routes/auth.py
import jwt
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Response, HTTPException, Cookie, Depends, status
from models.domain import LoginRequest
from core.config import settings

router = APIRouter()

def get_current_user(session_token: Optional[str] = Cookie(None)):
    if not session_token:
        raise HTTPException(status_code=401, detail="Session token missing")
    try:
        payload = jwt.decode(session_token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid session payload")
        return {
            "id": "1",
            "username": username,
            "displayName": "Admin User",
            "role": "ADMIN",
            "zoneScope": None
        }
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Session expired or invalid")

@router.post("/login")
def login(payload: LoginRequest, response: Response):
    # Standard credentials validation for URG-IS
    if payload.username == "admin" and payload.password == "urgis_admin":
        expire = datetime.utcnow() + timedelta(hours=24)
        token_data = {"sub": payload.username, "exp": expire}
        token = jwt.encode(token_data, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
        
        # Set HttpOnly JWT session token cookie
        response.set_cookie(
            key="session_token",
            value=token,
            httponly=True,
            samesite="lax",
            secure=False,  # Set to True in production over HTTPS
            max_age=86400  # 1 day
        )
        return {
            "user": {
                "id": "1",
                "username": payload.username,
                "displayName": "Admin User",
                "role": "ADMIN",
                "zoneScope": None
            },
            "sessionExpiresAt": expire.isoformat() + "Z"
        }
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )

@router.get("/session")
def get_session(user = Depends(get_current_user), session_token: Optional[str] = Cookie(None)):
    return {
        "user": user,
        "sessionId": session_token[-15:] if session_token else "session_id_mock"
    }

@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("session_token")
    return {"status": "logged_out"}

@router.post("/refresh")
def refresh():
    return {"status": "refreshed"}

@router.post("/step-up")
def step_up(payload: dict, user = Depends(get_current_user)):
    # Step-up re-auth strengthens an *existing* session — it must never itself be a way to
    # establish one, or it's just a second, weaker login endpoint.
    if payload.get("password") == "urgis_admin":
        expire = datetime.utcnow() + timedelta(hours=1)
        return {"grantedUntil": expire.isoformat() + "Z"}
    else:
        raise HTTPException(status_code=401, detail="Incorrect security password")
