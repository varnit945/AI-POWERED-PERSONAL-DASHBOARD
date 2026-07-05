import React, { useState } from "react";
import axios from "axios";
import "./Login.css";
import BackgroundAnimation from "../components/BackgroundAnimation";

import API from "../config";

export default function Login({ onLoginSuccess, switchToRegister }) {
  // Core login state
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  // Forgot‑password flow state
  const [fpEmail, setFpEmail] = useState("");
  const [fpCode, setFpCode] = useState("");
  const [fpNewPassword, setFpNewPassword] = useState("");
  const [fpStep, setFpStep] = useState("request"); // "request" | "reset"
  const [fpMessage, setFpMessage] = useState("");
  const [fpError, setFpError] = useState("");
  
  // Public community metrics state
  const [stats, setStats] = useState({ total_users: 1, online_users: 1 });

  React.useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await axios.get(`${API}/public/stats`);
        if (res.data) {
          setStats(res.data);
        }
      } catch (err) {
        console.error("Failed to load public stats", err);
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    if (!identifier.trim() || !password) {
      setError("Please enter your username/email and password.");
      return;
    }
    setLoading(true);
    try {
      const res = await axios.post(`${API}/auth/login`, { identifier, password });
      localStorage.setItem("token", res.data.token);
      localStorage.setItem("username", res.data.username);
      onLoginSuccess(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Login failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotRequest = async (e) => {
    e.preventDefault();
    setFpError("");
    setFpMessage("");
    if (!fpEmail.trim()) {
      setFpError("Enter your registered email.");
      return;
    }
    try {
      const res = await axios.post(`${API}/auth/forgot-password`, { email: fpEmail });
      setFpMessage(res.data.message);
      setFpStep("reset");
    } catch (err) {
      setFpError(err.response?.data?.detail || "Something went wrong.");
    }
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    setFpError("");
    setFpMessage("");
    if (!fpCode.trim() || !fpNewPassword) {
      setFpError("Enter the code and a new password.");
      return;
    }
    try {
      const res = await axios.post(`${API}/auth/reset-password`, {
        email: fpEmail,
        code: fpCode,
        new_password: fpNewPassword,
      });
      setFpMessage(res.data.message + " You can log in now.");
      setTimeout(() => {
        setShowForgot(false);
        setFpStep("request");
        setFpEmail("");
        setFpCode("");
        setFpNewPassword("");
        setFpMessage("");
      }, 1800);
    } catch (err) {
      setFpError(err.response?.data?.detail || "Reset failed.");
    }
  };

  if (showForgot) {
    return (
      <div className="auth-page">
        <div className="auth-card glass">
          <h1 className="auth-title">Reset Password</h1>
          <p className="auth-subtitle">
            {fpStep === "request"
              ? "Enter your registered email — we'll send a reset code."
              : "Enter the code we emailed you and choose a new password."}
          </p>
          {fpStep === "request" ? (
            <form onSubmit={handleForgotRequest} className="auth-form">
              <input type="email" className="auth-input" placeholder="Registered email" value={fpEmail} onChange={(e) => setFpEmail(e.target.value)} />
              {fpError && <div className="auth-error">{fpError}</div>}
              {fpMessage && <div className="auth-success">{fpMessage}</div>}
              <button type="submit" className="btn-primary auth-submit">Send Reset Code</button>
            </form>
          ) : (
            <form onSubmit={handleResetSubmit} className="auth-form">
              <input type="text" className="auth-input" placeholder="6-digit code" value={fpCode} onChange={(e) => setFpCode(e.target.value)} maxLength={6} />
              <input type="password" className="auth-input" placeholder="New password" value={fpNewPassword} onChange={(e) => setFpNewPassword(e.target.value)} />
              {fpError && <div className="auth-error">{fpError}</div>}
              {fpMessage && <div className="auth-success">{fpMessage}</div>}
              <button type="submit" className="btn-primary auth-submit">Reset Password</button>
            </form>
          )}
          <button className="auth-link-btn" onClick={() => { setShowForgot(false); setFpStep("request"); setFpError(""); setFpMessage(""); }}>
            ← Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <BackgroundAnimation />
      <div className="auth-page">
        <div className="auth-card glass">
          <h1 className="auth-title">Welcome Back</h1>
          <p className="auth-subtitle">Log in with your username or email</p>
          <form onSubmit={handleLogin} className="auth-form">
            <input type="text" className="auth-input" placeholder="Username or Gmail" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus />
            <input type="password" className="auth-input" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <div className="auth-error">{error}</div>}
            <button type="submit" className="btn-primary auth-submit" disabled={loading}>
              {loading ? "Logging in…" : "Log In"}
            </button>
          </form>
          <button className="auth-link-btn" onClick={() => setShowForgot(true)}>
            Forgot password?
          </button>
          <div className="auth-divider" />
          <p className="auth-switch">
            Don't have an account? <button className="auth-link-inline" onClick={switchToRegister}>Register</button>
          </p>
          <div style={{ marginTop: "16px", fontSize: "12px", color: "var(--text-muted)", textAlign: "center" }}>
            👥 {stats.total_users} members registered · 🟢 {stats.online_users} online now
          </div>
        </div>
      </div>
    </>
  );
}