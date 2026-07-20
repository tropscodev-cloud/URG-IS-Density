# core/audit.py
from typing import Optional

from sqlalchemy.orm import Session

from models.orm import AuditLog


def write_audit(
    db: Session,
    actor_user_id: Optional[str],
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    detail: Optional[dict] = None,
    source_ip: Optional[str] = None,
) -> None:
    """Stages an AuditLog row on the given session — deliberately does NOT call db.commit(). The
    caller commits it together with the state change it documents, in the same transaction, so an
    action and its audit record can never diverge (one can't succeed while the other silently
    doesn't)."""
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            detail=detail,
            source_ip=source_ip,
        )
    )


def client_ip(request) -> Optional[str]:
    return request.client.host if request and request.client else None
