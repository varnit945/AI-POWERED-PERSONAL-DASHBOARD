import React, { useState, useEffect, useRef } from "react";
import "./CommandPalette.css";

export default function CommandPalette({ isOpen, onClose, setPage, toggleTheme, onLogout }) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);

  const commands = [
    { label: "📊 Go to Dashboard", action: () => setPage("dashboard") },
    { label: "💬 Go to Chat", action: () => setPage("chat") },
    { label: "🎙️ Go to Voice Assistant", action: () => setPage("voice") },
    { label: "📰 Go to News", action: () => setPage("news") },
    { label: "🌤 Go to Weather", action: () => setPage("weather") },
    { label: "📅 Go to Tasks", action: () => setPage("tasks") },
    { label: "⏱️ Go to Focus Timer", action: () => setPage("pomodoro") },
    { label: "🎯 Go to Habits", action: () => setPage("habits") },
    { label: "📝 Go to Notes", action: () => setPage("notes") },
    { label: "📁 Go to Files", action: () => setPage("documents") },
    { label: "📄 Go to ATS Checker", action: () => setPage("resume") },
    { label: "🎙️ Go to Mock Interviews", action: () => setPage("interview") },
    { label: "💻 Go to Code Copilot", action: () => setPage("code") },
    { label: "🔍 Go to Search", action: () => setPage("search") },
    { label: "⚙️ Go to Settings", action: () => setPage("settings") },
    { label: "🌓 Toggle Light/Dark Theme", action: toggleTheme },
    { label: "🚪 Logout Session", action: onLogout }
  ];

  const filtered = commands.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((prev) => (prev + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIdx]) {
          filtered[selectedIdx].action();
          onClose();
        }
      } else if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filtered, selectedIdx, onClose]);

  if (!isOpen) return null;

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette-container glass" onClick={(e) => e.stopPropagation()}>
        <div className="palette-search-row">
          <span className="search-icon">🔍</span>
          <input
            className="palette-input"
            ref={inputRef}
            placeholder="Type a command or navigate page..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIdx(0);
            }}
          />
          <span className="esc-hint">ESC</span>
        </div>

        <ul className="palette-list">
          {filtered.length === 0 ? (
            <li className="palette-empty-state">No commands found.</li>
          ) : (
            filtered.map((cmd, i) => (
              <li
                key={i}
                className={`palette-item ${i === selectedIdx ? "selected" : ""}`}
                onClick={() => {
                  cmd.action();
                  onClose();
                }}
                onMouseEnter={() => setSelectedIdx(i)}
              >
                {cmd.label}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
