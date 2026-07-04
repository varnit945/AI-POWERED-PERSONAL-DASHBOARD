import React, { useState, useEffect } from "react";
import axios from "axios";
import "./HabitTracker.css";

const API = "http://127.0.0.1:8000";

const DEFAULT_HABITS = ["Study", "Exercise", "Meditation", "Reading", "Water", "Sleep", "Coding"];

export default function HabitTracker() {
  const [habits, setHabits] = useState([]);
  const [newHabitName, setNewHabitName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadHabits();
  }, []);

  const loadHabits = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/habits`);
      setHabits(res.data.habits);
    } catch (err) {
      console.error("Failed to load habits", err);
    } finally {
      setLoading(false);
    }
  };

  const createHabit = async (name) => {
    const habitName = name.trim();
    if (!habitName) return;
    setError("");

    try {
      await axios.post(`${API}/habits`, { name: habitName });
      setNewHabitName("");
      loadHabits();
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to create habit.");
    }
  };

  const deleteHabit = async (id) => {
    if (!window.confirm("Delete this habit and all check-in history?")) return;
    try {
      await axios.delete(`${API}/habits/${id}`);
      loadHabits();
    } catch (err) {
      console.error("Failed to delete habit", err);
    }
  };

  const toggleDay = async (habitId, dateStr) => {
    try {
      await axios.post(`${API}/habits/${habitId}/toggle`, { date: dateStr });
      loadHabits();
    } catch (err) {
      console.error("Failed to toggle habit log", err);
    }
  };

  // Helper: Get list of past 7 dates starting from today
  const getPastSevenDays = () => {
    const dates = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d);
    }
    return dates;
  };

  const formatDateStr = (dateObj) => {
    return dateObj.toISOString().split("T")[0]; // YYYY-MM-DD
  };

  // Streak calculations
  const calculateStreak = (completedDates) => {
    if (completedDates.length === 0) return 0;
    const completedSet = new Set(completedDates);
    
    let streak = 0;
    let checkDate = new Date();
    
    // Check going backward from today
    while (true) {
      const dateStr = checkDate.toISOString().split("T")[0];
      if (completedSet.has(dateStr)) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        // If today is NOT completed, check if yesterday was. If yesterday was, streak continues.
        // If neither is completed, streak is 0.
        if (streak === 0) {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().split("T")[0];
          if (completedSet.has(yesterdayStr)) {
            checkDate.setDate(checkDate.getDate() - 1);
            continue;
          }
        }
        break;
      }
    }
    return streak;
  };

  const datesList = getPastSevenDays();

  return (
    <div className="habits-page-wrapper">
      <p className="page-eyebrow">Routine Streaks</p>
      <div className="page-header">🎯 Habit Tracker</div>

      <div className="habits-input-row glass">
        <input
          className="text-input habit-add-input"
          placeholder="Create custom habit (e.g. Meditate, Drink Water)..."
          value={newHabitName}
          onChange={(e) => setNewHabitName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createHabit(newHabitName)}
        />
        <button className="btn-primary" onClick={() => createHabit(newHabitName)}>
          Add Habit
        </button>
      </div>

      {error && <div className="habits-error-banner">{error}</div>}

      {/* Suggested Default Habits */}
      {habits.length === 0 && !loading && (
        <div className="suggested-defaults glass">
          <h4>💡 Or start with these popular routines:</h4>
          <div className="defaults-grid">
            {DEFAULT_HABITS.map((h) => (
              <button key={h} className="btn-ghost default-habit-chip" onClick={() => createHabit(h)}>
                + {h}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && habits.length === 0 ? (
        <div className="habits-loading">Loading habits dashboard...</div>
      ) : habits.length === 0 ? (
        <div className="habits-empty-hint">Create your first habit tracker above to build routines.</div>
      ) : (
        <div className="habits-list">
          {habits.map((h) => {
            const currentStreak = calculateStreak(h.completedDates);
            const totalCompletions = h.completedDates.length;
            const isCompletedToday = h.completedDates.includes(formatDateStr(new Date()));

            return (
              <div key={h.id} className="habit-card glass">
                <div className="habit-card-header">
                  <div>
                    <h3 className="habit-name">{h.name}</h3>
                    <p className="habit-stats-label">
                      🔥 {currentStreak} day streak · {totalCompletions} total check-ins
                    </p>
                  </div>
                  <button className="habit-card-delete" onClick={() => deleteHabit(h.id)}>
                    ✕ Delete
                  </button>
                </div>

                <div className="habit-week-grid">
                  {datesList.map((date) => {
                    const dateStr = formatDateStr(date);
                    const isDone = h.completedDates.includes(dateStr);
                    const isToday = dateStr === formatDateStr(new Date());

                    return (
                      <div
                        key={dateStr}
                        className={`habit-day-col ${isDone ? "done" : ""} ${isToday ? "today" : ""}`}
                        onClick={() => toggleDay(h.id, dateStr)}
                      >
                        <span className="day-name">
                          {date.toLocaleDateString("en-US", { weekday: "short" })}
                        </span>
                        <div className="day-checkbox-ring">
                          {isDone ? "✓" : ""}
                        </div>
                        <span className="day-number">{date.getDate()}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
