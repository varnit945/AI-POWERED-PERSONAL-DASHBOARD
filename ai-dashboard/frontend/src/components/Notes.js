import React, { useState, useEffect } from "react";
import axios from "axios";
import "./Notes.css";

import API from "../config";

const CATEGORIES = ["General", "Work", "Study", "Personal", "Meeting"];

export default function Notes() {
  const [notes, setNotes] = useState([]);
  const [activeNote, setActiveNote] = useState(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("General");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  // AI Modal/Result State
  const [aiAction, setAiAction] = useState("summarize");
  const [aiLang, setAiLang] = useState("Spanish");
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);

  useEffect(() => {
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadNotes = async () => {
    try {
      const res = await axios.get(`${API}/notes`);
      setNotes(res.data.notes);
      if (res.data.notes.length > 0 && !activeNote) {
        selectNote(res.data.notes[0]);
      }
    } catch (err) {
      console.error("Failed to load notes", err);
    }
  };

  const selectNote = (note) => {
    setActiveNote(note);
    setTitle(note.title);
    setContent(note.content);
    setCategory(note.category);
  };

  const startNewNote = () => {
    setActiveNote(null);
    setTitle("");
    setContent("");
    setCategory("General");
  };

  const saveNote = async () => {
    let noteTitle = title.trim();
    if (!noteTitle) {
      noteTitle = "Untitled Note";
    }

    try {
      if (activeNote) {
        // Update
        await axios.put(`${API}/notes/${activeNote.id}`, {
          title: noteTitle,
          content,
          category,
        });
      } else {
        // Create
        const res = await axios.post(`${API}/notes`, {
          title: noteTitle,
          content,
          category,
        });
        // Select new note
        selectNote({ id: res.data.id, title: noteTitle, content, category });
      }
      loadNotes();
    } catch (err) {
      console.error("Failed to save note", err);
    }
  };

  const deleteNote = async (id, e) => {
    if (e) e.stopPropagation();
    try {
      await axios.delete(`${API}/notes/${id}`);
      if (activeNote && activeNote.id === id) {
        startNewNote();
      }
      loadNotes();
    } catch (err) {
      console.error("Failed to delete note", err);
    }
  };

  const runAiAction = async () => {
    if (!activeNote || aiLoading) return;
    setAiLoading(true);
    setAiResult("");
    setShowAiModal(true);

    try {
      const res = await axios.post(`${API}/notes/${activeNote.id}/ai`, {
        action: aiAction,
        language: aiAction === "translate" ? aiLang : undefined,
        title,
        content,
      });
      setAiResult(res.data.result);
    } catch (err) {
      setAiResult("Failed to execute AI transformation. Try again.");
    } finally {
      setAiLoading(false);
    }
  };

  const filteredNotes = notes.filter((n) => {
    const matchesSearch =
      n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat = selectedCategory === "All" || n.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="notes-page-wrapper">
      {/* LEFT SIDEBAR: NOTES LIST */}
      <div className="notes-list-panel">
        <div className="notes-list-header">
          <button className="btn-primary new-note-btn" onClick={startNewNote}>
            + New Note
          </button>
          <input
            className="text-input notes-search"
            placeholder="Search notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="category-filter">
            <select
              className="notes-select"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="All">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="notes-list">
          {filteredNotes.length === 0 ? (
            <div className="notes-empty">No notes found.</div>
          ) : (
            filteredNotes.map((n) => (
              <div
                key={n.id}
                className={`note-list-item ${activeNote?.id === n.id ? "active" : ""}`}
                onClick={() => selectNote(n)}
              >
                <div className="note-item-meta">
                  <span className="note-item-category badge">{n.category}</span>
                  <button className="note-delete-btn" onClick={(e) => deleteNote(n.id, e)}>
                    ✕
                  </button>
                </div>
                <h4 className="note-item-title">{n.title || "Untitled Note"}</h4>
                <p className="note-item-preview">{n.content.substring(0, 60)}...</p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* RIGHT SIDEBAR: NOTE EDITOR */}
      <div className="note-editor-panel glass">
        <div className="note-editor-header">
          <input
            className="editor-title-input"
            placeholder="Note Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="editor-meta-row">
            <select
              className="notes-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button className="btn-primary save-note-btn" onClick={saveNote}>
              Save Note
            </button>
          </div>
        </div>

        <textarea
          className="editor-content-textarea"
          placeholder="Start typing your note here..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />

        {activeNote && (
          <div className="note-ai-toolbar glass">
            <div className="ai-toolbar-header">💡 Notes AI Copilot</div>
            <div className="ai-toolbar-controls">
              <select
                className="notes-select"
                value={aiAction}
                onChange={(e) => setAiAction(e.target.value)}
              >
                <option value="summarize">📝 Summarize Note</option>
                <option value="action_items">✅ Extract Action Items</option>
                <option value="quiz">❓ Generate Study Quiz</option>
                <option value="keywords">🏷️ Extract Keywords</option>
                <option value="grammar">✍️ Grammar Correction</option>
                <option value="minutes">📅 Convert to Meeting Minutes</option>
                <option value="translate">🌐 Translate Text</option>
              </select>

              {aiAction === "translate" && (
                <input
                  className="text-input lang-input"
                  placeholder="Language (e.g. Hindi, French)"
                  value={aiLang}
                  onChange={(e) => setAiLang(e.target.value)}
                />
              )}

              <button className="btn-primary run-ai-btn" onClick={runAiAction}>
                Apply AI
              </button>
            </div>
          </div>
        )}
      </div>

      {/* AI RESULT MODAL */}
      {showAiModal && (
        <div className="ai-modal-overlay" onClick={() => setShowAiModal(false)}>
          <div className="ai-modal-card glass" onClick={(e) => e.stopPropagation()}>
            <div className="ai-modal-header">
              <h3>✨ AI Copilot Output</h3>
              <button className="close-modal-btn" onClick={() => setShowAiModal(false)}>
                ✕
              </button>
            </div>
            <div className="ai-modal-content">
              {aiLoading ? (
                <div className="ai-modal-loading">
                  <div className="spinner" />
                  <p>Processing note content...</p>
                </div>
              ) : (
                <pre className="ai-result-pre">{aiResult}</pre>
              )}
            </div>
            <div className="ai-modal-footer">
              <button
                className="btn-primary"
                onClick={() => {
                  navigator.clipboard.writeText(aiResult);
                  alert("Copied to clipboard!");
                }}
                disabled={aiLoading}
              >
                📋 Copy Result
              </button>
              <button className="btn-ghost" onClick={() => setShowAiModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
