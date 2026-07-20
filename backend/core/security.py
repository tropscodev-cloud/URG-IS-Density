# core/security.py
"""
Centralized auth primitives shared by api/routes/auth.py, users.py, cameras.py, and analytics.py:
password hashing, TOTP enrollment/verification, at-rest encryption for TOTP secrets, and the
short-lived single-purpose tokens used for the password-reset and MFA-enrollment handoffs (each
scoped so a reset token can't be replayed as an enrollment token or a real session, and vice
versa).
"""
import secrets
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
import jwt
import pyotp
from cryptography.fernet import Fernet
from fastapi import HTTPException

from core.config import settings

# Calling bcrypt directly rather than through passlib's CryptContext: passlib 1.7.4 (its last
# release, effectively unmaintained) probes bcrypt's internals in a way that breaks against
# bcrypt>=4.0's API changes ("module 'bcrypt' has no attribute '__about__'"), which silently
# corrupted every hash during testing here. bcrypt itself is actively maintained and this is a
# thin, well-documented direct usage — no abstraction layer needed for one algorithm.
_fernet = Fernet(settings.MFA_ENCRYPTION_KEY.encode() if isinstance(settings.MFA_ENCRYPTION_KEY, str) else settings.MFA_ENCRYPTION_KEY)

MFA_ISSUER = "URG-IS"

# Scoped-token purposes — each is a narrow, single-use-flow credential, never interchangeable
# with a real session token or with each other.
PURPOSE_RESET = "password_reset"
PURPOSE_ENROLL = "mfa_enroll"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except (ValueError, TypeError):
        # Malformed/empty hash, or an over-length password bcrypt itself rejects — never let this
        # surface as a 500 that could hint at account state; treat it as a failed check like any
        # other wrong password.
        return False


def generate_temp_password() -> str:
    """URL-safe random string, shown to the provisioning admin exactly once."""
    return secrets.token_urlsafe(12)


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, username: str) -> str:
    return pyotp.totp.TOTP(secret).provisioning_uri(name=username, issuer_name=MFA_ISSUER)


def verify_totp(secret: str, code: str) -> bool:
    if not code:
        return False
    # valid_window=1 tolerates one 30s step of clock drift either side — standard TOTP practice,
    # not a meaningful widening of the guessable window.
    return pyotp.totp.TOTP(secret).verify(code, valid_window=1)


def encrypt_secret(plain: str) -> str:
    return _fernet.encrypt(plain.encode()).decode()


def decrypt_secret(encrypted: str) -> str:
    return _fernet.decrypt(encrypted.encode()).decode()


def make_scoped_token(user_id: str, purpose: str, minutes: int = 10) -> str:
    payload = {
        "sub": user_id,
        "purpose": purpose,
        "exp": datetime.utcnow() + timedelta(minutes=minutes),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_scoped_token(token: str, expected_purpose: str) -> str:
    """Returns the user_id embedded in the token, or raises 401 — used for the password-reset and
    MFA-enrollment handoffs, both of which happen *before* a real session exists."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Token expired or invalid")
    if payload.get("purpose") != expected_purpose:
        raise HTTPException(status_code=401, detail="Token not valid for this operation")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token expired or invalid")
    return user_id


MIN_PASSWORD_LENGTH = 12
# bcrypt's own hard limit — recent bcrypt (>=4.0) raises rather than silently truncating past this,
# so an over-length password must be rejected here with a clean 400, not left to crash hashpw().
MAX_PASSWORD_LENGTH = 72


def validate_password_strength(password: str) -> Optional[str]:
    """Returns an error message if the password fails policy, else None."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
    if len(password.encode("utf-8")) > MAX_PASSWORD_LENGTH:
        return f"Password must be at most {MAX_PASSWORD_LENGTH} bytes"
    return None
