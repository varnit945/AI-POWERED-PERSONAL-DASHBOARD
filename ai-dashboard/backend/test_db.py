import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")

if not url or not key:
    print("SUPABASE_URL or SUPABASE_KEY is missing from .env.")
    exit(1)

try:
    supabase: Client = create_client(url, key)
    # Perform a simple query to see if it reaches the database
    response = supabase.table("user_settings").select("*").limit(1).execute()
    print("Database connection is working successfully!")
    print("Query returned:", response.data)
except Exception as e:
    print("Failed to connect to the database:")
    print(e)
