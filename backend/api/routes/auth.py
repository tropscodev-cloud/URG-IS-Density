# api/routes/auth.py
import jwt
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Response, Request, HTTPException, Cookie, Depends, status
from sqlalchemy.orm import Session

from core.database import get_db
from core.config import settings
from core.audit import write_audit, client_ip
from core.security import (
    verify_password,
    hash_password,
    validate_password_strength,
    generate_totp_secret,
    totp_provisioning_uri,
    verify_totp,
    encrypt_secret,
    decrypt_secret,
    make_scoped_token,
    decode_scoped_token,
    PURPOSE_RESET,
    PURPOSE_ENROLL,
)
from models.orm import User
from models.domain import LoginRequest, ResetPasswordRequest, MfaEnrollRequest

router = APIRouter()

SESSION_HOURS = 24


def _user_out(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "displayName": user.display_name or user.username,
        "role": user.role,
        "zoneScope": None,
    }


def get_current_user(session_token: Optional[str] = Cookie(None), db: Session = Depends(get_db)) -> dict:
    if not session_token:
        raise HTTPException(status_code=401, detail="Session token missing")
    try:
        payload = jwt.decode(session_token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Session expired or invalid")

    # A scoped reset/enroll token must never be usable as a real session — those are narrower,
    # single-purpose credentials handed out mid-login, before a user is actually authenticated.
    if payload.get("purpose") is not None:
        raise HTTPException(status_code=401, detail="Invalid session token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid session payload")

    # Looked up fresh on every request (not cached in the token) so a deactivation takes effect
    # on this user's very next call instead of only at their next login.
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Session expired or invalid")

    return _user_out(user)


def require_role(*allowed_roles: str):
    """Dependency factory — role check layered on top of get_current_user. Router-level
    Depends(get_current_user) alone only proves *who*; state-changing routes that are supposed to
    be ADMIN-only need this too, or any authenticated role could reach them."""

    def checker(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient role for this action")
        return user

    return checker


@router.post("/login")
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = client_ip(request)
    user = db.query(User).filter(User.username == payload.username).first()

    # Same generic error whether the username doesn't exist or the password is wrong — do not let
    # a client distinguish "no such user" from "wrong password" (username enumeration).
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        write_audit(db, None, "login_failed", target_type="user", target_id=payload.username,
                    detail={"reason": "bad_credentials"}, source_ip=ip)
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    if user.must_reset_password:
        reset_token = make_scoped_token(user.id, PURPOSE_RESET, minutes=15)
        db.commit()
        return {"mustResetPassword": True, "resetToken": reset_token}

    if not user.mfa_secret_encrypted:
        enroll_token = make_scoped_token(user.id, PURPOSE_ENROLL, minutes=15)
        db.commit()
        return {"mfaEnrollmentRequired": True, "enrollToken": enroll_token}

    if not payload.totp_code:
        # Password verified but no code submitted yet — not a failed attempt, just the second
        # half of the same login call the client hasn't sent yet, so it isn't audit-logged as one.
        return {"mfaRequired": True}

    secret = decrypt_secret(user.mfa_secret_encrypted)
    if not verify_totp(secret, payload.totp_code):
        write_audit(db, user.id, "login_failed", target_type="user", target_id=user.id,
                    detail={"reason": "bad_totp"}, source_ip=ip)
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication code")

    expire = datetime.utcnow() + timedelta(hours=SESSION_HOURS)
    token = jwt.encode({"sub": user.id, "exp": expire}, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,  # Set to True in production over HTTPS
        max_age=SESSION_HOURS * 3600,
    )

    user.last_login_at = datetime.utcnow()
    write_audit(db, user.id, "login", target_type="user", target_id=user.id, source_ip=ip)
    db.commit()

    return {"user": _user_out(user), "sessionExpiresAt": expire.isoformat() + "Z"}


@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, request: Request, db: Session = Depends(get_db)):
    user_id = decode_scoped_token(payload.reset_token, PURPOSE_RESET)
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Token expired or invalid")

    error = validate_password_strength(payload.new_password)
    if error:
        raise HTTPException(status_code=400, detail=error)

    user.password_hash = hash_password(payload.new_password)
    user.must_reset_password = False
    write_audit(db, user.id, "password_reset", target_type="user", target_id=user.id,
                source_ip=client_ip(request))
    db.commit()
    return {"status": "ok"}


@router.post("/mfa/enroll")
def mfa_enroll(
    payload: MfaEnrollRequest,
    request: Request,
    db: Session = Depends(get_db),
    session_token: Optional[str] = Cookie(None),
):
    if payload.enroll_token:
        user_id = decode_scoped_token(payload.enroll_token, PURPOSE_ENROLL)
    elif session_token:
        # Already-authenticated user re-enrolling (e.g. new device) rather than a first-time,
        # pre-session enrollment — reuses the normal session check.
        user_id = get_current_user(session_token, db)["id"]
    else:
        raise HTTPException(status_code=401, detail="enrollToken or an active session is required")

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Token expired or invalid")

    secret = generate_totp_secret()
    user.mfa_secret_encrypted = encrypt_secret(secret)
    write_audit(db, user.id, "mfa_enroll", target_type="user", target_id=user.id,
                source_ip=client_ip(request))
    db.commit()

    return {
        "provisioningUri": totp_provisioning_uri(secret, user.username),
        "secret": secret,
    }


@router.get("/session")
def get_session(user: dict = Depends(get_current_user), session_token: Optional[str] = Cookie(None)):
    return {
        "user": user,
        "sessionId": session_token[-15:] if session_token else "session_id_mock",
    }


@router.post("/logout")
def logout(request: Request, response: Response, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    write_audit(db, user["id"], "logout", target_type="user", target_id=user["id"], source_ip=client_ip(request))
    db.commit()
    response.delete_cookie("session_token")
    return {"status": "logged_out"}


@router.post("/refresh")
def refresh(_user: dict = Depends(get_current_user)):
    return {"status": "refreshed"}


@router.post("/step-up")
def step_up(payload: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    # Step-up re-auth strengthens an *existing* session — it must never itself be a way to
    # establish one, or it's just a second, weaker login endpoint. Checks the caller's own real
    # password, not a shared/hardcoded one.
    db_user = db.query(User).filter(User.id == user["id"]).first()
    if not db_user or not verify_password(payload.get("password", ""), db_user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect password")
    expire = datetime.utcnow() + timedelta(hours=1)
    return {"grantedUntil": expire.isoformat() + "Z"}
