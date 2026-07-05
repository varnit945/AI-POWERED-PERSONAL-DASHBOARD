// Central API configuration - single source of truth for backend URL
// Set REACT_APP_API_URL in Netlify environment variables to point to your Replit backend
const API = process.env.REACT_APP_API_URL || "http://127.0.0.1:8000";

export default API;
