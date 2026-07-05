import React, { useState, useEffect } from "react";
import axios from "axios";
import "./Settings.css";
import { detectLocation } from "../utils/geo";

import API from "../config";

const AVAILABLE_MODELS = [
  { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B (Instant & Extremely Fast)" },
  { id: "gemma2-9b-it", name: "Gemma 2 9B (Fast & Balanced)" },
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B (Deep & Detailed - Slow)" }
];

export default function Settings() {
  const [model, setModel] = useState("llama-3.1-8b-instant");
  const [city, setCity] = useState("Mumbai");
  const [stats, setStats] = useState({ total_users: 1, online_users: 1 });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/user/settings`);
      if (res.data) {
        if (res.data.preferred_model) setModel(res.data.preferred_model);
        if (res.data.favorite_city) setCity(res.data.favorite_city);
      }
      const statsRes = await axios.get(`${API}/public/stats`);
      if (statsRes.data) {
        setStats(statsRes.data);
      }
    } catch (err) {
      console.error("Failed to load settings", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSuccess(false);
    setError("");
    try {
      await axios.post(`${API}/user/settings`, {
        preferred_model: model,
        favorite_city: city,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError("Failed to update preferences. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-page-wrapper">
      <p className="page-eyebrow">User Space</p>
      <div className="page-header">⚙️ Global Settings</div>

      {loading ? (
        <div className="settings-loading glass">
          <div className="spinner" />
          <p>Retrieving configuration rules...</p>
        </div>
      ) : (
        <>
          <div className="settings-card glass">
          <h3>Preferences Manager</h3>

          <div className="settings-form">
            <div className="settings-item">
              <label>Default AI LLM Model</label>
              <p className="settings-item-desc">
                If the AI takes too much time, select **Llama 3.1 8B (Instant)** for ultra-fast completions.
              </p>
              <select
                className="notes-select settings-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {AVAILABLE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-item">
              <label>Default City Location</label>
              <p className="settings-item-desc">
                Used to compile geocode indicators for Weather widgets and the AI Morning Briefing.
              </p>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <input
                  className="text-input settings-text-input"
                  style={{ flex: 1, marginBottom: 0 }}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Enter city (e.g. Mumbai, New York)..."
                />
                <button
                  className="btn-ghost"
                  type="button"
                  onClick={async () => {
                    const location = await detectLocation();
                    if (!location) {
                      alert("Could not detect location automatically. Please enter your location manually.");
                      return;
                    }

                    if (location.city) {
                      setCity(location.city);
                      alert(`Detected location: ${location.city} (IP-based)`);
                    } else if (location.latitude && location.longitude) {
                      try {
                        const res = await axios.get(`${API}/weather/reverse-geocode`, {
                          params: { lat: location.latitude, lon: location.longitude }
                        });
                        if (res.data && res.data.city) {
                          setCity(res.data.city);
                          alert(`Detected location: ${res.data.city}`);
                        }
                      } catch (err) {
                        alert("Failed to resolve city name. Please type it manually.");
                      }
                    }
                  }}
                  style={{ whiteSpace: "nowrap", padding: "8px 12px" }}
                >
                  📍 Use Current Location
                </button>
              </div>
            </div>

            {success && <div className="settings-success-banner">✓ Settings updated successfully!</div>}
            {error && <div className="settings-error-banner">{error}</div>}

            <button className="btn-primary save-settings-btn" onClick={handleSave} disabled={saving}>
              {saving ? "Saving Preferences..." : "Save Preferences"}
            </button>
          </div>
        </div>

        {/* Community Stats Card */}
        <div className="settings-card glass" style={{ marginTop: "24px" }}>
          <h3>📊 Platform Analytics</h3>
          <p className="settings-item-desc" style={{ marginBottom: "16px" }}>
            Real-time dashboard utilization metrics and total registered community members.
          </p>
          <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
            <div style={{
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid var(--border)",
              padding: "16px 20px",
              borderRadius: "12px",
              minWidth: "160px",
              flex: 1
            }}>
              <div style={{ fontSize: "28px", fontWeight: "700", color: "var(--accent)" }}>
                {stats.total_users}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                Total Registered Members
              </div>
            </div>
            
            <div style={{
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid var(--border)",
              padding: "16px 20px",
              borderRadius: "12px",
              minWidth: "160px",
              flex: 1
            }}>
              <div style={{ fontSize: "28px", fontWeight: "700", color: "var(--signal)" }}>
                🟢 {stats.online_users}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                Active Users Online
              </div>
            </div>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
