# api/routes/users.py
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from core.database import get_db
from core.audit import write_audit, client_ip
from core.security import generate_temp_password, hash_password
from api.routes.auth import require_role
from models.orm import User
from models.domain import UserCreateRequest, UserUpdateRequest, PaginatedResponse

# No self-registration: every route here requires an existing ADMIN session. This is the only
# way a User row gets created past the one bootstrap admin init_db() seeds.
router = APIRouter(dependencies=[Depends(require_role("ADMIN"))])


def _user_out(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "displayName": user.display_name or user.username,
        "role": user.role,
        "isActive": user.is_active,
        "mustResetPassword": user.must_reset_password,
        "mfaEnrolled": user.mfa_secret_encrypted is not None,
        "createdBy": user.created_by,
        "createdAt": user.created_at.isoformat() + "Z" if user.created_at else None,
        "lastLoginAt": user.last_login_at.isoformat() + "Z" if user.last_login_at else None,
    }


def _active_admin_count(db: Session, exclude_user_id: str = None) -> int:
    q = db.query(User).filter(User.role == "ADMIN", User.is_active == True)  # noqa: E712
    if exclude_user_id:
        q = q.filter(User.id != exclude_user_id)
    return q.count()


@router.get("", response_model=PaginatedResponse)
def list_users(db: Session = Depends(get_db)):
    rows = db.query(User).order_by(User.created_at.asc()).all()
    return PaginatedResponse(items=[_user_out(u) for u in rows], next_cursor=None)


@router.post("")
def create_user(payload: UserCreateRequest, request: Request, db: Session = Depends(get_db), admin: dict = Depends(require_role("ADMIN"))):
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")

    temp_password = generate_temp_password()
    user = User(
        id=f"USR_{uuid.uuid4().hex[:10]}",
        username=payload.username,
        display_name=payload.display_name,
        password_hash=hash_password(temp_password),
        role=payload.role,
        is_active=True,
        must_reset_password=True,
        created_by=admin["id"],
    )
    db.add(user)
    db.flush()  # assigns/confirms the row before we reference user.id in the audit entry below

    write_audit(db, admin["id"], "user_create", target_type="user", target_id=user.id,
                detail={"username": user.username, "role": user.role}, source_ip=client_ip(request))
    db.commit()
    db.refresh(user)

    # Temp password is returned exactly once, to the provisioning admin — never retrievable again
    # (a subsequent lost-password case goes through POST /users/{id}/reset-password instead).
    return {"user": _user_out(user), "tempPassword": temp_password}


@router.patch("/{user_id}")
def update_user(user_id: str, payload: UserUpdateRequest, request: Request, db: Session = Depends(get_db), admin: dict = Depends(require_role("ADMIN"))):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    changes = {}
    demoting_or_deactivating_admin = (
        user.role == "ADMIN"
        and (
            (payload.role is not None and payload.role != "ADMIN")
            or (payload.is_active is False)
        )
    )
    if demoting_or_deactivating_admin and _active_admin_count(db, exclude_user_id=user.id) == 0:
        raise HTTPException(status_code=400, detail="Cannot remove the last active ADMIN account")

    if payload.role is not None and payload.role != user.role:
        changes["role"] = {"from": user.role, "to": payload.role}
        user.role = payload.role
    if payload.is_active is not None and payload.is_active != user.is_active:
        changes["isActive"] = {"from": user.is_active, "to": payload.is_active}
        user.is_active = payload.is_active

    if changes:
        write_audit(db, admin["id"], "user_update", target_type="user", target_id=user.id,
                    detail=changes, source_ip=client_ip(request))
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.post("/{user_id}/reset-password")
def admin_reset_password(user_id: str, request: Request, db: Session = Depends(get_db), admin: dict = Depends(require_role("ADMIN"))):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    temp_password = generate_temp_password()
    user.password_hash = hash_password(temp_password)
    user.must_reset_password = True
    # Also clears MFA enrollment: this endpoint doubles as the recovery path for a lost/broken
    # authenticator (there's no separate "reset MFA" flow) — without this, an admin-issued
    # password reset couldn't actually get a locked-out user back in, since login re-checks
    # mfa_secret_encrypted before granting a session.
    user.mfa_secret_encrypted = None

    write_audit(db, admin["id"], "user_password_reset_by_admin", target_type="user", target_id=user.id,
                source_ip=client_ip(request))
    db.commit()
    return {"tempPassword": temp_password}
