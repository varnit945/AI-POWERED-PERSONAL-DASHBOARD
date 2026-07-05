import React, { useState } from "react";
import axios from "axios";
import "./CodeAssistant.css";

import API from "../config";

const LANGUAGES = ["Python", "JavaScript", "React", "Java", "C++", "SQL"];

export default function CodeAssistant() {
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("Python");
  const [action, setAction] = useState("explain");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");

  const handleApply = async () => {
    if (!code.trim() || loading) return;
    setLoading(true);
    setError("");
    setOutput("");

    try {
      const res = await axios.post(`${API}/code/assist`, {
        code,
        language,
        action,
      });
      setOutput(res.data.result);
    } catch (err) {
      setError(err.response?.data?.detail || "AI code assistant failed.");
    } finally {
      setLoading(false);
    }
  };

  const getActionHeading = () => {
    if (action === "explain") return "Code Explanation";
    if (action === "debug") return "Debug Output & Fixes";
    if (action === "optimize") return "Optimized Code";
    if (action === "test") return "Unit Tests";
    if (action === "doc") return "Documented Code";
    return "Output";
  };

  return (
    <div className="code-page-wrapper">
      <p className="page-eyebrow">Developer Toolkit</p>
      <div className="page-header">💻 AI Code Assistant</div>

      <div className="code-editor-grid">
        {/* INPUT PANEL */}
        <div className="code-panel glass">
          <div className="code-panel-header">
            <h3>Input Editor</h3>
            <div className="code-panel-controls">
              <select
                className="notes-select"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>

              <select
                className="notes-select"
                value={action}
                onChange={(e) => setAction(e.target.value)}
              >
                <option value="explain">📝 Explain Code</option>
                <option value="debug">🐛 Debug & Fix</option>
                <option value="optimize">⚡ Optimize Code</option>
                <option value="test">🧪 Generate Tests</option>
                <option value="doc">📚 Generate Documentation</option>
              </select>
            </div>
          </div>

          <textarea
            className="code-textarea text-input"
            placeholder={`// Paste your ${language} code here...`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />

          <button
            className="btn-primary apply-code-btn"
            onClick={handleApply}
            disabled={loading || !code.trim()}
          >
            {loading ? "Processing..." : "Apply Assistant"}
          </button>
        </div>

        {/* OUTPUT PANEL */}
        <div className="code-panel glass">
          <div className="code-panel-header">
            <h3>{getActionHeading()}</h3>
            {output && (
              <button
                className="btn-ghost copy-code-btn"
                onClick={() => {
                  navigator.clipboard.writeText(output);
                  alert("Copied to clipboard!");
                }}
              >
                📋 Copy
              </button>
            )}
          </div>

          <div className="code-output-container">
            {error && <div className="code-error-alert">{error}</div>}

            {loading ? (
              <div className="code-loading-box">
                <div className="spinner" />
                <p>Analyzing code semantics, compiling reviews, and generating outputs...</p>
              </div>
            ) : output ? (
              <pre className="code-output-pre">{output}</pre>
            ) : (
              <div className="code-output-empty">
                Output results will appear here. Paste code and click Apply.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
