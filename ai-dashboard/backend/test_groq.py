from dotenv import load_dotenv
load_dotenv()
import os
from groq import Groq

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

try:
    res = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": "hi"}]
    )
    print("SUCCESS")
    print(res.choices[0].message.content)
except Exception as e:
    print("ERROR:", type(e).__name__, e)
