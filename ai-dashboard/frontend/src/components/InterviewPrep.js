import React, { useState } from "react";
import axios from "axios";
import "./InterviewPrep.css";

const API = "http://127.0.0.1:8000";

const CATEGORIES = ["Frontend", "Backend", "Python", "Java", "React", "AI", "HR"];
const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"];

export default function InterviewPrep() {
  const [category, setCategory] = useState("Backend");
  const [difficulty, setDifficulty] = useState("Intermediate");
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [activeIdx, setActiveIdx] = useState(-1); // -1 means setup screen
  const [customCategory, setCustomCategory] = useState("");
  
  // Answering states
  const [userAnswer, setUserAnswer] = useState("");
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState(null);
  
  const startSimulation = async () => {
    const finalCategory = category === "Other / Custom Topic..." ? customCategory.trim() : category;
    if (!finalCategory) {
      alert("Please enter a custom category/topic.");
      return;
    }
    setLoading(true);
    setQuestions([]);
    setActiveIdx(-1);
    setEvaluation(null);
    setUserAnswer("");

    try {
      const res = await axios.post(`${API}/interview/questions`, {
        category: finalCategory,
        difficulty,
      });
      setQuestions(res.data.questions);
      setActiveIdx(0);
    } catch (err) {
      console.error("Failed to generate questions", err);
    } finally {
      setLoading(false);
    }
  };

  const submitAnswer = async () => {
    if (!userAnswer.trim() || evaluating) return;
    setEvaluating(true);
    setEvaluation(null);

    const questionText = questions[activeIdx].question;
    const finalCategory = category === "Other / Custom Topic..." ? customCategory.trim() : category;

    try {
      const res = await axios.post(`${API}/interview/submit`, {
        category: finalCategory,
        question: questionText,
        answer: userAnswer.trim(),
      });
      setEvaluation(res.data);
    } catch (err) {
      console.error("Evaluation failed", err);
    } finally {
      setEvaluating(false);
    }
  };

  const nextQuestion = () => {
    setUserAnswer("");
    setEvaluation(null);
    setActiveIdx(activeIdx + 1);
  };

  const restartSimulation = () => {
    setQuestions([]);
    setActiveIdx(-1);
    setEvaluation(null);
    setUserAnswer("");
  };

  return (
    <div className="interview-page-wrapper">
      <p className="page-eyebrow">Career Coach</p>
      <div className="page-header">🎙️ AI Interview Simulator</div>

      {/* SETUP SCREEN */}
      {activeIdx === -1 && (
        <div className="setup-card glass">
          <h3>Simulation Setup</h3>
          <p className="setup-hint">
            Prepare for technical and behavioral interviews. Select your focus area and difficulty, and the AI will generate target simulator questions.
          </p>

          <div className="setup-controls">
            <div className="setup-group">
              <label>Interview Category</label>
              <select
                className="notes-select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
                <option value="Other / Custom Topic...">Other / Custom Topic...</option>
              </select>
            </div>

            {category === "Other / Custom Topic..." && (
              <div className="setup-group" style={{ width: "100%" }}>
                <label>Enter Custom Category / Topic</label>
                <input
                  type="text"
                  className="text-input"
                  placeholder="e.g., Cybersecurity, Data Science, Product Manager..."
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  style={{ width: "100%", height: "46px" }}
                />
              </div>
            )}

            <div className="setup-group">
              <label>Difficulty Level</label>
              <select
                className="notes-select"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button className="btn-primary start-interview-btn" onClick={startSimulation} disabled={loading}>
            {loading ? "Generating Questions..." : "Start Interview Simulator"}
          </button>
        </div>
      )}

      {/* ACTIVE INTERVIEW PROCESS */}
      {activeIdx >= 0 && activeIdx < questions.length && (
        <div className="simulation-card glass">
          <div className="simulation-header">
            <span className="question-progress">
              Question {activeIdx + 1} of {questions.length}
            </span>
            <span className="question-type-badge badge">
              {questions[activeIdx].type.toUpperCase()}
            </span>
          </div>

          <div className="question-text">
            <h2>{questions[activeIdx].question}</h2>
          </div>

          {!evaluation ? (
            <div className="answer-section">
              <textarea
                className="answer-textarea text-input"
                placeholder="Type your response here... Be detailed and specific."
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                disabled={evaluating}
              />
              <button
                className="btn-primary submit-answer-btn"
                onClick={submitAnswer}
                disabled={evaluating || !userAnswer.trim()}
              >
                {evaluating ? "Evaluating..." : "Evaluate Answer"}
              </button>
            </div>
          ) : (
            <div className="evaluation-feedback-section">
              {/* SCORE CHIP */}
              <div className="eval-score-row">
                <span className="eval-score-label">AI Score:</span>
                <span className={`eval-score-num ${evaluation.score > 75 ? "high" : "medium"}`}>
                  {evaluation.score}/100
                </span>
              </div>

              {/* REVIEWS & RECOMMENDATIONS */}
              <div className="eval-feedback-box">
                <h4>Recruiter Feedback</h4>
                <p>{evaluation.feedback}</p>
              </div>

              {evaluation.missing_concepts.length > 0 && (
                <div className="eval-missing-box">
                  <h4>Key Concepts You Missed</h4>
                  <div className="missing-concepts-grid">
                    {evaluation.missing_concepts.map((c, i) => (
                      <span key={i} className="missing-concept-tag">
                        ⚠ {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="eval-ideal-box">
                <h4>Ideal Reference Answer</h4>
                <p>{evaluation.ideal_answer}</p>
              </div>

              <div className="eval-actions-row">
                <button className="btn-primary" onClick={nextQuestion}>
                  {activeIdx === questions.length - 1 ? "Complete Interview" : "Next Question →"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* FINISHED SCREEN */}
      {activeIdx >= questions.length && questions.length > 0 && (
        <div className="finished-card glass">
          <div className="finished-icon">🎓</div>
          <h3>Interview Completed!</h3>
          <p>
            You have gone through all simulator questions for <strong>{category} ({difficulty})</strong>. 
            Review your scored answers and continue practicing to build interview confidence.
          </p>
          <button className="btn-primary" onClick={restartSimulation}>
            Practice Again
          </button>
        </div>
      )}
    </div>
  );
}
