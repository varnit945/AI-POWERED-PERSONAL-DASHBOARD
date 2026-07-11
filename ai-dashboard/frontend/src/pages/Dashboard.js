import React, { useState, useEffect } from "react";
import axios from "axios";
import "./Dashboard.css";
import { detectLocation } from "../utils/geo";

const API = "http://127.0.0.1:8000";

const DraggableCard = ({ title, desc, icon, onClick, onDragStart, onDragOver, onDrop }) => {
  return (
    <div
      className="card draggable-card glass"
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span className="card-status" />
      <div className="card-drag-indicator">⋮⋮</div>
      <h3>
        {icon} {title}
      </h3>
      <p>{desc}</p>
    </div>
  );
};

const Dashboard = ({ messages = [], taskLists = [], setPage, user, pomoMode, pomoTimeLeft, pomoIsRunning }) => {
  const [briefing, setBriefing] = useState("");
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [pomoStats, setPomoStats] = useState({ todayFocusMinutes: 0, todaySessions: 0, totalFocusHours: 0 });
  const [habitsCount, setHabitsCount] = useState(0);
  const [docsCount, setDocsCount] = useState(0);

  // Drag and Drop widgets list
  const [widgets, setWidgets] = useState([
    { id: "chat", icon: "💬", title: "AI Chat" },
    { id: "pomodoro", icon: "⏱️", title: "Focus Timer" },
    { id: "habits", icon: "🎯", title: "Habits" },
    { id: "documents", icon: "📁", title: "Documents" },
    { id: "tasks", icon: "📅", title: "Tasks" },
  ]);
  const [draggedIdx, setDraggedIdx] = useState(null);

  useEffect(() => {
    fetchDashboardBriefing();
    fetchStats();
  }, []);

  useEffect(() => {
    if (user) {
      loadWidgetOrder();
    }
  }, [user]);

  const fetchDashboardBriefing = async () => {
    setBriefingLoading(true);
    try {
      const now = new Date();
      const localHour = now.getHours();
      const localTime = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const res = await axios.get(`${API}/daily-briefing`, {
        params: { hour: localHour, local_time: localTime }
      });
      setBriefing(res.data.briefing);
    } catch (err) {
      setBriefing("Could not load today's briefing. Generate tasks or check news to compile it!");
    } finally {
      setBriefingLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const [pomoRes, habitsRes, docsRes] = await Promise.all([
        axios.get(`${API}/pomodoro/stats`),
        axios.get(`${API}/habits`),
        axios.get(`${API}/documents`),
      ]);
      setPomoStats(pomoRes.data);
      setHabitsCount(habitsRes.data.habits.length);
      setDocsCount(docsRes.data.documents.length);
    } catch (err) {
      console.error("Failed to load dashboard metrics", err);
    }
  };

  const loadWidgetOrder = () => {
    const savedOrder = localStorage.getItem(`dashboard_widget_order_${user?.id || "guest"}`);
    if (savedOrder) {
      try {
        const parsed = JSON.parse(savedOrder);
        if (parsed.length === 5) {
          setWidgets(parsed);
        }
      } catch (e) {
        console.error(e);
      }
    }
  };

  const saveWidgetOrder = (newOrder) => {
    setWidgets(newOrder);
    localStorage.setItem(`dashboard_widget_order_${user?.id || "guest"}`, JSON.stringify(newOrder));
  };

  const handleDragStart = (e, index) => {
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = (e, targetIdx) => {
    if (draggedIdx === null || draggedIdx === targetIdx) return;
    const reordered = [...widgets];
    const [draggedItem] = reordered.splice(draggedIdx, 1);
    reordered.splice(targetIdx, 0, draggedItem);
    saveWidgetOrder(reordered);
    setDraggedIdx(null);
  };

  const totalTasks = taskLists.reduce((sum, l) => sum + l.tasks.length, 0);
  const doneTasks = taskLists.reduce(
    (sum, l) => sum + l.tasks.filter((t) => t.done).length,
    0
  );

  const getWidgetDesc = (id) => {
    if (id === "chat") return "Brainstorm or analyze documents";
    if (id === "pomodoro") {
      if (pomoIsRunning) {
        const mins = Math.floor(pomoTimeLeft / 60);
        const secs = pomoTimeLeft % 60;
        const timeStr = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
        return `Ticking: ${timeStr} left (${pomoMode === "focus" ? "Focus" : "Break"})`;
      }
      return pomoStats.todaySessions > 0 
        ? `${pomoStats.todayFocusMinutes}m focused today (${pomoStats.todaySessions} slots)` 
        : "Start Pomodoro session";
    }
    if (id === "habits") {
      return habitsCount > 0 
        ? `${habitsCount} habits tracked daily` 
        : "Establish routine logs";
    }
    if (id === "documents") {
      return docsCount > 0 
        ? `${docsCount} files uploaded` 
        : "Upload files to chat";
    }
    if (id === "tasks") {
      return totalTasks > 0
        ? `${doneTasks}/${totalTasks} checklisted tasks completed`
        : "Generate task checklist";
    }
    return "";
  };

  const handleWidgetClick = (id) => {
    setPage(id);
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    if (hour < 22) return "Good Evening";
    return "Good Night";
  };

  return (
    <div className="dashboard-wrapper">
      {/* Dynamic greeting header */}
      <div className="dashboard-hero">
        <h1>{getGreeting()}, {user?.username || "Varnit"} 👋</h1>
        <p>Your intelligent hub for productivity, real-time insights, and seamless automation.</p>
      </div>

      {/* AI Daily Briefing Morning Report Box */}
      <div className="daily-briefing-box glass">
        <div className="briefing-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <h3>✨ Today's AI Daily Briefing</h3>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              className="btn-ghost"
              onClick={async () => {
                const location = await detectLocation();
                if (!location) {
                  alert("Could not detect location automatically. Please enter your location in Settings.");
                  return;
                }

                if (location.city) {
                  try {
                    const settingsRes = await axios.get(`${API}/user/settings`);
                    await axios.post(`${API}/user/settings`, {
                      preferred_model: settingsRes.data?.preferred_model || "llama-3.1-8b-instant",
                      favorite_city: location.city,
                    });
                    alert(`Detected and updated location to ${location.city} (IP-based)! Recompiling daily briefing...`);
                    fetchDashboardBriefing();
                  } catch (err) {
                    alert("Failed to update location automatically. Please update it in Global Settings.");
                  }
                } else if (location.latitude && location.longitude) {
                  try {
                    const geoRes = await axios.get(`${API}/weather/reverse-geocode`, {
                      params: { lat: location.latitude, lon: location.longitude }
                    });
                    if (geoRes.data?.city) {
                      const newCity = geoRes.data.city;
                      const settingsRes = await axios.get(`${API}/user/settings`);
                      await axios.post(`${API}/user/settings`, {
                        preferred_model: settingsRes.data?.preferred_model || "llama-3.1-8b-instant",
                        favorite_city: newCity,
                      });
                      alert(`Detected and updated location to ${newCity}! Recompiling daily briefing...`);
                      fetchDashboardBriefing();
                    }
                  } catch (err) {
                    alert("Failed to update location automatically. Please update it in Global Settings.");
                  }
                }
              }}
              title="Detect and use current location"
              style={{ display: "flex", alignItems: "center", gap: "4px" }}
            >
              📍 Use Current Location
            </button>
            <button className="btn-ghost refresh-briefing-btn" onClick={fetchDashboardBriefing} disabled={briefingLoading}>
              {briefingLoading ? "Compiling..." : "🔄 Refresh"}
            </button>
          </div>
        </div>
        <div className="briefing-content">
          {briefingLoading ? (
            <div className="briefing-loading-spinner-skeleton">
              <div className="skeleton-line title" />
              <div className="skeleton-line" />
              <div className="skeleton-line" />
              <div className="skeleton-line short" />
            </div>
          ) : (
            <pre className="briefing-text">{briefing}</pre>
          )}
        </div>
      </div>

      <p className="page-eyebrow">Overview (Drag to rearrange widgets)</p>

      {/* Draggable stats cards grid */}
      <div className="dash-grid">
        {widgets.map((widget, idx) => (
          <DraggableCard
            key={widget.id}
            icon={widget.icon}
            title={widget.title}
            desc={getWidgetDesc(widget.id)}
            onClick={() => handleWidgetClick(widget.id)}
            onDragStart={(e) => handleDragStart(e, idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, idx)}
          />
        ))}
      </div>
    </div>
  );
};

export default Dashboard;