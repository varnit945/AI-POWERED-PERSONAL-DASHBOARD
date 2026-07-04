import React, { useState, useEffect } from "react";
import axios from "axios";
import "./Pomodoro.css";

const API = "http://127.0.0.1:8000";

export default function Pomodoro({
  mode,
  setMode,
  timeLeft,
  setTimeLeft,
  isRunning,
  setIsRunning,
  customFocus,
  setCustomFocus,
  customBreak,
  setCustomBreak
}) {
  const [stats, setStats] = useState({ todayFocusMinutes: 0, todaySessions: 0, totalFocusHours: 0 });

  useEffect(() => {
    loadStats();
  }, [isRunning]);

  const loadStats = async () => {
    try {
      const res = await axios.get(`${API}/pomodoro/stats`);
      setStats(res.data);
    } catch (err) {
      console.error("Failed to load pomodoro stats", err);
    }
  };

  const toggleTimer = () => {
    setIsRunning(!isRunning);
  };

  const resetTimer = () => {
    setIsRunning(false);
    setTimeLeft((mode === "focus" ? customFocus : customBreak) * 60);
  };

  const applyCustomSettings = () => {
    setIsRunning(false);
    setTimeLeft((mode === "focus" ? customFocus : customBreak) * 60);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const progressPct = timeLeft / ((mode === "focus" ? customFocus : customBreak) * 60);

  return (
    <div className="pomo-page-wrapper">
      <p className="page-eyebrow">Productivity Timer</p>
      <div className="page-header">⏱️ Focus Timer</div>

      <div className="pomo-grid">
        {/* TIMER DISPLAY CARD */}
        <div className="pomo-card timer-card glass">
          <div className="mode-toggle">
            <button
              className={`mode-btn ${mode === "focus" ? "active" : ""}`}
              onClick={() => {
                setMode("focus");
                setIsRunning(false);
                setTimeLeft(customFocus * 60);
              }}
            >
              🎯 Focus Session
            </button>
            <button
              className={`mode-btn ${mode === "break" ? "active" : ""}`}
              onClick={() => {
                setMode("break");
                setIsRunning(false);
                setTimeLeft(customBreak * 60);
              }}
            >
              ☕ Short Break
            </button>
          </div>

          <div className="timer-display-ring">
            <svg className="progress-ring-svg" width="220" height="220">
              <circle
                className="progress-ring-bg"
                stroke="rgba(255,255,255,0.03)"
                strokeWidth="10"
                fill="transparent"
                r="95"
                cx="110"
                cy="110"
              />
              <circle
                className={`progress-ring-fill ${mode}`}
                stroke={mode === "focus" ? "var(--primary-color)" : "#10b981"}
                strokeWidth="10"
                strokeDasharray={`${2 * Math.PI * 95}`}
                strokeDashoffset={`${(1 - progressPct) * (2 * Math.PI * 95)}`}
                strokeLinecap="round"
                fill="transparent"
                r="95"
                cx="110"
                cy="110"
              />
            </svg>
            <div className="timer-text">{formatTime(timeLeft)}</div>
          </div>

          <div className="timer-controls">
            <button className={`btn-primary start-btn ${isRunning ? "running" : ""}`} onClick={toggleTimer}>
              {isRunning ? "Pause" : "Start"}
            </button>
            <button className="btn-ghost" onClick={resetTimer}>
              Reset
            </button>
          </div>
        </div>

        {/* STATS & SETTINGS SIDEBAR */}
        <div className="pomo-sidebar">
          {/* STATS CARD */}
          <div className="pomo-card stats-card glass">
            <h3>Focus Progress</h3>
            <div className="stats-metric-grid">
              <div className="metric-box">
                <span className="metric-title">Today's Focus</span>
                <span className="metric-val">{stats.todayFocusMinutes}m</span>
              </div>
              <div className="metric-box">
                <span className="metric-title">Completed Today</span>
                <span className="metric-val">{stats.todaySessions} slots</span>
              </div>
              <div className="metric-box">
                <span className="metric-title">Total focus time</span>
                <span className="metric-val">{stats.totalFocusHours} hrs</span>
              </div>
            </div>
          </div>

          {/* SETTINGS CARD */}
          <div className="pomo-card settings-card glass">
            <h3>Timer Settings</h3>
            <div className="settings-form">
              <div className="input-group">
                <label>Focus Duration (min)</label>
                <input
                  type="number"
                  className="text-input pomo-input"
                  min="1"
                  max="120"
                  value={customFocus}
                  onChange={(e) => setCustomFocus(parseInt(e.target.value) || 25)}
                />
              </div>
              <div className="input-group">
                <label>Break Duration (min)</label>
                <input
                  type="number"
                  className="text-input pomo-input"
                  min="1"
                  max="60"
                  value={customBreak}
                  onChange={(e) => setCustomBreak(parseInt(e.target.value) || 5)}
                />
              </div>
              <button className="btn-primary apply-settings-btn" onClick={applyCustomSettings}>
                Apply Custom Intervals
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
