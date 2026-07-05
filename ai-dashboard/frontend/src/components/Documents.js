import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import "./Documents.css";

import API from "../config";

export default function Documents() {
  const [documents, setDocuments] = useState([]);
  const [activeDoc, setActiveDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  
  // Chatting with document states
  const [chatPrompt, setChatPrompt] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatLoading]);

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/documents`);
      setDocuments(res.data.documents);
      if (res.data.documents.length > 0 && !activeDoc) {
        selectDocument(res.data.documents[0]);
      }
    } catch (err) {
      console.error("Failed to load documents", err);
    } finally {
      setLoading(false);
    }
  };

  const selectDocument = (doc) => {
    setActiveDoc(doc);
    setChatHistory([]); // Clear chat history when switching files
    setChatPrompt("");
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/markdown",
    ];
    const allowedExts = [".pdf", ".docx", ".txt", ".md"];
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();

    if (!allowed.includes(file.type) && !allowedExts.includes(ext)) {
      setError("Only PDF, DOCX, TXT, and Markdown files are supported.");
      return;
    }

    setUploading(true);
    setError("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await axios.post(`${API}/documents/upload`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      loadDocuments();
      const newDoc = { id: res.data.id, filename: res.data.filename };
      selectDocument(newDoc);
    } catch (err) {
      setError(err.response?.data?.detail || "Upload and text extraction failed.");
    } finally {
      setUploading(false);
      e.target.value = ""; // Clear file selector
    }
  };

  const deleteDocument = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this document?")) return;

    try {
      await axios.delete(`${API}/documents/${id}`);
      if (activeDoc && activeDoc.id === id) {
        setActiveDoc(null);
        setChatHistory([]);
      }
      loadDocuments();
    } catch (err) {
      console.error("Failed to delete document", err);
    }
  };

  const sendDocMessage = async (e) => {
    if (e) e.preventDefault();
    if (!chatPrompt.trim() || !activeDoc || chatLoading) return;

    const query = chatPrompt.trim();
    setChatPrompt("");
    setChatHistory((prev) => [...prev, { role: "user", text: query }]);
    setChatLoading(true);

    try {
      const res = await axios.post(`${API}/documents/${activeDoc.id}/chat`, {
        prompt: query,
      });
      setChatHistory((prev) => [...prev, { role: "ai", text: res.data.response }]);
    } catch (err) {
      setChatHistory((prev) => [
        ...prev,
        { role: "ai", text: "Error communicating with AI. Try again." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const docIcon = (name) => {
    if (name.endsWith(".pdf")) return "📚";
    if (name.endsWith(".docx")) return "💾";
    if (name.endsWith(".md")) return "📝";
    return "📄";
  };

  return (
    <div className="docs-page-wrapper">
      {/* LEFT: FILES LIST */}
      <div className="docs-list-panel">
        <div className="docs-list-header">
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            onChange={handleUpload}
            accept=".pdf,.docx,.txt,.md"
          />
          <button
            className="btn-primary upload-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "Extracting Text..." : "📤 Upload PDF / DOCX / Text"}
          </button>
          {error && <div className="docs-error-alert">{error}</div>}
        </div>

        <div className="docs-list">
          {loading && documents.length === 0 ? (
            <div className="docs-loading">Loading knowledge base...</div>
          ) : documents.length === 0 ? (
            <div className="docs-empty-state">No documents uploaded yet.</div>
          ) : (
            documents.map((d) => (
              <div
                key={d.id}
                className={`doc-list-item ${activeDoc?.id === d.id ? "active" : ""}`}
                onClick={() => selectDocument(d)}
              >
                <span className="doc-icon">{docIcon(d.filename)}</span>
                <div className="doc-meta">
                  <p className="doc-name">{d.filename}</p>
                  <span className="doc-date">
                    {new Date(d.created_at || Date.now()).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                <button className="doc-delete-btn" onClick={(e) => deleteDocument(d.id, e)}>
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* RIGHT: CHAT PANE */}
      <div className="doc-chat-panel glass">
        {activeDoc ? (
          <>
            <div className="doc-chat-header">
              <h3>
                💬 Chat: <span className="doc-title-highlight">{activeDoc.filename}</span>
              </h3>
              <p className="doc-chat-description">
                Ask summaries, generate quizzes, or extract insights from this file context.
              </p>
            </div>

            <div className="doc-chat-thread">
              {chatHistory.length === 0 && (
                <div className="doc-chat-empty">
                  🤖 Chatbot is ready. Ask me anything about this document!
                  <div className="suggested-prompts">
                    <button
                      className="btn-ghost prompt-chip"
                      onClick={() => {
                        setChatPrompt("Summarize this document in 3 paragraphs.");
                      }}
                    >
                      Summarize this document
                    </button>
                    <button
                      className="btn-ghost prompt-chip"
                      onClick={() => {
                        setChatPrompt("Generate 3 multiple choice questions with answers based on this file.");
                      }}
                    >
                      Generate quiz questions
                    </button>
                    <button
                      className="btn-ghost prompt-chip"
                      onClick={() => {
                        setChatPrompt("What are the key takeaway points from this text?");
                      }}
                    >
                      Extract key takeaways
                    </button>
                  </div>
                </div>
              )}

              {chatHistory.map((msg, idx) => (
                <div key={idx} className={`chat-bubble-row ${msg.role}`}>
                  <div className={`chat-bubble ${msg.role}`}>
                    <span className="chat-bubble-label">
                      {msg.role === "user" ? "You" : "AI"}
                    </span>
                    <p className="chat-bubble-text">{msg.text}</p>
                  </div>
                </div>
              ))}

              {chatLoading && (
                <div className="chat-bubble-row ai">
                  <div className="chat-bubble ai chat-typing">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form className="doc-chat-dock glass" onSubmit={sendDocMessage}>
              <input
                className="text-input doc-chat-input"
                placeholder="Ask document questions... (e.g. Explain Chapter 2)"
                value={chatPrompt}
                onChange={(e) => setChatPrompt(e.target.value)}
                disabled={chatLoading}
              />
              <button
                type="submit"
                className="btn-primary doc-chat-send"
                disabled={chatLoading || !chatPrompt.trim()}
              >
                Send
              </button>
            </form>
          </>
        ) : (
          <div className="doc-chat-unselected">
            <div className="unselected-icon">📁</div>
            <h3>No Document Selected</h3>
            <p>Upload a PDF, DOCX, or text file, or select an existing one to begin analyzing.</p>
          </div>
        )}
      </div>
    </div>
  );
}
