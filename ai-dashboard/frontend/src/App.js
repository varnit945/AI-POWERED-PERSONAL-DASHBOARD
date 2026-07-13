import React, { useState, useEffect } from "react";
import "./App.css";

import Sidebar from "./components/Sidebar";
import Chat from "./components/Chat";
import News from "./components/News";
import Weather from "./components/Weather";
import Tasks from "./components/Tasks";
import Dashboard from "./pages/Dashboard";
import SparkleTrailCursor from "./components/SparkleTrailCursor.jsx";
import axios from "axios";
import Notes from "./components/Notes";
import Documents from "./components/Documents";
import Search from "./components/Search";
import Pomodoro from "./components/Pomodoro";
import HabitTracker from "./components/HabitTracker";
import StudyHub from "./components/StudyHub";
import InterviewPrep from "./components/InterviewPrep";
import CodeAssistant from "./components/CodeAssistant";
import CommandPalette from "./components/CommandPalette";
import Settings from "./components/Settings";
import StarfieldBackground from "./components/StarfieldBackground";

// Authentication Pages
import Login from "./pages/Login";
import Register from "./pages/Register";

// ---------------- Global API Caching for "Instant" Navigation ----------------
const originalGet = axios.get;
const originalPost = axios.post;
const originalPut = axios.put;
const originalDelete = axios.delete;

const apiCache = new Map();

axios.get = async (url, config) => {
  const cacheKey = url + JSON.stringify(config?.params || {});
  if (apiCache.has(cacheKey)) {
    const { data, timestamp } = apiCache.get(cacheKey);
    // 60-second global memory cache for lightning-fast tab switching
    if (Date.now() - timestamp < 60000) {
       return Promise.resolve({ data, status: 200, statusText: 'OK', cached: true });
    }
  }
  const response = await originalGet.call(axios, url, config);
  apiCache.set(cacheKey, { data: response.data, timestamp: Date.now() });
  return response;
};

const clearCache = () => apiCache.clear();

axios.post = async (...args) => { clearCache(); return originalPost.call(axios, ...args); };
axios.put = async (...args) => { clearCache(); return originalPut.call(axios, ...args); };
axios.delete = async (...args) => { clearCache(); return originalDelete.call(axios, ...args); };

// Configure Axios interceptor for JWT Auth & backend API URL replacement
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const backendUrl = process.env.REACT_APP_API_URL || "http://127.0.0.1:8000";
    if (config.url) {
      if (config.url.startsWith("http://127.0.0.1:8000")) {
        config.url = config.url.replace("http://127.0.0.1:8000", backendUrl);
      } else if (config.url.startsWith("/")) {
        config.url = backendUrl + config.url;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default function App() {
  // ---------------- Authentication ----------------
  const [user, setUser] = useState(() => {
    const token = localStorage.getItem("token");
    const username = localStorage.getItem("username");

    if (token) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          if (payload.exp && payload.exp * 1000 < Date.now()) {
            localStorage.removeItem("token");
            localStorage.removeItem("username");
            return null;
          }
        } else {
          localStorage.removeItem("token");
          localStorage.removeItem("username");
          return null;
        }
      } catch (e) {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        return null;
      }
    }
    return token ? { token, username } : null;
  });

  const [authView, setAuthView] = useState("login");

  // ---------------- Existing App States ----------------
  const [page, setPage] = useState("dashboard");
  const [theme, setTheme] = useState("dark");
  const [messages, setMessages] = useState([]);
  const [taskLists, setTaskLists] = useState([]);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  // ---------------- Pomodoro Global Background Timer State ----------------
  const [pomoMode, setPomoMode] = useState("focus");
  const [pomoTimeLeft, setPomoTimeLeft] = useState(25 * 60);
  const [pomoIsRunning, setPomoIsRunning] = useState(false);
  const [pomoCustomFocus, setPomoCustomFocus] = useState(25);
  const [pomoCustomBreak, setPomoCustomBreak] = useState(5);

  useEffect(() => {
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const playAlarmSound = () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      const playChime = (time, frequency, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = "sine";
        osc.frequency.setValueAtTime(frequency, time);
        
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.3, time + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(time);
        osc.stop(time + duration);
      };

      const now = ctx.currentTime;
      playChime(now, 587.33, 0.4);
      playChime(now + 0.15, 880.00, 0.4);
      playChime(now + 0.4, 698.46, 0.4);
      playChime(now + 0.55, 1046.50, 0.6);
    } catch (e) {
      console.error("Failed to play audio alert", e);
    }
  };

  const handlePomoSessionComplete = async () => {
    setPomoIsRunning(false);
    playAlarmSound();
    
    if (Notification.permission === "granted") {
      new Notification(
        pomoMode === "focus" ? "💪 Focus Session Finished!" : "☕ Break Over!",
        {
          body: pomoMode === "focus" ? "Great job! Time to take a short break." : "Ready to get back to work?",
          icon: "/logo.png"
        }
      );
    }

    if (pomoMode === "focus") {
      try {
        const backendUrl = process.env.REACT_APP_API_URL || "http://127.0.0.1:8000";
        await axios.post(`${backendUrl}/pomodoro/sessions`, {
          duration_minutes: pomoCustomFocus
        });
      } catch (err) {
        console.error("Failed to record pomodoro session", err);
      }
      setPomoMode("break");
      setPomoTimeLeft(pomoCustomBreak * 60);
    } else {
      setPomoMode("focus");
      setPomoTimeLeft(pomoCustomFocus * 60);
    }

    // Auto-start next session block
    setTimeout(() => {
      setPomoIsRunning(true);
    }, 1000);
  };

  useEffect(() => {
    let interval = null;
    if (pomoIsRunning) {
      interval = setInterval(() => {
        setPomoTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            handlePomoSessionComplete();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pomoIsRunning, pomoMode, pomoCustomFocus, pomoCustomBreak]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setUser(null);
    setAuthView("login");
  };

  // Intercept 401 Unauthorized responses to auto-logout invalid sessions
  useEffect(() => {
    const interceptorId = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response && error.response.status === 401) {
          handleLogout();
        }
        return Promise.reject(error);
      }
    );
    return () => {
      axios.interceptors.response.eject(interceptorId);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const handleGlobalKeys = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setIsPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleGlobalKeys);
    return () => window.removeEventListener("keydown", handleGlobalKeys);
  }, []);

  const toggleTheme = () => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  };

  // ---------------- Authentication Screen ----------------
  if (!user) {
    return authView === "login" ? (
      <Login
        onLoginSuccess={setUser}
        switchToRegister={() => setAuthView("register")}
      />
    ) : (
      <Register
        onRegisterSuccess={setUser}
        switchToLogin={() => setAuthView("login")}
      />
    );
  }

  
  return (
    <div className="app-shell">
      {theme === "dark" && <StarfieldBackground />}
      <SparkleTrailCursor />

    <Sidebar
      page={page}
      setPage={setPage}
      theme={theme}
      toggleTheme={toggleTheme}
      handleLogout={handleLogout}
      user={user}
    />

    <div className="main-content">
      <div className="page-transition" key={page}>
          {page === "dashboard" && (
            <Dashboard
              messages={messages}
              taskLists={taskLists}
              setPage={setPage}
              user={user}
              pomoMode={pomoMode}
              pomoTimeLeft={pomoTimeLeft}
              pomoIsRunning={pomoIsRunning}
            />
          )}

          {page === "chat" && (
            <Chat
              messages={messages}
              setMessages={setMessages}
            />
          )}

          {page === "news" && <News />}

          {page === "weather" && <Weather />}

          {page === "tasks" && (
            <Tasks
              taskLists={taskLists}
              setTaskLists={setTaskLists}
            />
          )}

           {page === "pomodoro" && (
            <Pomodoro
              mode={pomoMode}
              setMode={setPomoMode}
              timeLeft={pomoTimeLeft}
              setTimeLeft={setPomoTimeLeft}
              isRunning={pomoIsRunning}
              setIsRunning={setPomoIsRunning}
              customFocus={pomoCustomFocus}
              setCustomFocus={setPomoCustomFocus}
              customBreak={pomoCustomBreak}
              setCustomBreak={setPomoCustomBreak}
            />
          )}

          {page === "habits" && <HabitTracker />}

          {page === "notes" && <Notes />}

          {page === "documents" && <Documents />}

          {page === "study" && <StudyHub />}

          {page === "interview" && <InterviewPrep />}

          {page === "code" && <CodeAssistant />}

          {page === "search" && (
            <Search
              setPage={setPage}
              setMessages={setMessages}
            />
          )}

          {page === "settings" && <Settings />}
        </div>
      </div>
      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        setPage={setPage}
        toggleTheme={toggleTheme}
        onLogout={handleLogout}
      />
    </div>
  );
}