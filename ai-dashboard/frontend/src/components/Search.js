import React, { useState, useEffect } from "react";
import axios from "axios";
import "./Search.css";

import API from "../config";

export default function Search({ setPage, setMessages }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState({ notes: [], documents: [], chats: [] });
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounce logic
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 400);

    return () => clearTimeout(timer);
  }, [query]);

  // Fetch results when debounced query changes
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults({ notes: [], documents: [], chats: [] });
      return;
    }
    performSearch(debouncedQuery);
  }, [debouncedQuery]);

  const performSearch = async (searchVal) => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/search`, {
        params: { q: searchVal },
      });
      setResults(res.data);
    } catch (err) {
      console.error("Search failed", err);
    } finally {
      setLoading(false);
    }
  };

  const handleNavigate = (type, id) => {
    if (type === "note") {
      setPage("notes");
    } else if (type === "document") {
      setPage("documents");
    } else if (type === "chat") {
      setPage("chat");
      // Optionally we can open the chat session directly if the session is mapped
    }
  };

  const totalResults = results.notes.length + results.documents.length + results.chats.length;

  return (
    <div className="search-page-wrapper">
      <p className="page-eyebrow">Federated AI Search</p>
      <div className="page-header">🔍 Search Knowledge Base</div>

      <div className="search-bar-row glass">
        <input
          className="text-input search-bar-input"
          placeholder="Search tasks, notes, documents, and chat history..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {loading && <div className="search-spinner" />}
      </div>

      {query.trim() && !loading && totalResults === 0 && (
        <div className="search-empty">
          No matches found for "<strong>{query}</strong>". Try a different keyword.
        </div>
      )}

      {totalResults > 0 && (
        <div className="search-results-grid">
          {/* NOTES RESULTS */}
          {results.notes.length > 0 && (
            <div className="search-section glass">
              <h3 className="section-title">📝 Notes ({results.notes.length})</h3>
              <div className="section-list">
                {results.notes.map((n) => (
                  <div
                    key={n.id}
                    className="search-card"
                    onClick={() => handleNavigate("note", n.id)}
                  >
                    <span className="search-card-badge">{n.category}</span>
                    <h4>{n.title}</h4>
                    <p className="search-card-preview">{n.content.substring(0, 100)}...</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DOCUMENTS RESULTS */}
          {results.documents.length > 0 && (
            <div className="search-section glass">
              <h3 className="section-title">📁 Documents ({results.documents.length})</h3>
              <div className="section-list">
                {results.documents.map((d) => (
                  <div
                    key={d.id}
                    className="search-card"
                    onClick={() => handleNavigate("document", d.id)}
                  >
                    <span className="search-card-badge type-badge">{d.content_type}</span>
                    <h4>{d.filename}</h4>
                    <p className="search-card-desc">Click to review or ask the AI questions.</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CHATS RESULTS */}
          {results.chats.length > 0 && (
            <div className="search-section glass">
              <h3 className="section-title">💬 Chat History ({results.chats.length})</h3>
              <div className="section-list">
                {results.chats.map((c) => (
                  <div
                    key={c.id}
                    className="search-card"
                    onClick={() => handleNavigate("chat", c.id)}
                  >
                    <h4>{c.title}</h4>
                    <p className="search-card-desc">
                      Session created on {new Date(c.created_at).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
