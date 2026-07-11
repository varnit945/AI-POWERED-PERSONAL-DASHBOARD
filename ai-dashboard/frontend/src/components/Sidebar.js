import React from "react";
import "./Sidebar.css";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: "📊" },
  { key: "chat", label: "Chat", icon: "💬" },
  { key: "news", label: "News", icon: "📰" },
  { key: "weather", label: "Weather", icon: "🌤" },
  { key: "tasks", label: "Tasks", icon: "📅" },
  { key: "pomodoro", label: "Focus Timer", icon: "⏱️" },
  { key: "habits", label: "Habits", icon: "🎯" },
  { key: "notes", label: "Notes", icon: "📝" },
  { key: "documents", label: "Files", icon: "📁" },
  { key: "study", label: "Study Hub", icon: "🎓" },
  { key: "interview", label: "Mock Interviews", icon: "🎙️" },
  { key: "code", label: "Code Copilot", icon: "💻" },
  { key: "search", label: "Search", icon: "🔍" },
  { key: "settings", label: "Settings", icon: "⚙️" },
];

export default function Sidebar({
  page,
  setPage,
  theme,
  toggleTheme,
  handleLogout,
  user,
}) {
  return (
    <div className="sidebar glass">
      <div className="sidebar-brand">
        <span className="brand-dot" />
        AI SaaS
      </div>

      {user && (
        <div
          style={{
            marginBottom: "20px",
            padding: "10px",
            borderRadius: "10px",
            background: "rgba(255,255,255,0.08)",
            textAlign: "center",
            fontSize: "14px",
          }}
        >
          👋 {user.username}
        </div>
      )}

      <div className="nav-group">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            className={`nav-btn ${page === item.key ? "active" : ""}`}
            onClick={() => setPage(item.key)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      <button className="theme-toggle" onClick={toggleTheme}>
        <span className="theme-toggle-track">
          <span className={`theme-toggle-thumb ${theme}`}>
            {theme === "dark" ? "🌙" : "☀️"}
          </span>
        </span>
        <span>{theme === "dark" ? "Dark mode" : "Light mode"}</span>
      </button>

      <button
        onClick={handleLogout}
        style={{
          marginTop: "20px",
          width: "100%",
          padding: "12px",
          border: "none",
          borderRadius: "10px",
          cursor: "pointer",
          fontWeight: "600",
        }}
      >
        🚪 Logout
      </button>
    </div>
  );
}