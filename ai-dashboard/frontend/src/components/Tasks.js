import React, { useState, useEffect } from "react";
import axios from "axios";
import "./Tasks.css";

const API = "http://127.0.0.1:8000";

export default function Tasks({ taskLists, setTaskLists }) {
  const [goal, setGoal] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    try {
      const res = await axios.get(`${API}/tasks`);
      setTaskLists(res.data.taskLists);
    } catch (err) {
      console.error("Failed to load tasks", err);
    }
  };

  const generate = async () => {
    if (!goal.trim()) return;
    setLoading(true);
    try {
      // 1. Get task list suggestions from AI generator
      const res = await axios.post(`${API}/generate-tasks`, { goal });
      const aiTasks = res.data.tasks;

      // 2. Persist the new list in SQLite backend
      const tasksPayload = aiTasks.map(t => ({ text: t }));
      await axios.post(`${API}/tasks`, {
        goal,
        tasks: tasksPayload
      });

      // 3. Reload list from backend
      loadTasks();
      setGoal("");
    } catch (err) {
      console.error("Failed to generate and save tasks", err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (itemId) => {
    try {
      await axios.post(`${API}/tasks/toggle/${itemId}`);
      loadTasks();
    } catch (err) {
      console.error("Failed to toggle task", err);
    }
  };

  const removeList = async (listId) => {
    try {
      await axios.delete(`${API}/tasks/list/${listId}`);
      loadTasks();
    } catch (err) {
      console.error("Failed to delete task list", err);
    }
  };

  return (
    <div className="tasks-page">
      <p className="page-eyebrow">AI Task Generator</p>
      <div className="page-header">📅 AI Tasks</div>

      <div className="task-input-row">
        <input
          className="text-input"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Enter a productivity goal..."
          onKeyDown={(e) => e.key === "Enter" && generate()}
        />
        <button className="btn-primary" onClick={generate} disabled={loading}>
          {loading ? "Generating…" : "Generate"}
        </button>
      </div>

      {taskLists.length === 0 ? (
        <div className="empty-state">
          Enter a goal above and generate a task breakdown.
        </div>
      ) : (
        <div className="task-lists">
          {taskLists.map((list) => {
            const doneCount = list.tasks.filter((t) => t.done).length;
            const pct = list.tasks.length
              ? Math.round((doneCount / list.tasks.length) * 100)
              : 0;

            return (
              <div className="task-list-card glass" key={list.id}>
                <div className="task-list-header">
                  <div>
                    <p className="task-list-goal">{list.goal}</p>
                    <p className="task-list-progress-label">
                      {doneCount} / {list.tasks.length} done
                    </p>
                  </div>
                  <button
                    className="task-list-remove"
                    onClick={() => removeList(list.id)}
                    aria-label="Remove task list"
                  >
                    ✕
                  </button>
                </div>

                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>

                <ul className="task-list">
                  {list.tasks.map((t) => (
                    <li
                      className={`task-item ${t.done ? "done" : ""}`}
                      key={t.id}
                      onClick={() => handleToggle(t.id)}
                    >
                      <span className={`task-checkbox ${t.done ? "checked" : ""}`}>
                        {t.done ? "✓" : ""}
                      </span>
                      <span className="task-text">{t.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}