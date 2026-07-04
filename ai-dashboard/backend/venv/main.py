from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import os

from google import genai

# Load environment variables
load_dotenv()

app = FastAPI(title="AI Personal Assistant Dashboard API")

# CORS (allow frontend later)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API KEY
API_KEY = os.getenv("GEMINI_API_KEY")

if not API_KEY:
    raise Exception("GEMINI_API_KEY not found in .env file")

# Gemini client (new SDK)
client = genai.Client(api_key=API_KEY)


# Request model
class ChatRequest(BaseModel):
    prompt: str


# Home route
@app.get("/")
def home():
    return {"message": "AI Dashboard Running 🚀"}


# Chat endpoint (FIXED + STABLE)
@app.post("/chat")
def chat(request: ChatRequest):
    try:
        # Try models in order (safe fallback system)
        models = [
            "gemini-1.5-flash",
            "gemini-1.5-pro",
            "gemini-pro"
        ]

        for model_name in models:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=request.prompt
                )

                if response and response.text:
                    return {
                        "response": response.text,
                        "model_used": model_name
                    }

            except Exception:
                continue

        return {
            "error": "No working Gemini model found. Check API access."
        }

    except Exception as e:
        return {
            "error": str(e)
        }