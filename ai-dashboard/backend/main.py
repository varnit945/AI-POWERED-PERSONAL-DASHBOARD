from dotenv import load_dotenv
# ---------------- ENV ----------------
load_dotenv()

import os
import json
import uuid
import requests
import feedparser
import time
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import io
import pypdf
import docx
from pydantic import BaseModel
from groq import Groq
from auth import router as auth_router, get_current_user

app = FastAPI()
app.include_router(auth_router)

# ---------------- CORS ----------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------- KEYS ----------------
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")

client = Groq(api_key=GROQ_API_KEY or "dummy_key_to_prevent_startup_crash")

# ---------------- CACHING ----------------
WEATHER_CACHE_DURATION = 600  # 10 minutes
NEWS_CACHE_DURATION = 900     # 15 minutes

weather_cache = {}  # key: (city, country), value: (timestamp, data)
news_cache = {"timestamp": 0, "data": None}
briefing_cache = {} # key: user_id, value: (timestamp, data)
user_model_cache = {} # key: user_id, value: (timestamp, model_name)

# ---------------- SUPABASE IMPORT ----------------
from auth import supabase

def get_system_prompt():
    now_utc = datetime.now(timezone.utc)
    return (
        "You are a helpful AI assistant. Use the earlier messages in this "
        "conversation as context.\n\n"
        f"Current real-world date and time (UTC): {now_utc.strftime('%A, %B %d, %Y, %H:%M:%S')} UTC.\n"
        "If asked for the current date, time, day of the week, or the time in "
        "a specific city/timezone, calculate it yourself from the UTC value "
        "above (e.g. India Standard Time is UTC+5:30) and answer directly and "
        "confidently — do not say you lack real-time access or tell the user "
        "to search elsewhere."
    )


def build_history(rows):
    """Convert DB rows into Groq-style message history, capped to last 20 messages."""
    history = [{"role": "system", "content": get_system_prompt()}]
    for r in rows:
        role = "assistant" if r["role"] == "ai" else "user"
        history.append({"role": role, "content": r["content"]})

    if len(history) > 21:
        history = [history[0]] + history[-20:]

    return history


def get_user_model(*args, **kwargs):
    user_id = args[-1] if args else kwargs.get("user_id")
    now = time.time()
    if user_id in user_model_cache:
        ts, model = user_model_cache[user_id]
        if now - ts < 300:
            return model
            
    try:
        res = supabase.table("user_settings").select("preferred_model").eq("user_id", user_id).execute()
        if res.data and res.data[0].get("preferred_model"):
            model = res.data[0]["preferred_model"]
            decommissioned_map = {
                "llama3-8b-8192": "llama-3.1-8b-instant",
                "llama3-70b-8192": "llama-3.3-70b-versatile",
                "mixtral-8x7b-32768": "llama-3.1-8b-instant",
            }
            final_model = decommissioned_map.get(model, model)
            user_model_cache[user_id] = (now, final_model)
            return final_model
    except Exception:
        pass
        
        user_model_cache[user_id] = (now, "llama-3.1-8b-instant")
        return "llama-3.1-8b-instant"


def get_user_client(user_id: str):
    return client


def ask_groq(history, model="llama-3.3-70b-versatile", user_id=None):
    c = get_user_client(user_id) if user_id else client
    res = c.chat.completions.create(
        model=model,
        messages=history
    )
    return res.choices[0].message.content


def handle_ats_check(prompt: str, history_rows, pref_model: str, user_id: str) -> str | None:
    p = prompt.lower()
    ats_keywords = ["ats", "resume review", "resume check", "resume analysis", "ats score", "ats check", "check my resume", "analyze my resume", "review my resume"]
    if any(kw in p for kw in ats_keywords):
        has_file = False
        resume_content = ""
        
        # Check current prompt first
        if "attached file" in prompt.lower():
            has_file = True
            idx = prompt.lower().find("attached file")
            resume_content = prompt[idx:]
        else:
            # Check history rows (in reverse order to find the latest file)
            for row in reversed(history_rows):
                try:
                    row_role = row["role"]
                    row_content = row["content"]
                except (TypeError, KeyError):
                    row_role = getattr(row, "role", "")
                    row_content = getattr(row, "content", "")
                
                if row_role == "user" and "attached file" in row_content.lower():
                    has_file = True
                    idx = row_content.lower().find("attached file")
                    resume_content = row_content[idx:]
                    break
        
        if not has_file:
            return (
                "I would be happy to perform an ATS (Applicant Tracking System) check and keyword optimization review for your resume!\n\n"
                "Please **attach/upload your resume file** (PDF, DOCX, or TXT) using the **+ button** next to the chat input, "
                "and then ask me to check it. I will extract your skills, compute an ATS match score, and provide feedback on how to improve it!"
            )
        
        ats_prompt = (
            "You are an ATS (Applicant Tracking System) optimizer and professional recruiter. "
            "Review the resume text below and perform an ATS analysis. You MUST output your response "
            "as a raw JSON object containing the following keys (do not output any markdown code blocks, "
            "only raw JSON text):\n\n"
            "{\n"
            "  \"ats_score\": <number 0-100>,\n"
            "  \"skills_found\": [<list of identified technical & soft skills>],\n"
            "  \"missing_skills\": [<list of recommended technical skills in high demand relative to this profile>],\n"
            "  \"summary_improvements\": \"<string of advice to optimize summary/objective section>\",\n"
            "  \"projects_feedback\": \"<string of advice on project descriptions, suggesting metrics/accomplishments>\",\n"
            "  \"suggestions\": [<list of general tips to improve formatting, layout, ATS match>]\n"
            "}\n\n"
            f"Resume text:\n{resume_content[:60000]}"
        )
        
        try:
            res = get_user_client(user_id).chat.completions.create(
                model=pref_model,
                messages=[
                    {"role": "system", "content": "You are a recruitment AI that only output JSON answers."},
                    {"role": "user", "content": ats_prompt}
                ]
            )
            ai_text = res.choices[0].message.content.strip()
            
            # Clean up JSON if it contains markdown code blocks
            import re
            json_match = re.search(r"```json\s*(.*?)\s*```", ai_text, re.DOTALL)
            if json_match:
                ai_text = json_match.group(1).strip()
            else:
                brace_match = re.search(r"(\{.*\})", ai_text, re.DOTALL)
                if brace_match:
                    ai_text = brace_match.group(1).strip()
            return ai_text
        except Exception as e:
            return "Failed to perform ATS check. Please try again."
            
    return None


# ---------------- MODELS ----------------
class ChatRequest(BaseModel):
    prompt: str
    session_id: str | None = None  # if None, a new session is created


class TaskRequest(BaseModel):
    goal: str


class RegenerateRequest(BaseModel):
    session_id: str


class EditMessageRequest(BaseModel):
    session_id: str
    new_prompt: str


# ---------------- HOME ----------------
@app.get("/")
def home():
    return {"message": "AI Dashboard Running 🚀"}


def save_chat_messages(session_id: str, prompt: str, ai_text: str):
    try:
        supabase.table("messages").insert([
            {"session_id": session_id, "role": "user", "content": prompt},
            {"session_id": session_id, "role": "ai", "content": ai_text}
        ]).execute()
    except Exception as e:
        print(f"Failed to save messages: {e}")

# ---------------- CHAT (with memory + history) ----------------
@app.post("/chat")
def chat(req: ChatRequest, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    # 1. Get or create session
    session_id = req.session_id
    if not session_id:
        session_id = str(uuid.uuid4())
        supabase.table("sessions").insert({
            "id": session_id,
            "user_id": current_user["id"],
            "title": req.prompt[:40]
        }).execute()
    else:
        res = supabase.table("sessions").select("id").eq("id", session_id).eq("user_id", current_user["id"]).execute()
        if not res.data:
            supabase.table("sessions").insert({
                "id": session_id,
                "user_id": current_user["id"],
                "title": req.prompt[:40]
            }).execute()

    # 2. Load existing history (before user's current message)
    res = supabase.table("messages").select("role, content").eq("session_id", session_id).order("id").execute()
    rows = res.data or []
    
    # 3. Add user's current message to the rows array so ATS check & History build sees it
    rows.append({"role": "user", "content": req.prompt})

    pref_model = get_user_model(current_user["id"])
    
    ai_text = handle_ats_check(req.prompt, rows, pref_model, current_user["id"])
    if ai_text is None:
        history = build_history(rows)
        try:
            ai_text = ask_groq(history, model=pref_model, user_id=current_user["id"])
        except Exception:
            raise HTTPException(status_code=502, detail="AI service is unreachable right now.")

    # 4. Save both User and AI messages in the background
    background_tasks.add_task(save_chat_messages, session_id, req.prompt, ai_text)

    return {"response": ai_text, "session_id": session_id}


# ---------------- REGENERATE LAST AI RESPONSE ----------------
@app.post("/chat/regenerate")
def regenerate(req: RegenerateRequest, current_user: dict = Depends(get_current_user)):
    session = supabase.table("sessions").select("id").eq("id", req.session_id).eq("user_id", current_user["id"]).execute()
    if not session.data:
        raise HTTPException(status_code=403, detail="Access denied")

    res = supabase.table("messages").select("id, role, content").eq("session_id", req.session_id).order("id").execute()
    rows = res.data

    if not rows or rows[-1]["role"] != "ai":
        raise HTTPException(status_code=400, detail="No AI response to regenerate.")

    supabase.table("messages").delete().eq("id", rows[-1]["id"]).execute()
    
    remaining_rows = rows[:-1]
    last_user_prompt = next((r["content"] for r in reversed(remaining_rows) if r["role"] == "user"), "")

    pref_model = get_user_model(current_user["id"])
    
    ai_text = handle_ats_check(last_user_prompt, remaining_rows, pref_model, current_user["id"])
    if ai_text is None:
        history = build_history(remaining_rows)
        try:
            ai_text = ask_groq(history, model=pref_model, user_id=current_user["id"])
        except Exception:
            raise HTTPException(status_code=502, detail="AI service is unreachable right now.")

    supabase.table("messages").insert({
        "session_id": req.session_id,
        "role": "ai",
        "content": ai_text
    }).execute()

    return {"response": ai_text}


# ---------------- EDIT LAST USER MESSAGE + RE-RUN ----------------
@app.post("/chat/edit-last")
def edit_last(req: EditMessageRequest, current_user: dict = Depends(get_current_user)):
    session = supabase.table("sessions").select("id").eq("id", req.session_id).eq("user_id", current_user["id"]).execute()
    if not session.data:
        raise HTTPException(status_code=403, detail="Access denied")

    res = supabase.table("messages").select("id, role").eq("session_id", req.session_id).order("id").execute()
    rows = res.data

    if len(rows) < 2 or rows[-1]["role"] != "ai" or rows[-2]["role"] != "user":
        raise HTTPException(status_code=400, detail="No user/AI pair to edit.")

    # Supabase allows delete with IN, but simpler to do it twice or range since we have the IDs
    supabase.table("messages").delete().in_("id", [rows[-1]["id"], rows[-2]["id"]]).execute()

    supabase.table("messages").insert({
        "session_id": req.session_id,
        "role": "user",
        "content": req.new_prompt
    }).execute()

    res = supabase.table("messages").select("role, content").eq("session_id", req.session_id).order("id").execute()
    history_rows = res.data

    pref_model = get_user_model(current_user["id"])
    
    ai_text = handle_ats_check(req.new_prompt, history_rows, pref_model, current_user["id"])
    if ai_text is None:
        history = build_history(history_rows)
        try:
            ai_text = ask_groq(history, model=pref_model, user_id=current_user["id"])
        except Exception:
            raise HTTPException(status_code=502, detail="AI service is unreachable right now.")

    supabase.table("messages").insert({
        "session_id": req.session_id,
        "role": "ai",
        "content": ai_text
    }).execute()

    return {"response": ai_text}


# ---------------- SESSIONS API ----------------
@app.get("/sessions")
def list_sessions(current_user: dict = Depends(get_current_user)):
    res = supabase.table("sessions").select("id, title, created_at").eq("user_id", current_user["id"]).order("created_at", desc=True).execute()
    return {"sessions": res.data}


@app.get("/sessions/search")
def search_sessions(q: str, current_user: dict = Depends(get_current_user)):
    # With Supabase, cross-table OR search is best done with an RPC, but we can do it in two queries
    res_sess = supabase.table("sessions").select("id, title, created_at").eq("user_id", current_user["id"]).ilike("title", f"%{q}%").execute()
    
    # Get all user sessions
    all_sess = supabase.table("sessions").select("id").eq("user_id", current_user["id"]).execute()
    sess_ids = [s["id"] for s in all_sess.data]
    
    res_msg = {"data": []}
    if sess_ids:
        res_msg = supabase.table("messages").select("session_id").in_("session_id", sess_ids).ilike("content", f"%{q}%").execute()
        
    msg_sess_ids = {m["session_id"] for m in res_msg.data}
    
    res_final = supabase.table("sessions").select("id, title, created_at").eq("user_id", current_user["id"]).order("created_at", desc=True).execute()
    
    matched = []
    for s in res_final.data:
        if s["id"] in msg_sess_ids or q.lower() in s.get("title", "").lower():
            matched.append(s)
            
    return {"sessions": matched}


@app.get("/sessions/{session_id}/messages")
def get_session_messages(session_id: str, current_user: dict = Depends(get_current_user)):
    session = supabase.table("sessions").select("id").eq("id", session_id).eq("user_id", current_user["id"]).execute()
    if not session.data:
        raise HTTPException(status_code=403, detail="Access denied")

    res = supabase.table("messages").select("role, content, created_at").eq("session_id", session_id).order("id").execute()
    return {"messages": res.data}


@app.delete("/sessions/{session_id}")
def delete_session(session_id: str, current_user: dict = Depends(get_current_user)):
    session = supabase.table("sessions").select("id").eq("id", session_id).eq("user_id", current_user["id"]).execute()
    if not session.data:
        raise HTTPException(status_code=403, detail="Access denied")

    # Supabase cascade delete is configured in the schema, but we can do it explicitly
    supabase.table("messages").delete().eq("session_id", session_id).execute()
    supabase.table("sessions").delete().eq("id", session_id).execute()
    
    return {"status": "deleted"}


# ---------------- TASK GENERATOR ----------------
@app.post("/generate-tasks")
def generate_tasks(req: TaskRequest, current_user: dict = Depends(get_current_user)):
    prompt = f"""
Break this goal into 5-10 simple tasks:

Goal: {req.goal}

Rules:
- short steps
- clear actions
- bullet points only
"""

    try:
        res = get_user_client(current_user["id"]).chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": "You are a helpful productivity assistant."},
                {"role": "user", "content": prompt}
            ]
        )
    except Exception:
        raise HTTPException(status_code=502, detail="AI service is unreachable right now.")

    tasks = [
        t.strip("-• ").strip()
        for t in res.choices[0].message.content.split("\n")
        if t.strip()
    ]

    return {
        "goal": req.goal,
        "tasks": tasks
    }


# ---------------- REVERSE GEOCODING ----------------
@app.get("/weather/reverse-geocode")
def reverse_geocode(lat: float, lon: float, current_user: dict = Depends(get_current_user)):
    try:
        url = "http://api.openweathermap.org/geo/1.0/reverse"
        params = {
            "lat": lat,
            "lon": lon,
            "limit": 1,
            "appid": OPENWEATHER_API_KEY
        }
        res = requests.get(url, params=params, timeout=6)
        data = res.json()
        if data:
            return {"city": data[0]["name"]}
        else:
            raise HTTPException(status_code=404, detail="Location not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------- WEATHER ----------------
@app.get("/weather/{city}")
def weather(city: str, country: str | None = None, current_user: dict = Depends(get_current_user)):
    cache_key = (city.strip().lower(), (country or "").strip().lower())
    now = time.time()
    if cache_key in weather_cache:
        ts, data = weather_cache[cache_key]
        if now - ts < WEATHER_CACHE_DURATION:
            return data

    try:
        geo_url = "http://api.openweathermap.org/geo/1.0/direct"
        # Bias toward India by default since duplicate place names (e.g.
        # multiple "Manali"s worldwide) can cause the geocoding API to
        # resolve to the wrong location when limit=1 is used blindly.
        # Pass ?country=XX to override for other countries.
        query = f"{city},{country}" if country else f"{city},IN"
        geo_params = {
            "q": query,
            "limit": 5,
            "appid": OPENWEATHER_API_KEY
        }

        geo_res = requests.get(geo_url, params=geo_params, timeout=6)
        geo_data = geo_res.json()

        # Fallback: if the India-biased search finds nothing, retry without
        # a country restriction so non-Indian cities still work.
        if not geo_data and not country:
            geo_params["q"] = city
            geo_res = requests.get(geo_url, params=geo_params, timeout=6)
            geo_data = geo_res.json()

        if not geo_data:
            raise HTTPException(status_code=404, detail="City not found.")

        lat = geo_data[0]["lat"]
        lon = geo_data[0]["lon"]

        weather_url = "https://api.openweathermap.org/data/2.5/weather"
        weather_params = {
            "lat": lat,
            "lon": lon,
            "appid": OPENWEATHER_API_KEY,
            "units": "metric"
        }

        res = requests.get(weather_url, params=weather_params, timeout=6)
        data = res.json()

        if res.status_code != 200 or "main" not in data:
            raise HTTPException(status_code=404, detail="Weather not found.")

        result = {
            "city": geo_data[0]["name"],
            "temp": data["main"]["temp"],
            "humidity": data["main"]["humidity"],
            "condition": data["weather"][0]["description"]
        }
        weather_cache[cache_key] = (now, result)
        return result

    except requests.exceptions.RequestException:
        raise HTTPException(status_code=503, detail="Weather service is unreachable right now.")


# ---------------- FORECAST ----------------
@app.get("/weather/forecast/{city}")
def get_forecast(city: str, country: str | None = None, current_user: dict = Depends(get_current_user)):

    # 1. Geocode first, same as /weather/{city}, so forecast matches the
    #    exact same location as current conditions instead of relying on
    #    OpenWeather's fuzzy "q=city" name matching (which can silently
    #    resolve to the wrong place of the same name). Bias toward India
    #    by default; pass ?country=XX to override.
    geo_url = "http://api.openweathermap.org/geo/1.0/direct"
    query = f"{city},{country}" if country else f"{city},IN"
    geo_params = {
        "q": query,
        "limit": 5,
        "appid": OPENWEATHER_API_KEY
    }

    try:
        geo_res = requests.get(geo_url, params=geo_params, timeout=6)
        geo_data = geo_res.json()

        # Fallback to unrestricted search if India-biased search finds nothing
        if not geo_data and not country:
            geo_params["q"] = city
            geo_res = requests.get(geo_url, params=geo_params, timeout=6)
            geo_data = geo_res.json()
    except requests.exceptions.RequestException:
        raise HTTPException(status_code=503, detail="Forecast service is unreachable.")

    if not geo_data:
        raise HTTPException(status_code=404, detail="City not found.")

    lat = geo_data[0]["lat"]
    lon = geo_data[0]["lon"]

    url = "https://api.openweathermap.org/data/2.5/forecast"
    params = {
        "lat": lat,
        "lon": lon,
        "appid": OPENWEATHER_API_KEY,
        "units": "metric"
    }

    try:
        res = requests.get(url, params=params, timeout=6)
    except requests.exceptions.RequestException:
        raise HTTPException(status_code=503, detail="Forecast service is unreachable.")

    data = res.json()

    if res.status_code != 200 or "list" not in data:
        message = data.get("message", "Forecast not found.")
        raise HTTPException(status_code=404, detail=message.capitalize())

    # 2. The API returns entries in 3-hour steps. Taking the FIRST entry per
    #    day (old behavior) can grab an unrepresentative spike (e.g. a hot
    #    midday reading tagged onto a day that's mostly over). Instead, pick
    #    the entry closest to midday (12:00) for each date, which gives a
    #    much more representative daily temperature/condition.
    from collections import defaultdict

    by_date = defaultdict(list)
    for entry in data["list"]:
        date_str, time_str = entry["dt_txt"].split(" ")
        by_date[date_str].append((time_str, entry))

    daily_forecast = []
    for date_str, entries in list(by_date.items())[:5]:
        # pick entry whose time is closest to 12:00:00
        def hour_diff(item):
            time_str = item[0]
            hour = int(time_str.split(":")[0])
            return abs(hour - 12)

        _, best_entry = min(entries, key=hour_diff)

        daily_forecast.append({
            "date": date_str,
            "temp": best_entry["main"]["temp"],
            "condition": best_entry["weather"][0]["description"]
        })

    return {
        "city": geo_data[0]["name"],
        "forecast": daily_forecast
    }


# ---------------- 📰 FINAL NEWS ENGINE (NO API LIMITS) ----------------
@app.get("/trending-india-news")
def trending_news(current_user: dict = Depends(get_current_user)):
    now = time.time()
    if news_cache["data"] and now - news_cache["timestamp"] < NEWS_CACHE_DURATION:
        return news_cache["data"]

    # 🔥 Google News RSS (India trending feed)
    url = "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en"

    feed = feedparser.parse(url)

    articles = []

    for entry in feed.entries[:20]:
        articles.append({
            "title": entry.title,
            "source": "Google News",
            "url": entry.link,
            "summary": entry.title
        })

    result = {
        "total": len(articles),
        "articles": articles
    }
    news_cache["timestamp"] = now
    news_cache["data"] = result
    return result


# ----------------------------------------------------
# ------------------ KNOWLEDGE BASE ------------------
# ----------------------------------------------------

# --- TEXT EXTRACTION HELPERS ---
def extract_text_from_file(file_content: bytes, filename: str) -> str:
    ext = filename.split(".")[-1].lower()
    if ext in ("txt", "md", "markdown"):
        return file_content.decode("utf-8", errors="ignore")
    elif ext == "pdf":
        pdf_file = io.BytesIO(file_content)
        reader = pypdf.PdfReader(pdf_file)
        text = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                text.append(t)
        return "\n".join(text)
    elif ext == "docx":
        docx_file = io.BytesIO(file_content)
        doc = docx.Document(docx_file)
        text = []
        for para in doc.paragraphs:
            text.append(para.text)
        return "\n".join(text)
    return ""


# --- IMAGE & DOCUMENT PARSING HELPERS & ROUTES ---
def analyze_image_with_groq(image_bytes: bytes, mime_type: str, user_id: str) -> str:
    import base64
    base64_image = base64.b64encode(image_bytes).decode("utf-8")
    
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Analyze this image. If it contains document text, tables, or charts, "
                        "extract and transcribe them in full. If it is a photo or illustration, "
                        "describe all elements in detail."
                    )
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{mime_type};base64,{base64_image}"
                    }
                }
            ]
        }
    ]
    
    res = get_user_client(user_id).chat.completions.create(
        model="llama-3.2-11b-vision-preview",
        messages=messages,
        max_tokens=2048
    )
    return res.choices[0].message.content


@app.post("/chat/parse-file")
async def chat_parse_file(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    contents = await file.read()
    filename = file.filename
    content_type = file.content_type or ""
    
    ext = filename.split(".")[-1].lower()
    
    try:
        # Handle images
        if ext in ("jpg", "jpeg", "png", "webp", "gif") or content_type.startswith("image/"):
            if not content_type:
                if ext == "jpg" or ext == "jpeg":
                    content_type = "image/jpeg"
                elif ext == "png":
                    content_type = "image/png"
                elif ext == "webp":
                    content_type = "image/webp"
                elif ext == "gif":
                    content_type = "image/gif"
                else:
                    content_type = "image/jpeg"
            description = analyze_image_with_groq(contents, content_type, current_user["id"])
            return {"content": description, "readable": True}
        
        # Handle other files (PDF, DOCX, TXT, etc.)
        extracted_text = extract_text_from_file(contents, filename)
        if extracted_text.strip():
            return {"content": extracted_text, "readable": True}
        else:
            return {"content": "", "readable": False, "error": "Empty file or unsupported format."}
            
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse file: {str(e)}")


class NoteCreate(BaseModel):
    title: str
    content: str
    category: str | None = "General"

class NoteUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    category: str | None = None

class NoteAIRequest(BaseModel):
    action: str
    language: str | None = "English"
    title: str | None = None
    content: str | None = None


@app.get("/notes")
def list_notes(current_user: dict = Depends(get_current_user)):
    res = supabase.table("notes").select("id, title, content, category, created_at, updated_at").eq("user_id", current_user["id"]).order("updated_at", desc=True).execute()
    return {"notes": res.data}


@app.post("/notes")
def create_note(req: NoteCreate, current_user: dict = Depends(get_current_user)):
    note_id = str(uuid.uuid4())
    supabase.table("notes").insert({
        "id": note_id,
        "user_id": current_user["id"],
        "title": req.title,
        "content": req.content,
        "category": req.category
    }).execute()
    return {"id": note_id, "status": "created"}


@app.put("/notes/{note_id}")
def update_note(note_id: str, req: NoteUpdate, current_user: dict = Depends(get_current_user)):
    exists = supabase.table("notes").select("id").eq("id", note_id).eq("user_id", current_user["id"]).execute()
    if not exists.data:
        raise HTTPException(status_code=404, detail="Note not found")
        
    update_data = {}
    for field, val in req.model_dump(exclude_unset=True).items():
        if val is not None:
            update_data[field] = val
            
    if update_data:
        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        supabase.table("notes").update(update_data).eq("id", note_id).eq("user_id", current_user["id"]).execute()
        
    return {"status": "updated"}


@app.delete("/notes/{note_id}")
def delete_note(note_id: str, current_user: dict = Depends(get_current_user)):
    exists = supabase.table("notes").select("id").eq("id", note_id).eq("user_id", current_user["id"]).execute()
    if not exists.data:
        raise HTTPException(status_code=404, detail="Note not found")
        
    supabase.table("notes").delete().eq("id", note_id).eq("user_id", current_user["id"]).execute()
    return {"status": "deleted"}


@app.post("/notes/{note_id}/ai")
def note_ai_action(note_id: str, req: NoteAIRequest, current_user: dict = Depends(get_current_user)):
    if req.content is not None and req.title is not None:
        title = req.title
        content = req.content
    else:
        note = supabase.table("notes").select("title, content").eq("id", note_id).eq("user_id", current_user["id"]).execute()
        
        if not note.data:
            raise HTTPException(status_code=404, detail="Note not found")
            
        content = note.data[0]["content"]
        title = note.data[0]["title"]
    
    if req.action == "summarize":
        system_prompt = "You are an expert AI summarizer. Provide a summary of the text below. Make it structured, clear, and concise."
        user_prompt = f"Summarize this note (Title: {title}):\n\n{content}"
    elif req.action == "action_items":
        system_prompt = "You are a productivity assistant. Extract actionable checklists and todo items from the text below."
        user_prompt = f"Generate action items for this note (Title: {title}):\n\n{content}"
    elif req.action == "quiz":
        system_prompt = "You are a study coach. Create a 5-question multiple choice quiz with answer options and an answer key based on the text below."
        user_prompt = f"Create a quiz for this note (Title: {title}):\n\n{content}"
    elif req.action == "keywords":
        system_prompt = "Extract the top keywords and topics as a simple comma-separated list of tags."
        user_prompt = f"Extract keywords for this note:\n\n{content}"
    elif req.action == "translate":
        system_prompt = f"You are a translator. Translate the text below to {req.language or 'Spanish'}."
        user_prompt = f"Translate this note:\n\n{content}"
    elif req.action == "grammar":
        system_prompt = "You are an English teacher. Correct grammar mistakes and write a polished version of the text, then list the key corrections."
        user_prompt = f"Correct grammar and polish this note:\n\n{content}"
    elif req.action == "minutes":
        system_prompt = "Convert the unstructured notes or transcript below into structured professional meeting minutes (Attendees, Date, Discussion, Key Decisions, Next Steps)."
        user_prompt = f"Create meeting minutes for this note:\n\n{content}"
    else:
        raise HTTPException(status_code=400, detail="Invalid AI action requested")

    pref_model = get_user_model(current_user["id"])
    
    try:
        res = get_user_client(current_user["id"]).chat.completions.create(
            model=pref_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
        )
        return {"result": res.choices[0].message.content}
    except Exception:
        raise HTTPException(status_code=502, detail="AI service is unreachable right now.")


# --- DOCUMENT MODELS & ROUTES ---
class DocChatRequest(BaseModel):
    prompt: str


@app.post("/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    contents = await file.read()
    filename = file.filename
    content_type = file.content_type
    
    try:
        extracted_text = extract_text_from_file(contents, filename)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to extract text: {str(e)}")
        
    if not extracted_text.strip():
        raise HTTPException(status_code=422, detail="Extracted text is empty or file type unsupported.")
        
    doc_id = str(uuid.uuid4())
    supabase.table("documents").insert({
        "id": doc_id,
        "user_id": current_user["id"],
        "filename": filename,
        "content_type": content_type,
        "extracted_text": extracted_text
    }).execute()
    
    return {"id": doc_id, "filename": filename, "status": "uploaded"}


@app.get("/documents")
def list_documents(current_user: dict = Depends(get_current_user)):
    res = supabase.table("documents").select("id, filename, content_type, created_at").eq("user_id", current_user["id"]).order("created_at", desc=True).execute()
    return {"documents": res.data}


@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str, current_user: dict = Depends(get_current_user)):
    exists = supabase.table("documents").select("id").eq("id", doc_id).eq("user_id", current_user["id"]).execute()
    if not exists.data:
        raise HTTPException(status_code=404, detail="Document not found")
        
    supabase.table("documents").delete().eq("id", doc_id).eq("user_id", current_user["id"]).execute()
    return {"status": "deleted"}


@app.post("/documents/{doc_id}/chat")
def chat_with_document(doc_id: str, req: DocChatRequest, current_user: dict = Depends(get_current_user)):
    doc = supabase.table("documents").select("filename, extracted_text").eq("id", doc_id).eq("user_id", current_user["id"]).execute()
    
    if not doc.data:
        raise HTTPException(status_code=404, detail="Document not found")
        
    extracted_text = doc.data[0]["extracted_text"]
    filename = doc.data[0]["filename"]
    
    truncated_context = extracted_text[:80000]
    
    system_prompt = (
        f"You are an AI assistant helping a user analyze a document named \"{filename}\". "
        "Use the document text below to answer their questions. If you cannot find the answer or if the "
        "document doesn't contain it, answer based on your knowledge but explicitly mention that it was not "
        "found directly in the document.\n\n"
        f"--- DOCUMENT START ---\n{truncated_context}\n--- DOCUMENT END ---"
    )
    
    pref_model = get_user_model(current_user["id"])
    
    try:
        res = get_user_client(current_user["id"]).chat.completions.create(
            model=pref_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": req.prompt}
            ]
        )
        return {"response": res.choices[0].message.content}
    except Exception:
        raise HTTPException(status_code=502, detail="AI service is unreachable right now.")


# --- FEDERATED SEARCH API ---
@app.get("/search")
def federated_search(q: str, current_user: dict = Depends(get_current_user)):
    if not q.strip():
        return {"notes": [], "documents": [], "chats": []}
        
    like_query = f"%{q}%"
    user_id = current_user["id"]
    
    notes_res = supabase.table("notes").select("id, title, content, category").eq("user_id", user_id).or_(f"title.ilike.{like_query},content.ilike.{like_query}").execute()
    docs_res = supabase.table("documents").select("id, filename, content_type").eq("user_id", user_id).or_(f"filename.ilike.{like_query},extracted_text.ilike.{like_query}").execute()
    
    all_sess = supabase.table("sessions").select("id").eq("user_id", user_id).execute()
    sess_ids = [s["id"] for s in all_sess.data]
    
    res_msg = {"data": []}
    if sess_ids:
        res_msg = supabase.table("messages").select("session_id").in_("session_id", sess_ids).ilike("content", like_query).execute()
        
    msg_sess_ids = {m["session_id"] for m in res_msg.data}
    
    res_final = supabase.table("sessions").select("id, title, created_at").eq("user_id", user_id).execute()
    
    matched_chats = []
    for s in res_final.data:
        if s["id"] in msg_sess_ids or q.lower() in s.get("title", "").lower():
            matched_chats.append(s)
            
    return {
        "notes": notes_res.data,
        "documents": docs_res.data,
        "chats": matched_chats
    }


# ----------------------------------------------------
# ------------------ PRODUCTIVITY --------------------
# ----------------------------------------------------

# --- PYDANTIC MODELS ---
class TaskItemCreate(BaseModel):
    text: str

class TaskListCreate(BaseModel):
    goal: str
    tasks: list[TaskItemCreate]

class PomodoroCreate(BaseModel):
    duration_minutes: int

class HabitCreate(BaseModel):
    name: str

class HabitToggle(BaseModel):
    date: str


# --- TASKS ENDPOINTS ---
@app.get("/tasks")
def list_tasks(current_user: dict = Depends(get_current_user)):
    lists_res = supabase.table("task_lists").select("id, goal, created_at").eq("user_id", current_user["id"]).order("created_at", desc=True).execute()
    
    result = []
    for l in lists_res.data:
        items_res = supabase.table("task_items").select("id, text, done").eq("list_id", l["id"]).execute()
        result.append({
            "id": l["id"],
            "goal": l["goal"],
            "createdAt": l["created_at"],
            "tasks": [{"id": i["id"], "text": i["text"], "done": bool(i["done"])} for i in items_res.data]
        })
        
    return {"taskLists": result}


@app.post("/tasks")
def save_task_list(req: TaskListCreate, current_user: dict = Depends(get_current_user)):
    list_id = str(uuid.uuid4())
    supabase.table("task_lists").insert({
        "id": list_id,
        "user_id": current_user["id"],
        "goal": req.goal
    }).execute()
    
    if req.tasks:
        items_to_insert = [{
            "id": str(uuid.uuid4()),
            "list_id": list_id,
            "text": t.text,
            "done": 0
        } for t in req.tasks]
        supabase.table("task_items").insert(items_to_insert).execute()
        
    return {"id": list_id, "status": "saved"}


@app.post("/tasks/toggle/{item_id}")
def toggle_task_item(item_id: str, current_user: dict = Depends(get_current_user)):
    item_res = supabase.table("task_items").select("id, done, list_id").eq("id", item_id).execute()
    if not item_res.data:
        raise HTTPException(status_code=404, detail="Task item not found")
        
    item = item_res.data[0]
    list_res = supabase.table("task_lists").select("id").eq("id", item["list_id"]).eq("user_id", current_user["id"]).execute()
    if not list_res.data:
        raise HTTPException(status_code=404, detail="Task item not found")
        
    new_done = 0 if item["done"] else 1
    supabase.table("task_items").update({"done": new_done}).eq("id", item_id).execute()
    return {"status": "toggled", "done": bool(new_done)}


@app.delete("/tasks/list/{list_id}")
def delete_task_list(list_id: str, current_user: dict = Depends(get_current_user)):
    exists = supabase.table("task_lists").select("id").eq("id", list_id).eq("user_id", current_user["id"]).execute()
    if not exists.data:
        raise HTTPException(status_code=404, detail="Task list not found")
        
    supabase.table("task_items").delete().eq("list_id", list_id).execute()
    supabase.table("task_lists").delete().eq("id", list_id).eq("user_id", current_user["id"]).execute()
    return {"status": "deleted"}


# --- POMODORO ENDPOINTS ---
@app.post("/pomodoro/sessions")
def record_pomodoro(req: PomodoroCreate, current_user: dict = Depends(get_current_user)):
    session_id = str(uuid.uuid4())
    supabase.table("pomodoro_sessions").insert({
        "id": session_id,
        "user_id": current_user["id"],
        "duration_minutes": req.duration_minutes
    }).execute()
    return {"status": "recorded", "id": session_id}


@app.get("/pomodoro/stats")
def get_pomodoro_stats(current_user: dict = Depends(get_current_user)):
    today_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_start = f"{today_date}T00:00:00Z"
    
    today_res = supabase.table("pomodoro_sessions").select("duration_minutes").eq("user_id", current_user["id"]).gte("completed_at", today_start).execute()
    today_rows = today_res.data
    
    total_today = sum(r["duration_minutes"] for r in today_rows)
    sessions_today = len(today_rows)
    
    all_time_res = supabase.table("pomodoro_sessions").select("duration_minutes").eq("user_id", current_user["id"]).execute()
    all_time_rows = all_time_res.data
    
    total_sessions = len(all_time_rows)
    total_minutes = sum(r["duration_minutes"] for r in all_time_rows)
    
    return {
        "todayFocusMinutes": total_today,
        "todaySessions": sessions_today,
        "totalSessions": total_sessions,
        "totalFocusHours": round(total_minutes / 60.0, 1)
    }


# --- HABITS ENDPOINTS ---
@app.get("/habits")
def list_habits(current_user: dict = Depends(get_current_user)):
    res = supabase.table("habits").select("id, name, created_at").eq("user_id", current_user["id"]).order("created_at").execute()
    habits = res.data
    
    result = []
    for h in habits:
        logs_res = supabase.table("habit_logs").select("completed_date").eq("habit_id", h["id"]).order("completed_date").execute()
        result.append({
            "id": h["id"],
            "name": h["name"],
            "completedDates": [l["completed_date"] for l in logs_res.data]
        })
        
    return {"habits": result}


@app.post("/habits")
def create_habit(req: HabitCreate, current_user: dict = Depends(get_current_user)):
    habit_id = str(uuid.uuid4())
    try:
        supabase.table("habits").insert({
            "id": habit_id,
            "user_id": current_user["id"],
            "name": req.name
        }).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail="Habit with this name already exists or database error")
    return {"id": habit_id, "name": req.name, "status": "created"}


@app.delete("/habits/{habit_id}")
def delete_habit(habit_id: str, current_user: dict = Depends(get_current_user)):
    exists = supabase.table("habits").select("id").eq("id", habit_id).eq("user_id", current_user["id"]).execute()
    if not exists.data:
        raise HTTPException(status_code=404, detail="Habit not found")
        
    supabase.table("habit_logs").delete().eq("habit_id", habit_id).execute()
    supabase.table("habits").delete().eq("id", habit_id).eq("user_id", current_user["id"]).execute()
    return {"status": "deleted"}


@app.post("/habits/{habit_id}/toggle")
def toggle_habit_date(habit_id: str, req: HabitToggle, current_user: dict = Depends(get_current_user)):
    habit = supabase.table("habits").select("id").eq("id", habit_id).eq("user_id", current_user["id"]).execute()
    if not habit.data:
        raise HTTPException(status_code=404, detail="Habit not found")
        
    log = supabase.table("habit_logs").select("id").eq("habit_id", habit_id).eq("completed_date", req.date).execute()
    
    if log.data:
        supabase.table("habit_logs").delete().eq("id", log.data[0]["id"]).execute()
        status = "toggled_off"
    else:
        supabase.table("habit_logs").insert({
            "habit_id": habit_id,
            "completed_date": req.date
        }).execute()
        status = "toggled_on"
        
    return {"status": status}


# --- AI DAILY BRIEFING ---
@app.get("/daily-briefing")
def get_daily_briefing(hour: int | None = None, local_time: str | None = None, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    now = time.time()
    if user_id in briefing_cache:
        ts, data = briefing_cache[user_id]
        if now - ts < 600:
            return data

    city = "Mumbai"
    pref = supabase.table("user_settings").select("favorite_city").eq("user_id", current_user["id"]).execute()
    if pref.data and pref.data[0].get("favorite_city"):
        city = pref.data[0]["favorite_city"]
        
    weather_info = "Weather: N/A"
    try:
        w_data = weather(city, current_user=current_user)
        weather_info = f"{w_data['temp']}°C, {w_data['condition'].capitalize()} in {w_data['city']}"
    except Exception:
        pass

    task_count = 0
    pending_task_list = []
    try:
        lists_data = list_tasks(current_user=current_user)["taskLists"]
        for lst in lists_data:
            for task in lst["tasks"]:
                if not task["done"]:
                    task_count += 1
                    pending_task_list.append(f"- {task['text']} (Goal: {lst['goal']})")
    except Exception:
        pass
        
    news_headlines = []
    try:
        news_data = trending_news(current_user=current_user)["articles"][:3]
        for art in news_data:
            news_headlines.append(f"- {art['title']}")
    except Exception:
        pass

    today_tasks_text = "\n".join(pending_task_list[:5]) if pending_task_list else "No active pending tasks."
    today_news_text = "\n".join(news_headlines) if news_headlines else "No trending headlines."
    
    if hour is None:
        hour = datetime.now().hour

    if not local_time:
        local_time = datetime.now().strftime("%I:%M %p")

    username = current_user.get("username", "Varnit")

    if 5 <= hour < 12:
        time_context = "morning"
        greeting_rule = f"Good morning welcome greeting addressing the user as '{username}'."
        role_desc = "morning briefings"
    elif 12 <= hour < 17:
        time_context = "afternoon"
        greeting_rule = f"Good afternoon greeting addressing the user as '{username}'."
        role_desc = "afternoon updates"
    elif 17 <= hour < 22:
        time_context = "evening"
        greeting_rule = f"Good evening greeting addressing the user as '{username}'."
        role_desc = "evening reviews"
    else:
        time_context = "night"
        greeting_rule = f"Good night/late evening greeting addressing the user as '{username}'."
        role_desc = "nightly wind-down summaries"

    if 5 <= hour < 17:
        # Day mode
        prompt = (
            f"Generate a personalized daily briefing {time_context} report based on the day's conditions:\n\n"
            f"User Name: {username}\n"
            f"Real-world Location: {city}\n"
            f"Current Local Time: {local_time}\n"
            f"Current weather condition: {weather_info}\n"
            f"Pending tasks count: {task_count}\n"
            f"Top active tasks:\n{today_tasks_text}\n\n"
            f"Top India News headlines:\n{today_news_text}\n\n"
            "Rules:\n"
            f"- {greeting_rule} You MUST mention the current local time in your welcome greeting naturally (e.g., 'Good morning, {username}! It is {local_time} in {city}.'). Never mention any other names.\n"
            "- Concise overview of the day (busy-ness estimation).\n"
            "- A priority task suggestion to focus on.\n"
            "- Suggest one helpful productivity tip.\n"
            "- Close with a short motivational quote."
        )
    else:
        # Night mode
        prompt = (
            f"Generate a personalized daily briefing {time_context} review based on the day's conditions:\n\n"
            f"User Name: {username}\n"
            f"Real-world Location: {city}\n"
            f"Current Local Time: {local_time}\n"
            f"Current weather condition: {weather_info}\n"
            f"Pending tasks count: {task_count}\n"
            f"Top active tasks:\n{today_tasks_text}\n\n"
            f"Top India News headlines:\n{today_news_text}\n\n"
            "Rules:\n"
            f"- {greeting_rule} You MUST mention the current local time in your welcome greeting naturally. Never mention any other names.\n"
            "- A gentle summary of the day's tasks and news.\n"
            "- A recommendation on how to prepare/schedule for the next day.\n"
            "- Suggest one winding down or reflection tip for the night.\n"
            "- Close with a peaceful reflection or night quote."
        )
    
    pref_model = get_user_model(current_user["id"])
    
    try:
        res = get_user_client(current_user["id"]).chat.completions.create(
            model=pref_model,
            messages=[
                {"role": "system", "content": f"You are a personalized assistant delivering daily {role_desc}."},
                {"role": "user", "content": prompt}
            ]
        )
        result = {"briefing": res.choices[0].message.content}
        briefing_cache[user_id] = (now, result)
        return result
    except Exception:
        raise HTTPException(status_code=502, detail="Briefing service is currently busy.")


# ----------------------------------------------------
# ---------------- COACHING & ANALYTICS --------------
# ----------------------------------------------------

# --- RESUME ANALYSIS MODELS & ROUTES ---

@app.post("/resume/analyze")
async def analyze_resume(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    contents = await file.read()
    filename = file.filename
    
    try:
        text = extract_text_from_file(contents, filename)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to read resume file: {str(e)}")
        
    if not text.strip():
        raise HTTPException(status_code=422, detail="Extracted text is empty or unsupported resume format.")
        
    prompt = (
        "You are an ATS (Applicant Tracking System) optimizer and professional recruiter. "
        "Review the resume text below and perform an ATS analysis. You MUST output your response "
        "as a raw JSON object containing the following keys (do not output any markdown code blocks, "
        "only raw JSON text):\n\n"
        "{\n"
        "  \"ats_score\": <number 0-100>,\n"
        "  \"skills_found\": [<list of identified technical & soft skills>],\n"
        "  \"missing_skills\": [<list of recommended technical skills in high demand relative to this profile>],\n"
        "  \"summary_improvements\": \"<string of advice to optimize summary/objective section>\",\n"
        "  \"projects_feedback\": \"<string of advice on project descriptions, suggesting metrics/accomplishments>\",\n"
        "  \"suggestions\": [<list of general tips to improve formatting, layout, ATS match>]\n"
        "}\n\n"
        f"Resume text:\n{text[:60000]}"
    )
    
    pref_model = get_user_model(current_user["id"])
    
    try:
        res = get_user_client(current_user["id"]).chat.completions.create(
            model=pref_model,
            messages=[
                {"role": "system", "content": "You are a recruitment AI that only output JSON answers."},
                {"role": "user", "content": prompt}
            ]
        )
        content_text = res.choices[0].message.content.strip()
        
        import re
        json_match = re.search(r"```json\s*(.*?)\s*```", content_text, re.DOTALL)
        if json_match:
            json_str = json_match.group(1).strip()
        else:
            brace_match = re.search(r"(\{.*\})", content_text, re.DOTALL)
            if brace_match:
                json_str = brace_match.group(1).strip()
            else:
                json_str = content_text.strip()
        
        raw_analysis = json.loads(json_str, strict=False)
        
        parsed_analysis = {
            "ats_score": raw_analysis.get("ats_score", raw_analysis.get("atsScore", 65)),
            "skills_found": raw_analysis.get("skills_found", raw_analysis.get("skillsFound", raw_analysis.get("skills", ["Communication"]))),
            "missing_skills": raw_analysis.get("missing_skills", raw_analysis.get("missingSkills", raw_analysis.get("recommended_skills", ["Technical Skills"]))),
            "summary_improvements": raw_analysis.get("summary_improvements", raw_analysis.get("summaryImprovements", "Good summary.")),
            "projects_feedback": raw_analysis.get("projects_feedback", raw_analysis.get("projectsFeedback", "Add more metrics.")),
            "suggestions": raw_analysis.get("suggestions", raw_analysis.get("general_suggestions", ["Format consistently."]))
        }
        
        if not isinstance(parsed_analysis["skills_found"], list):
            parsed_analysis["skills_found"] = [parsed_analysis["skills_found"]]
        if not isinstance(parsed_analysis["missing_skills"], list):
            parsed_analysis["missing_skills"] = [parsed_analysis["missing_skills"]]
        if not isinstance(parsed_analysis["suggestions"], list):
            parsed_analysis["suggestions"] = [parsed_analysis["suggestions"]]
            
        return parsed_analysis
    except Exception as e:
        print("Resume AI analysis failed:", e)
        return {
            "ats_score": 65,
            "skills_found": ["Communication", "Organization"],
            "missing_skills": ["Docker", "FastAPI", "AWS", "CI/CD"],
            "summary_improvements": "Your summary is a bit general. Make sure it highlights core technical stack accomplishments and metrics.",
            "projects_feedback": "Quantify your achievements. Instead of saying 'developed features', say 'increased performance by 20% by restructuring DB queries'.",
            "suggestions": [
                "Tailor resume keywords to target job descriptions.",
                "Ensure consistent formatting (dates, bullet points, font sizes).",
                "Include a dedicated Technical Skills section at the top."
            ]
        }


# --- STUDY HUB MODELS & ROUTES ---
class StudyRequest(BaseModel):
    topic: str
    text_content: str | None = None
    num_questions: int | None = 5
    exclude_questions: list[str] | None = None
    difficulty: str | None = "Intermediate"
    target_marks: str | None = "5 Marks"


@app.post("/study/flashcards")
def generate_flashcards(req: StudyRequest, current_user: dict = Depends(get_current_user)):
    num_c = req.num_questions or 5
    diff = req.difficulty or "Intermediate"
    marks = req.target_marks or "5 Marks"

    batch_size = 2 if marks == "10 Marks" else 3
    all_cards = []
    excludes = list(req.exclude_questions or [])

    pref_model = get_user_model(current_user["id"])

    system_content = (
        "You are an expert academic professor and grading evaluator. "
        "You write highly detailed, structured, and comprehensive educational content inside JSON fields. "
        "You strictly follow word count limits: "
        "- If the request is for '10 Marks', the answer field MUST contain between 300 and 400 words.\n"
        "- If the request is for '5 Marks', the answer field MUST contain between 130 and 170 words.\n"
        "- If the request is for '2 Marks', the answer field MUST contain between 40 and 60 words.\n"
        "This is a strict requirement for exams. Never summarize or write short answers for high-mark questions."
    )

    import re
    max_loops = (num_c + batch_size - 1) // batch_size + 2
    loop_count = 0

    while len(all_cards) < num_c and loop_count < max_loops:
        loop_count += 1
        current_batch_size = min(batch_size, num_c - len(all_cards))
        
        exclude_str = ""
        current_excludes = excludes + [c["question"] for c in all_cards]
        if current_excludes:
            exclude_str = "You MUST NOT generate flashcard questions that are similar or identical to the following list:\n" + "\n".join(f"- {q}" for q in current_excludes) + "\n\n"

        prompt = (
            f"You are an expert educator. Create a set of exactly {current_batch_size} unique educational flashcard(s) "
            f"at a '{diff}' difficulty level for the following topic/content. "
            f"The answers MUST be tailored strictly to a '{marks}' standard. Specifically:\n"
            "- If target standard is '2 Marks', write a concise explanation between 40 to 60 words.\n"
            "- If target standard is '5 Marks', write a structured explanation between 130 to 170 words (using paragraphs or bullet points).\n"
            "- If target standard is '10 Marks', you MUST write a comprehensive, detailed, and structured essay/guide between 300 to 400 words. You MUST include subheadings (like '### Context', '### Core Concepts', '### Real-World Example'), detailed bullet points, and extensive explanations. Under NO circumstances should a '10 Marks' answer be short, concise, or summarized. Be highly verbose.\n\n"
            "CRITICAL RULE: The answer length must strictly align with the word counts. For '10 Marks', the answer must contain at least 300 words. Failing to do so is unacceptable.\n\n"
            "Example structure for a '10 Marks' answer in JSON:\n"
            "{\n"
            "  \"flashcards\": [\n"
            "    {\n"
            "      \"question\": \"What is the topic?\",\n"
            "      \"answer\": \"### Context\\n[Detailed explanation context of about 100 words...]\\n\\n### Core Concepts\\n1. Point A...\\n2. Point B... (provide a very detailed breakdown, 150 words)\\n\\n### Real-World Example\\nConsider a scenario... (provide a detailed scenario showing how it operates, 100 words)\"\n    }\n  ]\n"
            "}\n\n"
            "You MUST respond with a raw JSON object containing a list of card objects with 'question' and 'answer' keys. "
            "Do not output any markdown code blocks, only raw JSON text:\n\n"
            "{\n"
            "  \"flashcards\": [\n"
            "    { \"question\": \"Question text?\", \"answer\": \"Answer text.\" }\n"
            "  ]\n"
            "}\n\n"
            f"{exclude_str}"
            f"Topic/Content:\n{req.topic}\n{req.text_content or ''}"
        )

        try:
            res = get_user_client(current_user["id"]).chat.completions.create(
                model=pref_model,
                messages=[
                    {"role": "system", "content": system_content},
                    {"role": "user", "content": prompt}
                ]
            )
            content_text = res.choices[0].message.content.strip()
            
            json_match = re.search(r"```json\s*(.*?)\s*```", content_text, re.DOTALL)
            if json_match:
                json_str = json_match.group(1).strip()
            else:
                brace_match = re.search(r"(\{.*\})", content_text, re.DOTALL)
                if brace_match:
                    json_str = brace_match.group(1).strip()
                else:
                    json_str = content_text.strip()
            
            batch_data = json.loads(json_str, strict=False)
            if "flashcards" in batch_data and isinstance(batch_data["flashcards"], list):
                all_cards.extend(batch_data["flashcards"])
        except Exception as e:
            print(f"Batch generation failed: {str(e)}")
            if len(all_cards) == 0:
                raise HTTPException(status_code=502, detail=f"Failed to generate flashcards: {str(e)}")

    return {"flashcards": all_cards[:num_c]}


@app.post("/study/quiz")
def generate_quiz(req: StudyRequest, current_user: dict = Depends(get_current_user)):
    num_q = req.num_questions or 5
    diff = req.difficulty or "Intermediate"
    
    batch_size = 2
    all_questions = []
    excludes = list(req.exclude_questions or [])
    
    pref_model = get_user_model(current_user["id"])
    
    import re
    max_loops = (num_q + batch_size - 1) // batch_size + 2
    loop_count = 0
    
    while len(all_questions) < num_q and loop_count < max_loops:
        loop_count += 1
        current_batch_size = min(batch_size, num_q - len(all_questions))
        
        exclude_str = ""
        current_excludes = excludes + [q["question"] for q in all_questions]
        if current_excludes:
            exclude_str = "You MUST NOT generate questions that are similar or identical to the following list:\n" + "\n".join(f"- {q}" for q in current_excludes) + "\n\n"

        prompt = (
            f"You are an expert educator. Create a quiz at a '{diff}' difficulty level with exactly {current_batch_size} unique multiple choice question(s) "
            "for the following topic/content. You MUST respond with a raw JSON object containing "
            "a list of question objects with 'question', 'options' (list of 4 options), 'correct_index' (0-3), "
            "and 'explanation' keys. Do not output any markdown code blocks, only raw JSON text:\n\n"
            "{\n"
            "  \"quiz\": [\n"
            "    {\n"
            "      \"question\": \"Question text?\",\n"
            "      \"options\": [\"Option A\", \"Option B\", \"Option C\", \"Option D\"],\n"
            "      \"correct_index\": 0,\n"
            "      \"explanation\": \"Detailed explanation of why Option A is correct.\"\n"
            "    }\n"
            "  ]\n"
            "}\n\n"
            f"{exclude_str}"
            f"Topic/Content:\n{req.topic}\n{req.text_content or ''}"
        )
        
        try:
            res = get_user_client(current_user["id"]).chat.completions.create(
                model=pref_model,
                messages=[
                    {"role": "system", "content": "You are a teacher AI that only outputs JSON answers."},
                    {"role": "user", "content": prompt}
                ]
            )
            content_text = res.choices[0].message.content.strip()
            
            json_match = re.search(r"```json\s*(.*?)\s*```", content_text, re.DOTALL)
            if json_match:
                json_str = json_match.group(1).strip()
            else:
                brace_match = re.search(r"(\{.*\})", content_text, re.DOTALL)
                if brace_match:
                    json_str = brace_match.group(1).strip()
                else:
                    json_str = content_text.strip()
            
            batch_data = json.loads(json_str, strict=False)
            if "quiz" in batch_data and isinstance(batch_data["quiz"], list):
                all_questions.extend(batch_data["quiz"])
        except Exception as e:
            print(f"Quiz batch failed: {str(e)}")
            if len(all_questions) == 0:
                raise HTTPException(status_code=502, detail=f"Failed to generate quiz: {str(e)}")
                
    return {"quiz": all_questions[:num_q]}


# --- INTERVIEW PREP MODELS & ROUTES ---
class InterviewRequest(BaseModel):
    category: str
    difficulty: str | None = "Intermediate"

class AnswerSubmission(BaseModel):
    category: str
    question: str
    answer: str


@app.post("/interview/questions")
def generate_interview_questions(req: InterviewRequest, current_user: dict = Depends(get_current_user)):
    prompt = (
        f"You are a tech interviewer. Generate a list of 4 interview questions (including 1 coding or scenario problem) "
        f"for a candidate interviewing for a {req.category} developer role. "
        f"Difficulty: {req.difficulty or 'Intermediate'}.\n\n"
        "You MUST output the response as a raw JSON array containing exactly 4 questions (do not output any markdown "
        "code blocks, only raw JSON text):\n\n"
        "[\n"
        "  {\n"
        "    \"question\": \"<question text>\",\n"
        "    \"type\": \"technical\" or \"coding\" or \"behavioral\"\n"
        "  }\n"
        "]"
    )
    
    pref_model = get_user_model(current_user["id"])
    
    try:
        res = get_user_client(current_user["id"]).chat.completions.create(
            model=pref_model,
            messages=[
                {"role": "system", "content": "You are a tech recruiter that outputs JSON arrays of questions."},
                {"role": "user", "content": prompt}
            ]
        )
        content_text = res.choices[0].message.content.strip()
        if content_text.startswith("```"):
            if content_text.startswith("```json"):
                content_text = content_text[7:]
            else:
                content_text = content_text[3:]
            if content_text.endswith("```"):
                content_text = content_text[:-3]
                
        questions = json.loads(content_text.strip(), strict=False)
        return {"questions": questions}
    except Exception as e:
        print("Questions generation failed:", e)
        return {
            "questions": [
                {"question": f"Explain key core concepts of {req.category} and how it works under the hood.", "type": "technical"},
                {"question": f"Describe a complex problem you solved while working with {req.category}.", "type": "behavioral"},
                {"question": f"What are the best practices for structuring files and scaling in a {req.category} project?", "type": "technical"},
                {"question": "How do you optimize performance and reduce memory consumption in your application?", "type": "technical"}
            ]
        }


@app.post("/interview/submit")
def evaluate_interview_answer(req: AnswerSubmission, current_user: dict = Depends(get_current_user)):
    prompt = (
        f"You are a technical interviewer reviewing a candidate's answer for the following question on {req.category}.\n\n"
        f"Question: {req.question}\n"
        f"Candidate's Answer: {req.answer}\n\n"
        "Evaluate the answer. Provide a score from 0 to 100, specific feedback detailing what they did well, "
        "what key concepts they missed, and an ideal reference answer.\n\n"
        "You MUST output the response as a raw JSON object (do not output any markdown code blocks, only raw JSON):\n\n"
        "{\n"
        "  \"score\": <number 0-100>,\n"
        "  \"feedback\": \"<feedback text>\",\n"
        "  \"missing_concepts\": [<list of missing concepts/terms>],\n"
        "  \"ideal_answer\": \"<ideal reference answer text>\"\n"
        "}"
    )
    
    pref_model = get_user_model(current_user["id"])
    
    try:
        res = get_user_client(current_user["id"]).chat.completions.create(
            model=pref_model,
            messages=[
                {"role": "system", "content": "You are a tech evaluator that outputs JSON evaluation metrics."},
                {"role": "user", "content": prompt}
            ]
        )
        content_text = res.choices[0].message.content.strip()
        if content_text.startswith("```"):
            if content_text.startswith("```json"):
                content_text = content_text[7:]
            else:
                content_text = content_text[3:]
            if content_text.endswith("```"):
                content_text = content_text[:-3]
                
        eval_result = json.loads(content_text.strip(), strict=False)
        return eval_result
    except Exception as e:
        print("Answer evaluation failed:", e)
        return {
            "score": 75,
            "feedback": "Your answer is correct but a bit brief. You can expand it by highlighting specific tools and operational structures.",
            "missing_concepts": ["Operational constraints", "Memory optimizations"],
            "ideal_answer": "An ideal answer should detail core principles, explain implementation architectures, and give concrete production metrics."
        }


# --- CODE ASSISTANT ROUTES ---
class CodeAssistRequest(BaseModel):
    code: str
    language: str
    action: str  # explain | debug | optimize | test | doc


@app.post("/code/assist")
def code_assistant_utility(req: CodeAssistRequest, current_user: dict = Depends(get_current_user)):
    if req.action == "explain":
        system_prompt = f"You are a senior {req.language} engineer. Explain the following code step-by-step, listing key concepts."
        user_prompt = f"Explain this code:\n\n{req.code}"
    elif req.action == "debug":
        system_prompt = f"You are a debugging expert. Identify bugs or logical errors in the following {req.language} code, list the issues found, and output the corrected version."
        user_prompt = f"Debug this code:\n\n{req.code}"
    elif req.action == "optimize":
        system_prompt = f"You are a performance optimization specialist. Identify bottlenecks in the {req.language} code and rewrite it for maximum speed, memory efficiency, and clean layout."
        user_prompt = f"Optimize this code:\n\n{req.code}"
    elif req.action == "test":
        system_prompt = f"You are a software tester. Generate a complete set of unit tests (mocking dependencies if necessary) for the {req.language} code below."
        user_prompt = f"Generate unit tests for this code:\n\n{req.code}"
    elif req.action == "doc":
        system_prompt = f"You are a technical writer. Document the following {req.language} code, writing clear docstrings, comments, and parameter descriptions."
        user_prompt = f"Document this code:\n\n{req.code}"
    else:
        raise HTTPException(status_code=400, detail="Invalid action requested")

    pref_model = get_user_model(current_user["id"])
    
    try:
        res = get_user_client(current_user["id"]).chat.completions.create(
            model=pref_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
        )
        return {"result": res.choices[0].message.content}
    except Exception:
        raise HTTPException(status_code=502, detail="Code assistant service is currently busy.")