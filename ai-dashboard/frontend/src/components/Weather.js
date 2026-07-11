import React, { useState, useRef } from "react";
import axios from "axios";
import "./Weather.css";

const iconFor = (condition = "") => {
  const c = condition.toLowerCase();
  if (c.includes("thunder")) return "⛈️";
  if (c.includes("snow")) return "❄️";
  if (c.includes("rain") || c.includes("drizzle")) return "🌧️";
  if (c.includes("cloud")) return "☁️";
  if (c.includes("mist") || c.includes("fog") || c.includes("haze")) return "🌫️";
  if (c.includes("clear")) return "☀️";
  return "🌤️";
};

export default function Weather() {
  const [city, setCity] = useState("");
  const [data, setData] = useState(null);
  const [forecast, setForecast] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);

  const requestId = useRef(0);

  const getWeather = async () => {
    if (!city.trim()) return;

    const thisRequest = ++requestId.current;

    setLoading(true);
    setError("");
    setData(null);
    setForecast([]);

    try {
      const [weatherRes, forecastRes] = await Promise.all([
        axios.get(`http://127.0.0.1:8000/weather/${city}`),
        axios.get(`http://127.0.0.1:8000/weather/forecast/${city}`)
      ]);

      if (thisRequest !== requestId.current) return;

      // 🔥 Ensure proper object structure (prevents string bug)
      setData({
        city: weatherRes.data?.city || city,
        temp: weatherRes.data?.temp,
        condition: weatherRes.data?.condition || "Unknown",
        humidity: weatherRes.data?.humidity ?? "--"
      });

      setForecast(Array.isArray(forecastRes.data?.forecast) ? forecastRes.data.forecast : []);
      setUpdatedAt(new Date());

    } catch (err) {
      if (thisRequest !== requestId.current) return;

      setError(
        err.response?.data?.detail ||
        "Couldn't find weather for that city."
      );
    } finally {
      if (thisRequest === requestId.current) {
        setLoading(false);
      }
    }
  };

  return (
    <div className="weather-page">
      <p className="page-eyebrow">Live Conditions</p>
      <div className="page-header">🌤 Weather</div>

      {/* INPUT */}
      <div className="weather-input-row">
        <input
          className="text-input"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="Enter city name..."
          onKeyDown={(e) => e.key === "Enter" && getWeather()}
        />

        <button
          className="btn-primary"
          onClick={getWeather}
          disabled={loading}
        >
          {loading ? "Loading…" : "Get Details"}
        </button>
      </div>

      {/* ERROR */}
      {error && <div className="weather-error">{error}</div>}

      {/* WEATHER CARD */}
      {data && (
        <div className="weather-result glass">

          <div className="weather-top">
            <div>
              <p className="weather-city">{data.city}</p>

              <p className="weather-temp">
                {data.temp !== undefined ? `${data.temp}°C` : "--"}
              </p>

              <p className="weather-condition">
                {data.condition}
              </p>
            </div>

            <span className="weather-icon">
              {iconFor(data.condition)}
            </span>
          </div>

          {/* STATS */}
          <div className="weather-grid">
            <div className="weather-stat">
              <span className="stat-label">Humidity</span>
              <span className="stat-value">{data.humidity}%</span>
            </div>
          </div>

          {/* FORECAST */}
          <div className="forecast-container">
  {forecast.map((day, index) => (
    <div key={index} className="forecast-card">

      <p className="forecast-day">
        {day?.date
          ? new Date(day.date.replace(/-/g, "/")).toLocaleDateString("en-US", {
              weekday: "short"
            })
          : "--"}
      </p>

      <div className="forecast-icon">
        {iconFor(day?.condition)}
      </div>

      <p className="forecast-temp">
        {day?.temp !== undefined ? `${Math.round(day.temp)}°C` : "--"}
      </p>

    </div>
  ))}
</div>

          {/* LAST UPDATED */}
          {updatedAt && (
            <p className="weather-updated">
              Last updated{" "}
              {updatedAt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
              })}
            </p>
          )}

        </div>
      )}
    </div>
  );
}