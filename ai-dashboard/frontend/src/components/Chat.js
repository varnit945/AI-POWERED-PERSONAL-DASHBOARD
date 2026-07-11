import React, { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";
import "./Chat.css";

const API = "http://127.0.0.1:8000";
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

const VOICES_PREF_KEY = "va_voice_name";
const CONFIDENCE_THRESHOLD = 0.65; // below this, ask the user to confirm/retry instead of auto-sending

export default function Chat({ messages, setMessages }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState("");
  const [attachedFile, setAttachedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);

  // ── Voice states & refs ───────────────────────────────────────────
  const [voiceStatus, setVoiceStatus] = useState("idle"); // idle | listening | thinking | speaking | confirming
  const [transcript, setTranscript] = useState("");
  const [confidence, setConfidence] = useState(null);
  const [pendingText, setPendingText] = useState("");
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(
    () => localStorage.getItem(VOICES_PREF_KEY) || ""
  );
  const [autoSpeak, setAutoSpeak] = useState(() => {
    const saved = localStorage.getItem("va_auto_speak");
    return saved !== null ? saved === "true" : true;
  });

  const recognitionRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    loadSessions();
  }, []);

  // ── Load available TTS voices ──────────────────────────────────────
  useEffect(() => {
    const synth = synthRef.current;
    if (!synth) return;
    const loadVoices = () => {
      const v = synth.getVoices();
      if (v.length) setVoices(v);
    };
    loadVoices();
    synth.addEventListener("voiceschanged", loadVoices);
    return () => synth.removeEventListener("voiceschanged", loadVoices);
  }, []);

  // Save autoSpeak preference when changed
  useEffect(() => {
    localStorage.setItem("va_auto_speak", autoSpeak);
  }, [autoSpeak]);

  // Clean up synthesis and recognition on unmount
  useEffect(() => {
    const synth = synthRef.current;
    return () => {
      if (synth) {
        synth.cancel();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (recognitionRef.current) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        recognitionRef.current.abort();
      }
    };
  }, []);

  const loadSessions = async () => {
    try {
      const res = await axios.get(`${API}/sessions`);
      setSessions(res.data.sessions);
    } catch (err) {
      console.error("Failed to load sessions", err);
    }
  };

  const searchHistory = async (q) => {
    setSearchQuery(q);
    if (!q.trim()) {
      loadSessions();
      return;
    }
    try {
      const res = await axios.get(`${API}/sessions/search`, { params: { q } });
      setSessions(res.data.sessions);
    } catch (err) {
      console.error("Search failed", err);
    }
  };

  const openSession = async (id) => {
    try {
      const res = await axios.get(`${API}/sessions/${id}/messages`);
      const loaded = res.data.messages.map((m) => ({ role: m.role, text: m.content }));
      setMessages(loaded);
      setSessionId(id);
      setEditingIndex(null);
    } catch (err) {
      console.error("Failed to load session", err);
    }
  };

  const newChat = () => {
    setMessages([]);
    setSessionId(null);
    setEditingIndex(null);
  };

  const deleteSession = async (id, e) => {
    e.stopPropagation();
    try {
      await axios.delete(`${API}/sessions/${id}`);
    } catch (err) {
      console.error("Failed to delete session", err);
    }
    if (id === sessionId) newChat();
    loadSessions();
  };

  // ── Speak text via TTS ─────────────────────────────────────────────
  const speak = useCallback(
    (text) => {
      if (!synthRef.current) return;
      synthRef.current.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.05;
      utter.pitch = 1;
      const voice = voices.find((v) => v.name === selectedVoice);
      if (voice) utter.voice = voice;
      utter.onstart = () => setVoiceStatus("speaking");
      utter.onend = () => setVoiceStatus("idle");
      utter.onerror = () => setVoiceStatus("idle");
      synthRef.current.speak(utter);
    },
    [voices, selectedVoice]
  );

  // ── Stop speaking ──────────────────────────────────────────────────
  const stopSpeaking = () => {
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    setVoiceStatus("idle");
  };

  // ── Send recognized voice text to AI ──────────────────────────────
  const sendVoiceText = useCallback(
    async (text) => {
      if (loading) return;
      setVoiceStatus("thinking");
      setPendingText("");
      setConfidence(null);
      setMessages((prev) => [...prev, { role: "user", text }]);
      setLoading(true);
      try {
        const res = await axios.post(`${API}/chat`, { prompt: text, session_id: sessionId });
        const aiResponse = res.data.response;
        setMessages((prev) => [...prev, { role: "ai", text: aiResponse }]);
        if (!sessionId) {
          setSessionId(res.data.session_id);
          loadSessions();
        }
        if (autoSpeak) speak(aiResponse);
        else setVoiceStatus("idle");
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: "Something went wrong reaching the AI. Try again." },
        ]);
        setVoiceStatus("idle");
      } finally {
        setLoading(false);
      }
    },
    [sessionId, autoSpeak, speak, loading, setMessages]
  );

  // ── Start listening ────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    if (!SpeechRecognition) {
      alert("Your browser does not support speech recognition. Please use Chrome or Edge.");
      return;
    }

    // Request microphone permission explicitly
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop the stream immediately — we just needed to trigger the permission prompt
      stream.getTracks().forEach((t) => t.stop());
    } catch (permErr) {
      console.error("Microphone permission denied", permErr);
      return;
    }

    setTranscript("");
    setPendingText("");
    setConfidence(null);
    if (synthRef.current) {
      synthRef.current.cancel();
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognitionRef.current = recognition;

    recognition.onstart = () => setVoiceStatus("listening");

    recognition.onresult = (e) => {
      let interim = "";
      let final = "";
      let finalConfidence = null;

      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          final += e.results[i][0].transcript;
          finalConfidence = e.results[i][0].confidence;
        } else {
          interim += e.results[i][0].transcript;
        }
      }

      setTranscript(final || interim);

      if (final) {
        recognition.stop();
        const trimmed = final.trim();
        const hasReliableScore = typeof finalConfidence === "number" && finalConfidence > 0;
        setConfidence(hasReliableScore ? finalConfidence : null);

        if (hasReliableScore && finalConfidence < CONFIDENCE_THRESHOLD) {
          setPendingText(trimmed);
          setVoiceStatus("confirming");
        } else {
          sendVoiceText(trimmed);
        }
      }
    };

    recognition.onerror = (e) => {
      console.error("Speech error", e.error);
      setVoiceStatus("idle");
    };

    recognition.onend = () => {
      setVoiceStatus((prev) => (prev === "listening" ? "idle" : prev));
    };

    recognition.start();
  }, [sendVoiceText]);

  // ── Stop listening ─────────────────────────────────────────────────
  const stopListening = () => {
    recognitionRef.current?.stop();
    setVoiceStatus("idle");
  };

  // ── Confirm / retry / discard low-confidence transcript ────────────
  const confirmPending = () => {
    if (!pendingText) return;
    sendVoiceText(pendingText);
  };

  const retryListening = () => {
    setPendingText("");
    setTranscript("");
    setConfidence(null);
    setVoiceStatus("idle");
    startListening();
  };

  const discardPending = () => {
    setPendingText("");
    setTranscript("");
    setConfidence(null);
    setVoiceStatus("idle");
  };

  const send = async () => {
    if ((!input.trim() && !attachedFile) || loading || attachedFile?.loading) return;
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    const typed = input.trim();

    // Build what gets sent to the AI: typed text + readable file content (if any)
    let promptForAI = typed;
    if (attachedFile?.readable && attachedFile.content) {
      promptForAI = `${typed ? typed + "\n\n" : ""}Attached file "${attachedFile.name}":\n\n${attachedFile.content}`;
    } else if (attachedFile && !attachedFile.readable) {
      promptForAI = `${typed ? typed + "\n\n" : ""}[User attached a file named "${attachedFile.name}" that could not be read as text — ask them to describe its contents if needed.]`;
    }

    // Build what shows in the chat bubble
    const displayText = attachedFile
      ? `${typed}${typed ? "\n\n" : ""}📎 ${attachedFile.name}`
      : typed;

    setInput("");
    setAttachedFile(null);
    setMessages((prev) => [...prev, { role: "user", text: displayText }]);
    setLoading(true);

    try {
      const res = await axios.post(`${API}/chat`, { prompt: promptForAI, session_id: sessionId });
      const aiResponse = res.data.response;
      setMessages((prev) => [...prev, { role: "ai", text: aiResponse }]);
      if (!sessionId) {
        setSessionId(res.data.session_id);
        loadSessions();
      }
      if (autoSpeak) {
        speak(aiResponse);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "ai", text: "Something went wrong reaching the AI. Try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const regenerate = async () => {
    if (!sessionId || loading) return;
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    setLoading(true);
    setMessages((prev) => prev.slice(0, -1)); // remove last AI bubble while regenerating

    try {
      const res = await axios.post(`${API}/chat/regenerate`, { session_id: sessionId });
      const aiResponse = res.data.response;
      setMessages((prev) => [...prev, { role: "ai", text: aiResponse }]);
      if (autoSpeak) {
        speak(aiResponse);
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: "ai", text: "Couldn't regenerate. Try again." }]);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (index, currentText) => {
    setEditingIndex(index);
    setEditText(currentText);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditText("");
  };

  const submitEdit = async () => {
    if (!editText.trim() || !sessionId || loading) return;
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    setLoading(true);

    const trimmedIndex = editingIndex;
    setMessages((prev) => [
      ...prev.slice(0, trimmedIndex),
      { role: "user", text: editText.trim() },
    ]);
    setEditingIndex(null);

    try {
      const res = await axios.post(`${API}/chat/edit-last`, {
        session_id: sessionId,
        new_prompt: editText.trim(),
      });
      const aiResponse = res.data.response;
      setMessages((prev) => [...prev, { role: "ai", text: aiResponse }]);
      if (autoSpeak) {
        speak(aiResponse);
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: "ai", text: "Couldn't process edit. Try again." }]);
    } finally {
      setLoading(false);
      setEditText("");
    }
  };

  // ── File attachment (click + drag-and-drop) ────────────────────────
  const TEXT_LIKE = /\.(txt|md|csv|json|js|jsx|ts|tsx|py|html|css|log|xml|yaml|yml)$/i;

  const readFile = (file) => {
    return new Promise((resolve) => {
      if (TEXT_LIKE.test(file.name)) {
        const reader = new FileReader();
        reader.onload = () =>
          resolve({ name: file.name, type: file.type, size: file.size, content: reader.result, readable: true });
        reader.onerror = () =>
          resolve({ name: file.name, type: file.type, size: file.size, content: null, readable: false });
        reader.readAsText(file);
      } else {
        resolve({ name: file.name, type: file.type, size: file.size, content: null, readable: false });
      }
    });
  };

  const attachFile = async (file) => {
    if (!file) return;
    setAttachedFile({ name: file.name, loading: true });
    
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const res = await axios.post(`${API}/chat/parse-file`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      
      if (res.data && res.data.readable) {
        setAttachedFile({
          name: file.name,
          content: res.data.content,
          readable: true,
          loading: false,
        });
      } else {
        setAttachedFile({
          name: file.name,
          readable: false,
          loading: false,
          error: res.data.error || "Could not extract text.",
        });
      }
    } catch (err) {
      console.error("Failed to parse attached file on server, falling back to local file reader", err);
      const parsed = await readFile(file);
      if (parsed.readable) {
        setAttachedFile(parsed);
      } else {
        setAttachedFile({
          name: file.name,
          readable: false,
          loading: false,
          error: "Failed to read file.",
        });
      }
    }
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files?.[0];
    attachFile(file);
    e.target.value = ""; // allow re-selecting the same file later
  };

  const removeAttachment = () => setAttachedFile(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    attachFile(file);
  };

  const isLastAiMessage = (i) => i === messages.length - 1 && messages[i].role === "ai";
  const isLastUserMessage = (i) =>
    i === messages.length - 2 &&
    messages[i].role === "user" &&
    messages[messages.length - 1]?.role === "ai";

  const renderMessageText = (m, i) => {
    if (m.role === "ai") {
      try {
        const textTrimmed = m.text.trim();
        if (textTrimmed.startsWith("{") && textTrimmed.includes("ats_score")) {
          const result = JSON.parse(textTrimmed);
          return (
            <div className="chat-ats-results">
              <p className="chat-bubble-text" style={{ marginBottom: "15px", fontWeight: "600", color: "var(--signal)" }}>
                📄 ATS Resume Evaluation Complete:
              </p>
              <div className="resume-results-grid" style={{ gap: "12px", display: "grid", marginTop: "10px" }}>
                {/* ATS SCORE CARD */}
                <div className="result-card score-card glass" style={{ padding: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.02)" }}>
                  <h4 style={{ margin: "0 0 8px 0", fontSize: "14px", color: "var(--text)" }}>ATS Match Score</h4>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span className={`score-number ${result.ats_score > 75 ? "high" : "medium"}`} style={{ fontSize: "28px", fontWeight: "bold", color: result.ats_score > 75 ? "#10b981" : "#f59e0b" }}>
                      {result.ats_score}%
                    </span>
                    <p style={{ margin: 0, fontSize: "12.5px", color: "var(--text-muted)", lineHeight: "1.4" }}>
                      {result.ats_score > 75
                        ? "Excellent keyword alignment! Ready for applications."
                        : "Suggestions found to improve search engine rankings."}
                    </p>
                  </div>
                </div>

                {/* SKILLS IDENTIFIED CARD */}
                <div className="result-card skills-card glass" style={{ padding: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.02)" }}>
                  <h4 style={{ margin: "0 0 8px 0", fontSize: "14px", color: "var(--text)" }}>Skills Extracted</h4>
                  <div className="skills-tag-grid" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {(result.skills_found || []).map((s, idx) => (
                      <span key={idx} className="skill-tag badge" style={{ fontSize: "11px", padding: "3px 6px", background: "rgba(16,185,129,0.1)", color: "#10b981", borderRadius: "4px", border: "1px solid rgba(16,185,129,0.2)" }}>
                        ✓ {s}
                      </span>
                    ))}
                  </div>
                </div>

                {/* RECOMMENDED SKILLS TO ADD */}
                <div className="result-card recommendations-card glass" style={{ padding: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.02)" }}>
                  <h4 style={{ margin: "0 0 8px 0", fontSize: "14px", color: "var(--text)" }}>Recommended Missing Skills</h4>
                  <div className="skills-tag-grid" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {(result.missing_skills || []).map((s, idx) => (
                      <span key={idx} className="skill-tag missing-badge" style={{ fontSize: "11px", padding: "3px 6px", background: "rgba(239,68,68,0.1)", color: "#ef4444", borderRadius: "4px", border: "1px solid rgba(239,68,68,0.2)" }}>
                        + {s}
                      </span>
                    ))}
                  </div>
                </div>

                {/* AI FEEDBACK RECOMMENDATIONS */}
                <div className="result-card feedback-card glass" style={{ padding: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.02)" }}>
                  <h4 style={{ margin: "0 0 8px 0", fontSize: "14px", color: "var(--text)" }}>Optimization Feedback</h4>
                  
                  {result.summary_improvements && (
                    <div className="feedback-item" style={{ marginBottom: "10px" }}>
                      <h5 style={{ margin: "0 0 4px 0", fontSize: "12.5px", color: "var(--accent)" }}>Objective & Summary</h5>
                      <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)", lineHeight: "1.5" }}>{result.summary_improvements}</p>
                    </div>
                  )}
                  
                  {result.projects_feedback && (
                    <div className="feedback-item" style={{ marginBottom: "10px" }}>
                      <h5 style={{ margin: "0 0 4px 0", fontSize: "12.5px", color: "var(--accent)" }}>Projects & Accomplishments</h5>
                      <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)", lineHeight: "1.5" }}>{result.projects_feedback}</p>
                    </div>
                  )}
                  
                  {result.suggestions && result.suggestions.length > 0 && (
                    <div className="feedback-item">
                      <h5 style={{ margin: "0 0 4px 0", fontSize: "12.5px", color: "var(--accent)" }}>ATS Optimization Tips</h5>
                      <ul className="ats-tips-list" style={{ margin: 0, paddingLeft: "15px", fontSize: "12px", color: "var(--text-muted)", lineHeight: "1.5" }}>
                        {(result.suggestions || []).map((s, idx) => (
                          <li key={idx} style={{ marginBottom: "4px" }}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        }
      } catch (e) {
        // Fall back to plain text
      }
    }
    return <p className="chat-bubble-text">{m.text}</p>;
  };


  return (
    <div className="chat-page-wrapper">
      <div className="chat-history-panel">
        <button className="btn-primary new-chat-btn" onClick={newChat}>
          + New Chat
        </button>

        <input
          className="text-input history-search"
          placeholder="Search chats..."
          value={searchQuery}
          onChange={(e) => searchHistory(e.target.value)}
        />

        <div className="history-list">
          {sessions.length === 0 && (
            <div className="history-empty">No chats yet.</div>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`history-item ${s.id === sessionId ? "active" : ""}`}
              onClick={() => openSession(s.id)}
            >
              <span className="history-title">{s.title}</span>
              <button className="history-delete" onClick={(e) => deleteSession(s.id, e)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div
        className="chat-page"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <p className="page-eyebrow">Ask Anything</p>
        <div className="page-header" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>💬 AI Chat</div>
          {(
            <div className="chat-voice-header-controls">
              <select
                className="voice-header-select"
                value={selectedVoice}
                onChange={(e) => {
                  setSelectedVoice(e.target.value);
                  localStorage.setItem(VOICES_PREF_KEY, e.target.value);
                }}
              >
                <option value="">Default Voice</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>

              <button
                className={`voice-header-toggle ${autoSpeak ? "on" : "off"}`}
                onClick={() => setAutoSpeak((p) => !p)}
                title="Speak AI responses automatically"
              >
                🔊 Auto-speak: {autoSpeak ? "ON" : "OFF"}
              </button>
            </div>
          )}
        </div>

        <div className="chat-thread" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="chat-empty">Ask something to get a response, or drag a file in.</div>
          )}

          {isDragging && (
            <div className="chat-dropzone-overlay">
              <div className="chat-dropzone-content">📎 Drop file to attach</div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`chat-bubble-row ${m.role}`}>
              <div className={`chat-bubble ${m.role}`}>
                <p className="chat-bubble-label">{m.role === "user" ? "You" : "AI"}</p>

                {editingIndex === i ? (
                  <div className="edit-box">
                    <textarea
                      className="edit-textarea"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      autoFocus
                    />
                    <div className="edit-actions">
                      <button className="btn-primary" onClick={submitEdit}>
                        Save & Resend
                      </button>
                      <button className="btn-ghost" onClick={cancelEdit}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  renderMessageText(m, i)
                )}

                <div className="bubble-actions">
                  {m.role === "user" && isLastUserMessage(i) && editingIndex !== i && (
                    <button className="bubble-action-btn" onClick={() => startEdit(i, m.text)}>
                      ✏️ Edit
                    </button>
                  )}
                  {m.role === "ai" && isLastAiMessage(i) && (
                    <button
                      className="bubble-action-btn"
                      onClick={regenerate}
                      disabled={loading}
                    >
                      🔄 Regenerate
                    </button>
                  )}
                  {m.role === "ai" && (
                    <button
                      className="bubble-action-btn"
                      onClick={() => speak(m.text)}
                      title="Listen to this response"
                    >
                      🔊 Listen
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="chat-bubble-row ai">
              <div className="chat-bubble ai chat-typing">
                <span></span><span></span><span></span>
              </div>
            </div>
          )}
        </div>

        <div className="chat-dock">
          {/* Low-confidence voice confirmation prompt */}
          {voiceStatus === "confirming" && (
            <div className="chat-voice-confirm glass">
              <span className="voice-confirm-label">
                Not sure I caught that right {confidence !== null ? `(${Math.round(confidence * 100)}% confident)` : ""}:
              </span>
              <p className="voice-confirm-text">"{pendingText}"</p>
              <div className="voice-confirm-actions">
                <button className="btn-primary" onClick={confirmPending}>
                  Send anyway
                </button>
                <button className="btn-ghost" onClick={retryListening}>
                  🔄 Try again
                </button>
                <button className="btn-ghost voice-discard" onClick={discardPending}>
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* Live hearing transcript */}
          {transcript && voiceStatus === "listening" && (
            <div className="chat-voice-hearing glass">
              <span className="voice-hearing-label">Hearing…</span>
              <p className="voice-hearing-text">{transcript}</p>
            </div>
          )}

          {/* Waveform/Visual animation when listening or speaking */}
          {(voiceStatus === "listening" || voiceStatus === "speaking") && (
            <div className="chat-voice-status-bar">
              <div className={`voice-visualizer ${voiceStatus}`}>
                <span className="voice-visualizer-dot" />
                <span className="voice-visualizer-dot" />
                <span className="voice-visualizer-dot" />
                <span className="voice-visualizer-dot" />
                <span className="voice-visualizer-dot" />
              </div>
              <span className="voice-status-text">
                {voiceStatus === "listening" && "Listening to you..."}
                {voiceStatus === "speaking" && "Speaking response..."}
              </span>
            </div>
          )}

          {attachedFile && (
            <div className="attachment-chip">
              <span className="attachment-icon">
                {attachedFile.loading ? "⏳" : attachedFile.readable ? "📄" : "📎"}
              </span>
              <span className="attachment-name">
                {attachedFile.name} {attachedFile.loading && " (Analyzing...)"}
              </span>
              {!attachedFile.loading && !attachedFile.readable && (
                <span className="attachment-warning" title="This file type can't be read as text yet">
                  (preview only)
                </span>
              )}
              <button className="attachment-remove" onClick={removeAttachment} disabled={attachedFile.loading}>
                ✕
              </button>
            </div>
          )}

          <div className="chat-input-row glass">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden-file-input"
              onChange={handleFileInputChange}
            />
            <button
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Attach a file"
              type="button"
            >
              +
            </button>
            <input
              className="text-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={voiceStatus === "listening" ? "Listening..." : "Message AI... or drag a file in"}
              onKeyDown={(e) => e.key === "Enter" && send()}
              disabled={voiceStatus === "listening"}
            />
            {(
              <button
                className={`chat-mic-btn ${voiceStatus}`}
                onClick={
                  voiceStatus === "listening"
                    ? stopListening
                    : voiceStatus === "speaking"
                    ? stopSpeaking
                    : voiceStatus === "confirming" || voiceStatus === "thinking"
                    ? undefined
                    : startListening
                }
                disabled={voiceStatus === "thinking" || voiceStatus === "confirming"}
                title={
                  voiceStatus === "listening"
                    ? "Stop listening"
                    : voiceStatus === "speaking"
                    ? "Stop speaking"
                    : "Start listening with voice"
                }
                type="button"
              >
                {voiceStatus === "listening" ? "⏹" : voiceStatus === "speaking" ? "🔇" : "🎙️"}
              </button>
            )}
            <button className="btn-primary" onClick={send} disabled={loading || voiceStatus === "listening"}>
              {loading ? "…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}