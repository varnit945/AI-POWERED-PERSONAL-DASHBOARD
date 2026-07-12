from dotenv import load_dotenv
load_dotenv()

import os
import re
import uuid
import random
import string
import resend
from datetime import datetime, timedelta, timezone

import hashlib
import jwt
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from supabase import create_client, Client

router = APIRouter()

# ---------------- RESEND ----------------
resend.api_key = os.getenv("RESEND_API_KEY")

# ---------------- SUPABASE ----------------
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_KEY in environment variables")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

JWT_SECRET = os.getenv("JWT_SECRET", "change-this-in-production")
JWT_ALGO = "HS256"
JWT_EXPIRY_HOURS = 24 * 7

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
    salt = os.urandom(16)
    pw_hash = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000)
    return salt.hex() + ":" + pw_hash.hex()

def verify_password(password: str, password_hash: str) -> bool:
    if ":" not in password_hash:
        return False
    salt_hex, hash_hex = password_hash.split(":")
    salt = bytes.fromhex(salt_hex)
    pw_hash = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000)
    return pw_hash.hex() == hash_hex

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
def can_send_otp(email: str) -> bool:
    response = supabase.table("otp_rate_limit").select("last_sent").eq("email", email).execute()
    if not response.data:
        return True
    
    last = datetime.fromisoformat(response.data[0]["last_sent"])
    # If using Python 3.11+, fromisoformat handles the timezone from postgres nicely, 
    # but we might need to ensure both are aware
    return datetime.now(timezone.utc) - last > timedelta(seconds=60)

# ---------------- EMAIL (RESEND HTML) ----------------
def send_email(to_email: str, subject: str, code: str):
    html = f"""
    <div style="font-family:Arial;background:#0f172a;padding:20px;color:white">
        <div style="max-width:500px;margin:auto;background:#111827;padding:25px;border-radius:12px">
            <h2 style="color:#60a5fa">🔐 Password Reset</h2>
            <p>You requested a password reset code:</p>
            <div style="font-size:30px;letter-spacing:8px;font-weight:bold;background:#1f2937;padding:15px;text-align:center;border-radius:10px;color:#22c55e;">
                {code}
            </div>
            <p>This code expires in <b>15 minutes</b>.</p>
            <p style="color:#f87171">If this wasn’t you, ignore this email.</p>
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

    # Check if exists
    response = supabase.table("users").select("id").or_(f"username.eq.{req.username},email.eq.{req.email}").execute()
    if response.data:
        raise HTTPException(status_code=409, detail="User already exists")

    user_id = str(uuid.uuid4())
    supabase.table("users").insert({
        "id": user_id,
        "username": req.username,
        "email": req.email,
        "password_hash": hash_password(req.password)
    }).execute()

    supabase.table("user_settings").insert({"user_id": user_id}).execute()
    token = create_token(user_id, req.username)
    return {"token": token, "username": req.username}

@router.post("/auth/login")
def login(req: LoginRequest):
    response = supabase.table("users").select("*").or_(f"username.eq.{req.identifier},email.eq.{req.identifier}").execute()
    if not response.data or not verify_password(req.password, response.data[0]["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user = response.data[0]
    token = create_token(user["id"], user["username"])
    return {"token": token, "username": user["username"]}

@router.post("/auth/forgot-password")
def forgot_password(req: ForgotPasswordRequest):
    response = supabase.table("users").select("id").eq("email", req.email).execute()
    
    if not can_send_otp(req.email):
        raise HTTPException(status_code=429, detail="Wait 60 seconds before retry")

    if response.data:
        code = generate_reset_code()
        expires = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()

        supabase.table("password_resets").insert({
            "email": req.email,
            "code": code,
            "expires_at": expires
        }).execute()

        # Update rate limit
        supabase.table("otp_rate_limit").upsert({
            "email": req.email,
            "last_sent": datetime.now(timezone.utc).isoformat()
        }).execute()

        send_email(req.email, "Reset Code", code)

    return {"message": "If email exists, reset code sent"}

@router.post("/auth/reset-password")
def reset_password(req: ResetPasswordRequest):
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password too short")

    # Supabase select with order and limit
    response = supabase.table("password_resets") \
        .select("*") \
        .eq("email", req.email) \
        .eq("code", req.code) \
        .eq("used", 0) \
        .order("id", desc=True) \
        .limit(1) \
        .execute()

    if not response.data:
        raise HTTPException(status_code=400, detail="Invalid code")

    row = response.data[0]
    if datetime.now(timezone.utc) > datetime.fromisoformat(row["expires_at"]):
        raise HTTPException(status_code=400, detail="Code expired")

    supabase.table("users").update({"password_hash": hash_password(req.new_password)}).eq("email", req.email).execute()
    supabase.table("password_resets").update({"used": 1}).eq("id", row["id"]).execute()
    return {"message": "Password reset successful"}

# ---------------- SETTINGS ENDPOINTS ----------------
@router.get("/user/settings")
def get_settings(current_user: dict = Depends(get_current_user)):
    response = supabase.table("user_settings").select("*").eq("user_id", current_user["id"]).execute()
    if not response.data:
        # Create default settings if not exist
        supabase.table("user_settings").insert({"user_id": current_user["id"]}).execute()
        response = supabase.table("user_settings").select("*").eq("user_id", current_user["id"]).execute()
        
    return response.data[0] if response.data else {}

@router.post("/user/settings")
def update_settings(req: SettingsUpdate, current_user: dict = Depends(get_current_user)):
    # Verify exists
    response = supabase.table("user_settings").select("user_id").eq("user_id", current_user["id"]).execute()
    if not response.data:
        supabase.table("user_settings").insert({"user_id": current_user["id"]}).execute()

    updates = {k: v for k, v in req.model_dump(exclude_unset=True).items() if v is not None}
    
    if updates:
        supabase.table("user_settings").update(updates).eq("user_id", current_user["id"]).execute()

    response = supabase.table("user_settings").select("*").eq("user_id", current_user["id"]).execute()
    return response.data[0] if response.data else {}