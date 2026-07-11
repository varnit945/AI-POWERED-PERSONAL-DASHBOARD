from dotenv import load_dotenv
load_dotenv()

import os
import re
import sqlite3
import uuid
import random
import string
import resend
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr

router = APIRouter()

# ---------------- RESEND ----------------
resend.api_key = os.getenv("RESEND_API_KEY")

# ---------------- DB ----------------
DB_PATH = "chat_history.db"

JWT_SECRET = os.getenv("JWT_SECRET", "change-this-in-production")
JWT_ALGO = "HS256"
JWT_EXPIRY_HOURS = 24 * 7


# ---------------- DB ----------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_auth_db():
    conn = get_db()

    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS password_resets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            code TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used INTEGER DEFAULT 0
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS otp_rate_limit (
            email TEXT PRIMARY KEY,
            last_sent TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id TEXT PRIMARY KEY,
            theme TEXT DEFAULT 'dark',
            accent_color TEXT DEFAULT '#3b82f6',
            font_size TEXT DEFAULT 'medium',
            card_radius TEXT DEFAULT '12px',
            animations INTEGER DEFAULT 1,
            wallpaper TEXT DEFAULT '',
            preferred_model TEXT DEFAULT 'llama-3.3-70b-versatile',
            favorite_city TEXT DEFAULT 'Greater Noida',
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    """)

    try:
        conn.execute("ALTER TABLE user_settings ADD COLUMN api_key_mode TEXT DEFAULT 'system'")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE user_settings ADD COLUMN custom_api_key TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass

    conn.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            title TEXT,
            content TEXT,
            category TEXT DEFAULT 'General',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            filename TEXT,
            content_type TEXT,
            extracted_text TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS pomodoro_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            duration_minutes INTEGER,
            completed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS habits (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            UNIQUE(user_id, name)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS habit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            habit_id TEXT,
            completed_date TEXT NOT NULL,
            FOREIGN KEY (habit_id) REFERENCES habits (id),
            UNIQUE(habit_id, completed_date)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS task_lists (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            goal TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS task_items (
            id TEXT PRIMARY KEY,
            list_id TEXT,
            text TEXT,
            done INTEGER DEFAULT 0,
            FOREIGN KEY (list_id) REFERENCES task_lists (id) ON DELETE CASCADE
        )
    """)

    conn.commit()
    conn.close()


init_auth_db()


# ---------------- MODELS ----------------
class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    identifier: str
    password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str
    new_password: str


class SettingsUpdate(BaseModel):
    theme: str | None = None
    accent_color: str | None = None
    font_size: str | None = None
    card_radius: str | None = None
    animations: int | None = None
    wallpaper: str | None = None
    preferred_model: str | None = None
    favorite_city: str | None = None
    api_key_mode: str | None = None
    custom_api_key: str | None = None


# ---------------- HELPERS ----------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def create_token(user_id: str, username: str) -> str:
    payload = {
        "sub": user_id,
        "username": username,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def is_valid_username(username: str) -> bool:
    return bool(re.fullmatch(r"[a-zA-Z0-9_]{3,20}", username))


def generate_reset_code() -> str:
    return "".join(random.choices(string.digits, k=6))


security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        return {"id": payload["sub"], "username": payload["username"]}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------------- RATE LIMIT ----------------
def can_send_otp(conn, email: str) -> bool:
    row = conn.execute(
        "SELECT last_sent FROM otp_rate_limit WHERE email = ?",
        (email,)
    ).fetchone()

    if not row:
        return True

    last = datetime.fromisoformat(row["last_sent"])
    return datetime.now(timezone.utc) - last > timedelta(seconds=60)


# ---------------- EMAIL (RESEND HTML) ----------------
def send_email(to_email: str, subject: str, code: str):

    html = f"""
    <div style="font-family:Arial;background:#0f172a;padding:20px;color:white">
        <div style="max-width:500px;margin:auto;background:#111827;padding:25px;border-radius:12px">

            <h2 style="color:#60a5fa">🔐 Password Reset</h2>

            <p>You requested a password reset code:</p>

            <div style="
                font-size:30px;
                letter-spacing:8px;
                font-weight:bold;
                background:#1f2937;
                padding:15px;
                text-align:center;
                border-radius:10px;
                color:#22c55e;">
                {code}
            </div>

            <p>This code expires in <b>15 minutes</b>.</p>

            <p style="color:#f87171">
                If this wasn’t you, ignore this email.
            </p>

        </div>
    </div>
    """

    try:
        resend.Emails.send({
            "from": "AI Dashboard <onboarding@resend.dev>",
            "to": [to_email],
            "subject": subject,
            "html": html
        })

        print("Email sent ✔")

    except Exception as e:
        print("Email error:", e)


# ---------------- ROUTES ----------------

@router.post("/auth/register")
def register(req: RegisterRequest):

    if not is_valid_username(req.username):
        raise HTTPException(status_code=400, detail="Invalid username")

    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password too short")

    conn = get_db()

    exists = conn.execute(
        "SELECT id FROM users WHERE username=? OR email=?",
        (req.username, req.email)
    ).fetchone()

    if exists:
        conn.close()
        raise HTTPException(status_code=409, detail="User already exists")

    user_id = str(uuid.uuid4())

    conn.execute(
        "INSERT INTO users VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
        (user_id, req.username, req.email, hash_password(req.password))
    )

    conn.execute(
        "INSERT INTO user_settings (user_id) VALUES (?)",
        (user_id,)
    )

    conn.commit()
    conn.close()

    token = create_token(user_id, req.username)

    return {"token": token, "username": req.username}


@router.post("/auth/login")
def login(req: LoginRequest):

    conn = get_db()

    user = conn.execute(
        "SELECT * FROM users WHERE username=? OR email=?",
        (req.identifier, req.identifier)
    ).fetchone()

    conn.close()

    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_token(user["id"], user["username"])

    return {"token": token, "username": user["username"]}


@router.post("/auth/forgot-password")
def forgot_password(req: ForgotPasswordRequest):

    conn = get_db()

    try:
        user = conn.execute(
            "SELECT id FROM users WHERE email=?",
            (req.email,)
        ).fetchone()

        if not can_send_otp(conn, req.email):
            raise HTTPException(status_code=429, detail="Wait 60 seconds before retry")

        if user:
            code = generate_reset_code()
            expires = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()

            conn.execute(
                "INSERT INTO password_resets(email, code, expires_at) VALUES (?, ?, ?)",
                (req.email, code, expires)
            )

            conn.execute("""
                INSERT INTO otp_rate_limit(email, last_sent)
                VALUES (?, ?)
                ON CONFLICT(email) DO UPDATE SET last_sent=excluded.last_sent
            """, (req.email, datetime.now(timezone.utc).isoformat()))

            conn.commit()

            send_email(req.email, "Reset Code", code)

        return {"message": "If email exists, reset code sent"}

    finally:
        conn.close()


@router.post("/auth/reset-password")
def reset_password(req: ResetPasswordRequest):

    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password too short")

    conn = get_db()

    row = conn.execute(
        "SELECT * FROM password_resets WHERE email=? AND code=? AND used=0 ORDER BY id DESC LIMIT 1",
        (req.email, req.code)
    ).fetchone()

    if not row:
        conn.close()
        raise HTTPException(status_code=400, detail="Invalid code")

    if datetime.now(timezone.utc) > datetime.fromisoformat(row["expires_at"]):
        conn.close()
        raise HTTPException(status_code=400, detail="Code expired")

    conn.execute(
        "UPDATE users SET password_hash=? WHERE email=?",
        (hash_password(req.new_password), req.email)
    )

    conn.execute(
        "UPDATE password_resets SET used=1 WHERE id=?",
        (row["id"],)
    )

    conn.commit()
    conn.close()

    return {"message": "Password reset successful"}


# ---------------- SETTINGS ENDPOINTS ----------------

@router.get("/user/settings")
def get_settings(current_user: dict = Depends(get_current_user)):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM user_settings WHERE user_id = ?", (current_user["id"],)
    ).fetchone()
    
    if not row:
        conn.execute("INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)", (current_user["id"],))
        conn.commit()
        row = conn.execute("SELECT * FROM user_settings WHERE user_id = ?", (current_user["id"],)).fetchone()
        
    conn.close()
    return dict(row)


@router.post("/user/settings")
def update_settings(req: SettingsUpdate, current_user: dict = Depends(get_current_user)):
    conn = get_db()
    exists = conn.execute("SELECT 1 FROM user_settings WHERE user_id = ?", (current_user["id"],)).fetchone()
    if not exists:
        conn.execute("INSERT INTO user_settings (user_id) VALUES (?)", (current_user["id"],))
        conn.commit()
        
    updates = []
    params = []
    for field, val in req.model_dump(exclude_unset=True).items():
        if val is not None:
            updates.append(f"{field} = ?")
            params.append(val)
            
    if updates:
        params.append(current_user["id"])
        conn.execute(
            f"UPDATE user_settings SET {', '.join(updates)} WHERE user_id = ?",
            tuple(params)
        )
        conn.commit()
        
    row = conn.execute("SELECT * FROM user_settings WHERE user_id = ?", (current_user["id"],)).fetchone()
    conn.close()
    return dict(row)