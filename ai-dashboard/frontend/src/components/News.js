import React, { useEffect, useState } from "react";
import axios from "axios";
import "./News.css";

export default function News() {
  const [news, setNews] = useState([]);
  const [query, setQuery] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    loadNews();
  }, []);

  const loadNews = async () => {
    try {
      const res = await axios.get("http://127.0.0.1:8000/trending-india-news");
      setNews(res.data.articles || []);
      setUpdatedAt(new Date());
    } catch (err) {
      console.log(err);
      setNews([]);
    }
  };

  const filtered = news.filter((n) =>
    n.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="news-page">
      <p className="page-eyebrow">Live Feed</p>
      <div className="page-header">📰 AI Trending News (India)</div>

      {updatedAt && (
        <p className="news-updated">
          Last updated {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}

      <input
        className="text-input news-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search headlines…"
      />

      {filtered.length > 0 ? (
        <div className="news-list">
          {filtered.map((n, i) => (
            <div className="news-card glass" key={i}>
              <h4 className="news-title">{n.title}</h4>
              <p className="news-summary">{n.summary}</p>
              <div className="news-meta">
                <span className="news-source">📰 {n.source}</span>
                <a
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="news-link"
                >
                  Read more →
                </a>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="news-empty">
          {news.length === 0 ? "No trending stories right now." : "No headlines match your search."}
        </div>
      )}
    </div>
  );
}