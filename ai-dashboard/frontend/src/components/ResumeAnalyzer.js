import React, { useState, useRef } from "react";
import axios from "axios";
import "./ResumeAnalyzer.css";

const API = "http://127.0.0.1:8000";

export default function ResumeAnalyzer() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setError("");
      setResult(null);
    }
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setLoading(true);
    setError("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await axios.post(`${API}/resume/analyze`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Resume parsing failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="resume-page-wrapper">
      <p className="page-eyebrow">Career Coach</p>
      <div className="page-header">📄 Resume ATS Reviewer</div>

      <div className="resume-upload-section glass">
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={handleFileChange}
          accept=".pdf,.docx,.txt"
        />
        <button
          className="btn-primary select-resume-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
        >
          {file ? `📁 Selected: ${file.name}` : "Upload Resume (PDF, DOCX)"}
        </button>

        {file && !loading && (
          <button className="btn-primary analyze-resume-btn" onClick={handleAnalyze}>
            Analyze ATS Match
          </button>
        )}
      </div>

      {error && <div className="resume-error-banner">{error}</div>}

      {loading && (
        <div className="resume-loading glass">
          <div className="spinner" />
          <p>Extracting skills, computing ATS keyword matches, and building recruiter reviews...</p>
        </div>
      )}

      {result && !loading && (
        <div className="resume-results-grid">
          {/* ATS SCORE CARD */}
          <div className="result-card score-card glass">
            <h3>ATS Match Score</h3>
            <div className="score-percentage-ring">
              <span className={`score-number ${result.ats_score > 75 ? "high" : "medium"}`}>
                {result.ats_score}%
              </span>
            </div>
            <p className="score-label">
              {result.ats_score > 75
                ? "Excellent keyword alignment! Ready for applications."
                : "Suggestions found to improve search engine rankings."}
            </p>
          </div>

          {/* SKILLS IDENTIFIED CARD */}
          <div className="result-card skills-card glass">
            <h3>Skills Extracted</h3>
            <div className="skills-tag-grid">
              {(result.skills_found || []).map((s, i) => (
                <span key={i} className="skill-tag badge">
                  ✓ {s}
                </span>
              ))}
            </div>
          </div>

          {/* RECOMMENDED SKILLS TO ADD */}
          <div className="result-card recommendations-card glass">
            <h3>Recommended Missing Skills</h3>
            <div className="skills-tag-grid">
              {(result.missing_skills || []).map((s, i) => (
                <span key={i} className="skill-tag missing-badge">
                  + {s}
                </span>
              ))}
            </div>
          </div>

          {/* AI FEEDBACK RECOMMENDATIONS */}
          <div className="result-card feedback-card glass">
            <h3>Optimization Feedback</h3>
            
            <div className="feedback-item">
              <h4>Objective & Summary</h4>
              <p>{result.summary_improvements}</p>
            </div>
            
            <div className="feedback-item">
              <h4>Projects & Accomplishments</h4>
              <p>{result.projects_feedback}</p>
            </div>
            
            <div className="feedback-item">
              <h4>ATS Optimization Tips</h4>
              <ul className="ats-tips-list">
                {(result.suggestions || []).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
