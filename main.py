import sys
import os

# Add ai-dashboard/backend to system path
backend_path = os.path.join(os.path.dirname(__file__), "ai-dashboard", "backend")
sys.path.append(backend_path)

# Change directory to backend so database and config files load correctly
os.chdir(backend_path)

import uvicorn
from main import app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
