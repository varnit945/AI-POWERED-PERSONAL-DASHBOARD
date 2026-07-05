import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import "./StudyHub.css";

import API from "../config";

export default function StudyHub() {
  const [topic, setTopic] = useState("");
  const [textContent, setTextContent] = useState("");
  const [mode, setMode] = useState("flashcards"); // flashcards | quiz
  
  // Custom setup states
  const [difficulty, setDifficulty] = useState("Intermediate"); // Beginner | Intermediate | Advanced
  const [targetMarks, setTargetMarks] = useState("5 Marks"); // 2 Marks | 5 Marks | 10 Marks
  const [flashcardCount, setFlashcardCount] = useState("5"); // 5 | 10 | 20 | infinite
  const [quizLength, setQuizLength] = useState("5"); // 5 | 10 | 20 | infinite

  const [loading, setLoading] = useState(false);
  const [loadingNext, setLoadingNext] = useState(false);
  const [flashcards, setFlashcards] = useState([]);
  const [quiz, setQuiz] = useState([]);
  
  // Flashcard state
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  
  // Quiz state
  const [quizIdx, setQuizIdx] = useState(-1); // -1 means setup, 0+ is questions, 99 is results
  const [answers, setAnswers] = useState({}); // { questionIndex: chosenOptionIndex }
  const [showExplanation, setShowExplanation] = useState(false);
  const [score, setScore] = useState(0);

  const explanationRef = useRef(null);

  // Auto-scroll explanation box into view
  useEffect(() => {
    if (showExplanation && explanationRef.current) {
      explanationRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [showExplanation]);

  const generateContent = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setFlashcards([]);
    setQuiz([]);
    setCardIdx(0);
    setFlipped(false);
    setQuizIdx(-1);
    setAnswers({});
    setShowExplanation(false);
    setScore(0);

    try {
      if (mode === "flashcards") {
        const count = flashcardCount === "infinite" ? 1 : parseInt(flashcardCount);
        const res = await axios.post(`${API}/study/flashcards`, {
          topic: topic.trim(),
          text_content: textContent.trim() || null,
          num_questions: count,
          difficulty: difficulty,
          target_marks: targetMarks,
          exclude_questions: []
        });
        setFlashcards(res.data.flashcards || []);
      } else {
        const count = quizLength === "infinite" ? 1 : parseInt(quizLength);
        const res = await axios.post(`${API}/study/quiz`, {
          topic: topic.trim(),
          text_content: textContent.trim() || null,
          num_questions: count,
          difficulty: difficulty,
          exclude_questions: []
        });
        setQuiz(res.data.quiz || []);
        setQuizIdx(0);
      }
    } catch (err) {
      alert("Failed to generate study materials. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleQuizAnswer = (optionIdx) => {
    if (showExplanation) return; // already answered
    setAnswers({ ...answers, [quizIdx]: optionIdx });
    
    // Increment score if correct
    if (optionIdx === quiz[quizIdx].correct_index) {
      setScore((prev) => prev + 1);
    }
    
    setShowExplanation(true);
  };

  const nextQuizQuestion = async () => {
    setShowExplanation(false);

    // If infinite mode and we are at the last generated question, fetch the next one
    if (quizLength === "infinite" && quizIdx === quiz.length - 1) {
      setLoadingNext(true);
      try {
        const excludes = quiz.map((q) => q.question);
        const res = await axios.post(`${API}/study/quiz`, {
          topic: topic.trim(),
          text_content: textContent.trim() || null,
          num_questions: 1,
          difficulty: difficulty,
          exclude_questions: excludes
        });
        if (res.data.quiz && res.data.quiz.length > 0) {
          setQuiz((prev) => [...prev, ...res.data.quiz]);
          setQuizIdx((prev) => prev + 1);
        } else {
          setQuizIdx(99); // show results if empty response
        }
      } catch (err) {
        alert("Failed to load next question. Concluding quiz.");
        setQuizIdx(99);
      } finally {
        setLoadingNext(false);
      }
    } else {
      if (quizIdx < quiz.length - 1) {
        setQuizIdx((prev) => prev + 1);
      } else {
        setQuizIdx(99); // show results
      }
    }
  };

  const nextFlashcard = async () => {
    setFlipped(false);

    // If infinite mode and we are at the last generated card, fetch the next one
    if (flashcardCount === "infinite" && cardIdx === flashcards.length - 1) {
      setLoadingNext(true);
      try {
        const excludes = flashcards.map((c) => c.question);
        const res = await axios.post(`${API}/study/flashcards`, {
          topic: topic.trim(),
          text_content: textContent.trim() || null,
          num_questions: 1,
          difficulty: difficulty,
          target_marks: targetMarks,
          exclude_questions: excludes
        });
        if (res.data.flashcards && res.data.flashcards.length > 0) {
          setFlashcards((prev) => [...prev, ...res.data.flashcards]);
          setTimeout(() => setCardIdx((prev) => prev + 1), 150);
        } else {
          alert("No more flashcards could be generated for this topic.");
        }
      } catch (err) {
        alert("Failed to load next card.");
      } finally {
        setLoadingNext(false);
      }
    } else {
      if (cardIdx < flashcards.length - 1) {
        setTimeout(() => setCardIdx((prev) => prev + 1), 150);
      }
    }
  };

  const changeCard = async () => {
    setLoadingNext(true);
    try {
      const excludes = flashcards.map((c) => c.question);
      const res = await axios.post(`${API}/study/flashcards`, {
        topic: topic.trim(),
        text_content: textContent.trim() || null,
        num_questions: 1,
        difficulty: difficulty,
        target_marks: targetMarks,
        exclude_questions: excludes
      });
      if (res.data.flashcards && res.data.flashcards.length > 0) {
        setFlipped(false);
        const newCards = [...flashcards];
        newCards[cardIdx] = res.data.flashcards[0];
        setFlashcards(newCards);
      } else {
        alert("AI could not generate a new unique card right now. Try again.");
      }
    } catch (err) {
      alert("Failed to swap card. Please check your connection.");
    } finally {
      setLoadingNext(false);
    }
  };

  const changeQuestion = async () => {
    setLoadingNext(true);
    try {
      const excludes = quiz.map((q) => q.question);
      const res = await axios.post(`${API}/study/quiz`, {
        topic: topic.trim(),
        text_content: textContent.trim() || null,
        num_questions: 1,
        difficulty: difficulty,
        exclude_questions: excludes
      });
      if (res.data.quiz && res.data.quiz.length > 0) {
        const newQuiz = [...quiz];
        newQuiz[quizIdx] = res.data.quiz[0];
        setQuiz(newQuiz);
        setShowExplanation(false);
        
        // Remove selection answer for this question
        const newAnswers = { ...answers };
        delete newAnswers[quizIdx];
        setAnswers(newAnswers);
      } else {
        alert("AI could not generate a new unique question right now. Try again.");
      }
    } catch (err) {
      alert("Failed to swap question. Please check your connection.");
    } finally {
      setLoadingNext(false);
    }
  };

  const renderCardAnswer = (answer) => {
    if (!answer) return "";
    if (typeof answer === "object") {
      return (
        <div className="structured-answer" style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
          {Object.entries(answer).map(([key, val]) => (
            <div key={key}>
              <strong style={{ color: "var(--accent)", textTransform: "capitalize", fontSize: "13.5px" }}>
                {key.replace(/_/g, " ")}:
              </strong>
              <p style={{ margin: "2px 0 0 0", fontSize: "14px", color: "var(--text-muted)", lineHeight: "1.5" }}>
                {typeof val === "object" ? JSON.stringify(val, null, 2) : String(val)}
              </p>
            </div>
          ))}
        </div>
      );
    }
    return String(answer);
  };

  const resetHub = () => {
    setFlashcards([]);
    setQuiz([]);
    setQuizIdx(-1);
    setTopic("");
    setTextContent("");
    setQuizLength("5");
    setFlashcardCount("5");
    setDifficulty("Intermediate");
    setTargetMarks("5 Marks");
  };

  return (
    <div className="study-page-wrapper">
      <p className="page-eyebrow">Active Learning Hub</p>
      <div className="page-header">🎓 AI Study Hub</div>

      {/* SETUP CARD */}
      {flashcards.length === 0 && quizIdx === -1 && (
        <div className="study-card setup-card glass">
          <h3>Create Study Material</h3>
          <p className="setup-hint">
            Let the AI construct flippable flashcard decks or dynamic multiple-choice quizzes to test your memory and reinforce active recall.
          </p>

          <div className="setup-form">
            <div className="setup-group">
              <label>Study Topic / Subject</label>
              <input
                className="text-input"
                placeholder="e.g., Photosynthesis, Binary Search Trees, French Revolution..."
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="setup-group">
              <label>Optional reference notes or raw text (pasted)</label>
              <textarea
                className="text-input study-textarea"
                placeholder="Paste paragraph or notes to build custom cards/questions from them directly..."
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                disabled={loading}
              />
            </div>

            {/* SELECTION ROW 1: METHOD & DIFFICULTY */}
            <div className="setup-controls-row" style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              <div className="setup-group" style={{ flex: 2, minWidth: "220px" }}>
                <label>Learning Method</label>
                <div className="study-mode-toggle">
                  <button
                    type="button"
                    className={`study-mode-btn ${mode === "flashcards" ? "active" : ""}`}
                    onClick={() => setMode("flashcards")}
                    disabled={loading}
                  >
                    📇 Flashcards
                  </button>
                  <button
                    type="button"
                    className={`study-mode-btn ${mode === "quiz" ? "active" : ""}`}
                    onClick={() => setMode("quiz")}
                    disabled={loading}
                  >
                    📝 MCQ Quiz
                  </button>
                </div>
              </div>

              <div className="setup-group" style={{ flex: 1, minWidth: "140px" }}>
                <label>Difficulty Standard</label>
                <select
                  className="notes-select"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  disabled={loading}
                  style={{ height: "46px" }}
                >
                  <option value="Beginner">Beginner (Basic)</option>
                  <option value="Intermediate">Intermediate (Core)</option>
                  <option value="Advanced">Advanced (Complex)</option>
                </select>
              </div>
            </div>

            {/* SELECTION ROW 2: COUNT & MARKS */}
            <div className="setup-controls-row" style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              {mode === "flashcards" && (
                <>
                  <div className="setup-group" style={{ flex: 1, minWidth: "140px" }}>
                    <label>Deck Size</label>
                    <select
                      className="notes-select"
                      value={flashcardCount}
                      onChange={(e) => setFlashcardCount(e.target.value)}
                      disabled={loading}
                      style={{ height: "46px" }}
                    >
                      <option value="5">5 Cards</option>
                      <option value="10">10 Cards</option>
                      <option value="20">20 Cards</option>
                      <option value="infinite">♾ Infinite Practice</option>
                    </select>
                  </div>

                  <div className="setup-group" style={{ flex: 1, minWidth: "160px" }}>
                    <label>Answer Marks Standard</label>
                    <select
                      className="notes-select"
                      value={targetMarks}
                      onChange={(e) => setTargetMarks(e.target.value)}
                      disabled={loading}
                      style={{ height: "46px" }}
                    >
                      <option value="2 Marks">2 Marks Standard (Short Answer)</option>
                      <option value="5 Marks">5 Marks Standard (Medium Answer)</option>
                      <option value="10 Marks">10 Marks Standard (Comprehensive)</option>
                    </select>
                  </div>
                </>
              )}

              {mode === "quiz" && (
                <div className="setup-group" style={{ flex: 1, minWidth: "140px" }}>
                  <label>Quiz Length</label>
                  <select
                    className="notes-select"
                    value={quizLength}
                    onChange={(e) => setQuizLength(e.target.value)}
                    disabled={loading}
                    style={{ height: "46px" }}
                  >
                    <option value="5">5 Questions</option>
                    <option value="10">10 Questions</option>
                    <option value="20">20 Questions</option>
                    <option value="infinite">♾ Infinite Practice</option>
                  </select>
                </div>
              )}
            </div>

            <button className="btn-primary generate-btn" onClick={generateContent} disabled={loading || !topic.trim()}>
              {loading ? "AI is compiling details..." : `Compile AI ${mode === "flashcards" ? "Flashcards" : "Quiz"}`}
            </button>
          </div>
        </div>
      )}

      {/* LOADING SPINNER */}
      {loading && (
        <div className="study-loading glass">
          <div className="spinner" />
          <p>Analyzing context, extracting key concepts, and structuring study review decks...</p>
        </div>
      )}

      {/* FLASHCARDS VIEW */}
      {flashcards.length > 0 && !loading && (
        <div className="flashcards-wrapper">
          <div className="study-controls-top">
            <div style={{ display: "flex", gap: "10px" }}>
              <button className="btn-ghost" onClick={resetHub}>← Reset Deck</button>
              <button className="btn-ghost" onClick={changeCard} disabled={loadingNext}>
                🔄 Skip / Change Card
              </button>
            </div>
            <span className="deck-progress">
              {flashcardCount === "infinite" ? `Card ${cardIdx + 1}` : `Card ${cardIdx + 1} of ${flashcards.length}`}
            </span>
          </div>

          <div className="flashcard-container glass" onClick={() => setFlipped(!flipped)}>
            <div className={`flashcard ${flipped ? "flipped" : ""}`}>
              <div className="card-face card-front">
                <div className="card-header-badge">❓ QUESTION ({difficulty.toUpperCase()})</div>
                <p className="card-text">{flashcards[cardIdx].question}</p>
                <span className="card-hint">Click card to reveal answer ({targetMarks} target)</span>
              </div>
              <div className="card-face card-back">
                <div className="card-header-badge answer">💡 ANSWER ({targetMarks.toUpperCase()})</div>
                <p className="card-text" style={{ fontSize: targetMarks === "10 Marks" ? "14px" : "18px", textAlign: "left", overflowY: "auto", maxHeight: "80%", width: "100%" }}>
                  {renderCardAnswer(flashcards[cardIdx].answer)}
                </p>
                <span className="card-hint" style={{ marginTop: "15px" }}>Click card to view question</span>
              </div>
            </div>
          </div>

          <div className="deck-navigation">
            <button
              className="btn-ghost"
              disabled={cardIdx === 0 || loadingNext}
              onClick={() => {
                setFlipped(false);
                setTimeout(() => setCardIdx(cardIdx - 1), 150);
              }}
            >
              Previous Card
            </button>
            <button
              className="btn-primary"
              disabled={loadingNext || (flashcardCount !== "infinite" && cardIdx === flashcards.length - 1)}
              onClick={nextFlashcard}
              style={{ display: "flex", alignItems: "center", justifyCenter: "center", gap: "8px" }}
            >
              {loadingNext ? (
                <>
                  <div className="spinner" style={{ width: "16px", height: "16px", borderWidth: "2px" }} />
                  Loading Next...
                </>
              ) : flashcardCount === "infinite" && cardIdx === flashcards.length - 1 ? (
                "Next Card (Generate) →"
              ) : (
                "Next Card"
              )}
            </button>
          </div>
        </div>
      )}

      {/* QUIZ INTERACTIVE VIEW */}
      {quizIdx >= 0 && quizIdx < quiz.length && !loading && (
        <div className="quiz-wrapper">
          <div className="study-controls-top">
            <div style={{ display: "flex", gap: "10px" }}>
              <button className="btn-ghost" onClick={resetHub}>← Cancel Quiz</button>
              <button className="btn-ghost" onClick={changeQuestion} disabled={loadingNext}>
                🔄 Skip / Change Question
              </button>
            </div>
            <span className="deck-progress">
              {quizLength === "infinite" ? `Question ${quizIdx + 1}` : `Question ${quizIdx + 1} of ${quiz.length}`}
            </span>
          </div>

          <div className="quiz-question-card glass">
            <h2>{quiz[quizIdx].question}</h2>
            
            <div className="quiz-options-list">
              {quiz[quizIdx].options.map((opt, oIdx) => {
                let statusClass = "";
                const isChosen = answers[quizIdx] === oIdx;
                const isCorrect = oIdx === quiz[quizIdx].correct_index;

                if (showExplanation) {
                  if (isCorrect) statusClass = "correct";
                  else if (isChosen && !isCorrect) statusClass = "wrong";
                  else statusClass = "disabled";
                }

                return (
                  <button
                    key={oIdx}
                    className={`quiz-option-btn ${statusClass} ${isChosen ? "chosen" : ""}`}
                    onClick={() => handleQuizAnswer(oIdx)}
                    disabled={showExplanation}
                  >
                    <span className="option-letter">{String.fromCharCode(65 + oIdx)}.</span>
                    <span className="option-text">{opt}</span>
                  </button>
                );
              })}
            </div>

            {showExplanation && (
              <div className="quiz-explanation-box glass" ref={explanationRef}>
                <div className={`explanation-header ${answers[quizIdx] === quiz[quizIdx].correct_index ? "pass" : "fail"}`}>
                  {answers[quizIdx] === quiz[quizIdx].correct_index ? "✓ Correct Answer!" : "✗ Incorrect"}
                </div>
                <p className="explanation-text">{quiz[quizIdx].explanation}</p>
                <button 
                  className="btn-primary next-question-btn" 
                  onClick={nextQuizQuestion} 
                  disabled={loadingNext}
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  {loadingNext ? (
                    <>
                      <div className="spinner" style={{ width: "16px", height: "16px", borderWidth: "2px" }} />
                      Loading Next...
                    </>
                  ) : quizLength === "infinite" ? (
                    "Next Question →"
                  ) : quizIdx === quiz.length - 1 ? (
                    "Finish Test"
                  ) : (
                    "Next Question →"
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* QUIZ RESULTS VIEW */}
      {quizIdx === 99 && (
        <div className="quiz-results-card glass">
          <div className="results-icon">🏆</div>
          <h3>Quiz Completed!</h3>
          <div className="score-ring">
            <span className={`score-ring-number ${score >= (quiz.length * 0.6) ? "high" : "medium"}`}>
              {score} / {quiz.length}
            </span>
          </div>
          <p className="results-message">
            {score === quiz.length
              ? "Flawless score! You have completely mastered this material."
              : score >= (quiz.length * 0.6)
              ? "Good job! Active retrieval builds durable knowledge. Review explanation logs to master the remainder."
              : "Review the topic slides or notes, and try again to reinforce correct connections."}
          </p>
          <button className="btn-primary" onClick={resetHub}>
            Study Another Topic
          </button>
        </div>
      )}
    </div>
  );
}
