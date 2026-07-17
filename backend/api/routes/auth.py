# api/routes/auth.py
import jwt
from datetime import datetime, timedelta
from fastapi import APIRouter, Response, HTTPException, status
from models.domain import LoginRequest
from core.config import settings

router = APIRouter()

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
        return {"status": "authenticated", "user": payload.username}
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
