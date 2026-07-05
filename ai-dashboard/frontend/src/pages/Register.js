import React, { useState } from "react";
import axios from "axios";
import "./Login.css";

import API from "../config";

export default function Register({ onRegisterSuccess, switchToLogin }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");

    if (!username.trim() || !email.trim() || !password) {
      setError("Please fill in all fields.");
      return;
    }
    if (!/^\S+@gmail\.com$/i.test(email.trim())) {
      setError("Please register with a valid Gmail address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post(`${API}/auth/register`, {
        username: username.trim(),
        email: email.trim(),
        password,
      });
      localStorage.setItem("token", res.data.token);
      localStorage.setItem("username", res.data.username);
      onRegisterSuccess(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Registration failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card glass">
        <h1 className="auth-title">Create Account</h1>
        <p className="auth-subtitle">Register with your Gmail and a username</p>

        <form onSubmit={handleRegister} className="auth-form">
          <input
            type="text"
            className="auth-input"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <input
            type="email"
            className="auth-input"
            placeholder="Gmail address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            className="auth-input"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            type="password"
            className="auth-input"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="btn-primary auth-submit" disabled={loading}>
            {loading ? "Creating account…" : "Register"}
          </button>
        </form>

        <div className="auth-divider" />

        <p className="auth-switch">
          Already have an account?{" "}
          <button className="auth-link-inline" onClick={switchToLogin}>
            Log In
          </button>
        </p>
        <div style={{ marginTop: "16px", fontSize: "12px", color: "var(--text-muted)", textAlign: "center" }}>
          👥 {stats.total_users} members registered · 🟢 {stats.online_users} online now
        </div>
      </div>
    </div>
  );
}