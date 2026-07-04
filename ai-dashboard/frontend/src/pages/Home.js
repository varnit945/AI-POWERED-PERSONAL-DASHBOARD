import React from "react";
import { useNavigate } from "react-router-dom";
import "./Home.css";

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="home-container">
      {/* HERO SECTION */}
      <div className="hero">
        <div className="badge">🤖 AI Powered Dashboard</div>

        <h1>
          Your Personal <span>AI Assistant</span> for Everything
        </h1>

        <p>
          Chat, live news updates, weather insights, and smart task generation —
          all in one modern dashboard powered by AI.
        </p>

        <div className="buttons">
          <button onClick={() => navigate("/dashboard")} className="primary">
            🚀 Open Dashboard
          </button>

          <button className="secondary">
            Learn More
          </button>
        </div>
      </div>

      {/* FEATURES SECTION */}
      <div className="features">
        <div className="feature-card">
          <h3>💬 Smart Chat</h3>
          <p>Talk with AI assistant in real time</p>
        </div>

        <div className="feature-card">
          <h3>📰 Live News</h3>
          <p>Trending updates from India & world</p>
        </div>

        <div className="feature-card">
          <h3>🌦 Weather</h3>
          <p>Live weather insights instantly</p>
        </div>

        <div className="feature-card">
          <h3>📌 Task Generator</h3>
          <p>AI creates smart daily tasks for you</p>
        </div>
      </div>
    </div>
  );
}