import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import QRCode from "react-qr-code";
import {
  getCachedChats,
  getCachedMessages,
  setCachedChats,
  setCachedMessages,
  clearCache
} from "./cacheStore";

const runtimeHost =
  typeof window !== "undefined" ? window.location.hostname : "localhost";
const runtimeProtocol =
  typeof window !== "undefined" ? window.location.protocol : "http:";

// Smart API Resolution: localhost and private IPs use :3005, any other domain prepends api-
const isLocal = runtimeHost === "localhost" ||
                runtimeHost === "127.0.0.1" ||
                runtimeHost.startsWith("192.168.") ||
                runtimeHost.startsWith("10.") ||
                runtimeHost.startsWith("172.") ||
                runtimeHost.endsWith(".local");

const defaultApiUrl = isLocal
  ? `${runtimeProtocol}//${runtimeHost}:3005`
  : `https://api-${runtimeHost.replace(/^api-/, "")}`;

console.log("[ChatFix] API target:", defaultApiUrl);

const API_URL = import.meta.env.VITE_API_URL || defaultApiUrl;
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || defaultApiUrl;
const MOBILE_BREAKPOINT_PX = 920;
const DEFAULT_PROVIDER = "whatsapp";
const DEFAULT_ACCOUNT_ID = "default";

// We will extract these dynamic parameters where applicable if needed.

function parseApiItemsPayload(payload) {
  if (Array.isArray(payload)) {
    return {
      items: payload,
      syncState: null
    };
  }
  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    syncState: payload?.syncState || null
  };
}

const originalFetch = window.fetch;
window.fetch = async (...args) => {
  let [resource, config] = args;
  const key = localStorage.getItem("chatfix_api_key");
  
  if (key) {
    config = config || {};
    let headers = config.headers || {};
    
    if (headers instanceof Headers) {
      headers.set("X-API-Key", key);
    } else if (Array.isArray(headers)) {
      headers.push(["X-API-Key", key]);
    } else {
      headers["X-API-Key"] = key;
    }
    config.headers = headers;
    args[1] = config;
  }
  
  const response = await originalFetch(...args);
  if (response.status === 401) {
    console.warn("Auth failure for:", resource);
    window.dispatchEvent(new Event('chatfix_auth_error'));
  }
  return response;
};

function formatTime(unixTs) {
  const value = Number(unixTs) || Math.floor(Date.now() / 1000);
  return new Date(value * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatChatTime(unixTs) {
  const value = Number(unixTs);
  if (!value) return "";
  const date = new Date(value * 1000);
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  if (sameDay) return formatTime(value);
  return date.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

function formatStatusDate(unixTs) {
  const value = Number(unixTs);
  if (!value) return "";
  return new Date(value * 1000).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function messageId(msg) {
  return msg.id || `${msg.chatId}-${msg.timestamp}-${msg.body}-${msg.fromMe}`;
}

function initialsForChat(chat) {
  if (chat?.isGroup) return "GR";
  const base = (chat?.name || chat?.id || "?").trim();
  if (!base) return "?";
  const parts = base.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "?";
}

function getAvatarGradient(id) {
  const str = String(id || "default");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c1 = `hsl(${hash % 360}, 65%, 35%)`;
  const c2 = `hsl(${(hash + 40) % 360}, 75%, 45%)`;
  return `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
}

function AckIcon({ status }) {
  if (status === 3) return <span className="ackDoubleBlue">✓✓</span>;
  if (status === 2) return <span className="ackDouble">✓✓</span>;
  if (status === 1) return <span className="ackSingle">✓</span>;
  if (status === 'sending') return <span className="ackClock">⏲</span>;
  return null;
}

function App() {
  const socketRef = useRef(null);
  const selectedChatIdRef = useRef("");
  const chatsRef = useRef([]);
  const messagesAreaRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const previousMessageCountRef = useRef(0);
  const previousSelectedChatIdRef = useRef("");
  const messageFetchReqIdRef = useRef(0);
  const grammarCheckInFlightRef = useRef(new Set());
  const grammarQueueRef = useRef([]);
  const grammarQueueSetRef = useRef(new Set());
  const grammarWorkersRef = useRef(0);
  const grammarInsightsRef = useRef({});
  const grammarFailuresRef = useRef(0);
  const grammarCooldownUntilRef = useRef(0);
  const grammarCooldownNoticeRef = useRef(0);
  const lastGrammarCheckAtRef = useRef(0);
  const searchInputRef = useRef(null);
  const draftInputRef = useRef(null);

  const [apiAuthenticated, setApiAuthenticated] = useState(false);
  const [inputApiKey, setInputApiKey] = useState(localStorage.getItem("chatfix_api_key") || "");
  const [showApiKey, setShowApiKey] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [authError, setAuthError] = useState("");

  const [sessionStatus, setSessionStatus] = useState("connecting");
  const [socketConnected, setSocketConnected] = useState(false);
  const [qr, setQr] = useState("");
  const [backendStatus, setBackendStatus] = useState({
    providerStatus: "unknown",
    uptimeSec: 0,
    statusArchive: null
  });

  const [toasts, setToasts] = useState([]);

  function showNotice(text, type = "info") {
    const id = Date.now() + Math.random().toString(36);
    setToasts(prev => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  }

  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState({});
  const [correcting, setCorrecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingType, setSendingType] = useState(null);
  const [correctingAndSending, setCorrectingAndSending] = useState(false);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const [resources, setResources] = useState({ media: [], links: [], statuses: [] });
  const [loadingResources, setLoadingResources] = useState(false);
  const [loadingAiConfig, setLoadingAiConfig] = useState(false);
  const [savingAiConfig, setSavingAiConfig] = useState(false);
  const [checkingAiHealth, setCheckingAiHealth] = useState(false);
  const [aiHealth, setAiHealth] = useState(null);
  const [aiModels, setAiModels] = useState([]);
  const [showCloudflareToken, setShowCloudflareToken] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [pwaUpdateAvailable, setPwaUpdateAvailable] = useState(null);
  const [isMobileLayout, setIsMobileLayout] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches
      : false
  );

  const [chatSearch, setChatSearch] = useState("");
  const [chats, setChats] = useState([]);
  const [viewMode, setViewMode] = useState("chats");
  const [messagesByChat, setMessagesByChat] = useState({});
  const [selectedChatId, setSelectedChatId] = useState("");
  const [messages, setMessages] = useState([]);
  const [statusArchiveItems, setStatusArchiveItems] = useState([]);
  const [loadingStatusArchive, setLoadingStatusArchive] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [pendingIncomingCount, setPendingIncomingCount] = useState(0);
  const [draftsByChat, setDraftsByChat] = useState(() => { try { return JSON.parse(localStorage.getItem("chatfix_drafts") || "{}"); } catch (e) { return {}; } }); const draft = draftsByChat[selectedChatId] || ""; const setDraft = (val) => setDraftsByChat(prev => ({ ...prev, [selectedChatId]: val }));
  const [correctedDraft, setCorrectedDraft] = useState("");
  const debouncedDraftRef = useRef(null);
  const [replyTarget, setReplyTarget] = useState(null);
  const [grammarInsights, setGrammarInsights] = useState({});
  const [replyQueue, setReplyQueue] = useState([]);
  const [sendingReplyQueueIds, setSendingReplyQueueIds] = useState({});
  const [syncingChat, setSyncingChat] = useState(false);
  const [syncingChats, setSyncingChats] = useState(false);
  const [aiConfig, setAiConfig] = useState({
    provider: "lmstudio",
    aiBaseUrl: "",
    lmStudioBaseUrl: "",
    cloudflareAccountId: "",
    cloudflareApiToken: "",
    cloudflareBaseUrl: "",
    modelName: "",
    temperature: 0.7,
    maxTokens: 180,
    timeoutMs: 15000,
    systemPrompt: "",
    userPromptTemplate: ""
  });

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId),
    [chats, selectedChatId]
  );

  const filteredChats = useMemo(() => {
    const needle = chatSearch.trim().toLowerCase();
    if (!needle) return chats;
    return chats.filter((chat) => {
      const label = `${chat.name || ""} ${chat.id || ""}`.toLowerCase();
      return label.includes(needle);
    });
  }, [chats, chatSearch]);

  const totalUnread = useMemo(
    () => chats.reduce((acc, chat) => acc + Number(chat.unreadCount || 0), 0),
    [chats]
  );

  const filteredStatusArchive = useMemo(() => {
    const needle = chatSearch.trim().toLowerCase();
    if (!needle) return statusArchiveItems;
    return statusArchiveItems.filter((item) => {
      const haystack = `${item.statusOwnerName || ""} ${item.statusOwnerId || ""} ${item.description || ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [chatSearch, statusArchiveItems]);

  const connectionLabel = useMemo(() => {
    if (!socketConnected) return "Desconectado del servidor (WebSocket)";
    if (sessionStatus === "authenticated") return "Conectado al proveedor";
    if (sessionStatus === "qr") return "Requiere vinculación (QR)";
    if (sessionStatus === "auth_failure") return "Sesión rechazada/inválida";
    if (sessionStatus === "disconnected") return "Proveedor desconectado";
    return "Sincronizando con proveedor...";
  }, [sessionStatus, socketConnected]);

  const dotClass = useMemo(() => {
    if (!socketConnected) return "bad";
    if (sessionStatus === "authenticated") return "ok";
    if (sessionStatus === "qr" || sessionStatus === "connecting") return "warning";
    return "bad";
  }, [sessionStatus, socketConnected]);

  const authScreenLabel = useMemo(() => {
    if (!socketConnected) return "Conectando al servidor...";
    if (sessionStatus === "qr") return "Vincular proveedor";
    if (sessionStatus === "auth_failure") return "No se pudo iniciar sesión. Por favor, asegúrate de que el dispositivo siga vinculado.";
    if (sessionStatus === "disconnected") return "El proveedor se ha desconectado. Intenta reconectar.";
    return "Iniciando sesión con el proveedor...";
  }, [sessionStatus, socketConnected]);




  function isNearBottom(container) {
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight <= 84;
  }

  function scrollMessagesToBottom(behavior = "auto") {
    const container = messagesAreaRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior
    });
    shouldStickToBottomRef.current = true;
    setShowJumpToLatest(false);
    setPendingIncomingCount(0);
  }

  function handleMessagesScroll() {
    const container = messagesAreaRef.current;
    if (!container) return;
    const nearBottom = isNearBottom(container);
    shouldStickToBottomRef.current = nearBottom;
    if (nearBottom) {
      setShowJumpToLatest(false);
      setPendingIncomingCount(0);
    } else if (messages.length > 0) {
      setShowJumpToLatest(true);
    }
  }

  function autoResizeDraftInput() {
    const input = draftInputRef.current;
    if (!input) return;
    const maxHeight = 180;
    input.style.height = "auto";
    const nextHeight = Math.min(input.scrollHeight, maxHeight);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  function canonicalText(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasMeaningfulCorrection(original, corrected) {
    const a = canonicalText(original);
    const b = canonicalText(corrected);
    if (!a || !b) return false;
    return a !== b;
  }

  function onGrammarCheckFailure() {
    grammarFailuresRef.current += 1;
    if (grammarFailuresRef.current < 4) return;

    const cooldownMs = 45000;
    grammarCooldownUntilRef.current = Date.now() + cooldownMs;
    grammarFailuresRef.current = 0;

    if (Date.now() - grammarCooldownNoticeRef.current > 15000) {
      grammarCooldownNoticeRef.current = Date.now();
      showNotice("La revisión gramatical automática se pausó temporalmente por errores de IA.", "info");
    }
  }

  function onGrammarCheckSuccess() {
    grammarFailuresRef.current = 0;
  }

  async function checkGrammarForMessage(msg) {
    if (!msg || msg.fromMe) return;
    const text = String(msg.body || "").trim();
    if (!text || text.length < 3 || text.length > 450) return;
    if (Date.now() < grammarCooldownUntilRef.current) return;
    const key = msg._uiId || messageId(msg);
    if (!key) return;
    if (grammarCheckInFlightRef.current.has(key)) return;
    if (grammarInsightsRef.current[key] !== undefined) return;

    grammarCheckInFlightRef.current.add(key);
    try {
      const res = await fetch(`${API_URL}/api/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      if (!res.ok) {
        onGrammarCheckFailure();
        return;
      }
      const data = await res.json();
      const corrected = String(data.corrected || "").trim();
      const hasErrors = hasMeaningfulCorrection(text, corrected);
      onGrammarCheckSuccess();
      setGrammarInsights((prev) => ({
        ...prev,
        [key]: {
          hasErrors,
          original: text,
          corrected: corrected || text
        }
      }));
    } catch (_error) {
      onGrammarCheckFailure();
    } finally {
      grammarCheckInFlightRef.current.delete(key);
      grammarQueueSetRef.current.delete(key);
    }
  }

  const grammarTimerRef = useRef(null);
  function runGrammarQueue() {
    if (Date.now() < grammarCooldownUntilRef.current) return;
    if (grammarTimerRef.current) return;

    const now = Date.now();
    const timeSinceLast = now - lastGrammarCheckAtRef.current;
    if (timeSinceLast < 2000) {
      grammarTimerRef.current = setTimeout(() => {
        grammarTimerRef.current = null;
        runGrammarQueue();
      }, 2000 - timeSinceLast);
      return;
    }

    const maxWorkers = 1;
    if (grammarWorkersRef.current < maxWorkers && grammarQueueRef.current.length > 0) {
      const nextMsg = grammarQueueRef.current.shift();
      grammarWorkersRef.current += 1;
      lastGrammarCheckAtRef.current = Date.now();

      checkGrammarForMessage(nextMsg).finally(() => {
        grammarWorkersRef.current -= 1;
        grammarTimerRef.current = setTimeout(() => {
          grammarTimerRef.current = null;
          runGrammarQueue();
        }, 2000);
      });
    }
  }

  function enqueueGrammarCheck(msg) {
    const key = msg?._uiId || messageId(msg);
    if (!key) return;
    if (grammarInsightsRef.current[key] !== undefined) return;
    if (grammarCheckInFlightRef.current.has(key)) return;
    if (grammarQueueSetRef.current.has(key)) return;
    grammarQueueSetRef.current.add(key);
    grammarQueueRef.current.push(msg);
    runGrammarQueue();
  }

  function mergeLiveMessage(msg) {
    if (!msg?.chatId) return;
    const normalized = { ...msg, _uiId: messageId(msg) };
    if (!msg.fromMe && selectedChatIdRef.current === msg.chatId) {
      markChatAsRead(msg.chatId);
    }
    setChats((prev) => {
      const exists = prev.find((chat) => chat.id === msg.chatId);
      const next = exists
        ? prev.map((chat) => {
            if (chat.id !== msg.chatId) return chat;
            const isSelected = selectedChatIdRef.current === msg.chatId;
            const isIncoming = !msg.fromMe;
            const nextUnread = isIncoming && !isSelected ? Number(chat.unreadCount || 0) + 1 : 0;
            return {
              ...chat,
              timestamp: msg.timestamp || chat.timestamp,
              unreadCount: nextUnread
            };
          })
        : [
            {
              id: msg.chatId,
              name: msg.chatId,
              timestamp: msg.timestamp || Math.floor(Date.now() / 1000),
              unreadCount: msg.fromMe ? 0 : 1
            },
            ...prev
          ];

      return [...next].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    });

    setMessagesByChat((prev) => {
      const current = prev[msg.chatId] || [];
      if (current.some((item) => item._uiId === normalized._uiId)) return prev;
      const merged = [...current, normalized].sort(
        (a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0)
      );
      if (selectedChatIdRef.current === msg.chatId) {
        setMessages(merged);
      }
      return { ...prev, [msg.chatId]: merged };
    });
  }

  const handleLogout = () => {
    localStorage.removeItem("chatfix_api_key");
    setApiAuthenticated(false);
    setSessionStatus("connecting");
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    clearCache().catch(() => {});
  };

  useEffect(() => {
    const handleAuthError = () => {
      handleLogout();
      setAuthError("La sesión expiró o la API Key es inválida.");
    };
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    const handlePwaUpdate = (e) => setPwaUpdateAvailable(() => e.detail.updateSW);

    window.addEventListener('chatfix_auth_error', handleAuthError);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener("pwa_update_available", handlePwaUpdate);

    return () => {
      window.removeEventListener('chatfix_auth_error', handleAuthError);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener("pwa_update_available", handlePwaUpdate);
    };
  }, []);


  const checkAuth = async (key) => {
    setAuthChecking(true);
    setAuthError("");
    try {
      const res = await originalFetch(`${API_URL}/api/check-auth`, {
        headers: { 'X-API-Key': key }
      });
      if (res.ok) {
        localStorage.setItem("chatfix_api_key", key);
        setApiAuthenticated(true);
      } else {
        setApiAuthenticated(false);
        setAuthError("API Key incorrecta. Por favor, verificá tus credenciales.");
        showNotice("Autenticación fallida con la clave provista.", "error");
        localStorage.removeItem("chatfix_api_key");
        clearCache().catch(() => {});
      }
    } catch (e) {
      setApiAuthenticated(false);
      setAuthError("Error de conexión al verificar la API Key.");
    }
    setAuthChecking(false);
  };

  useEffect(() => {
    if (inputApiKey) checkAuth(inputApiKey);
    else setAuthChecking(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    const handleChange = (event) => {
      setIsMobileLayout(event.matches);
      if (!event.matches && !selectedChatIdRef.current && chatsRef.current?.length > 0) {
        setSelectedChatId(chatsRef.current[0].id);
        selectedChatIdRef.current = chatsRef.current[0].id;
      }
    };
    setIsMobileLayout(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (!apiAuthenticated) {
      if (socketRef.current) { socketRef.current.close(); socketRef.current = null; }
      return;
    }

    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      auth: { token: localStorage.getItem("chatfix_api_key") || "" },
      reconnection: true,
      reconnectionAttempts: Infinity
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketConnected(true);
      setSessionStatus("socket_connected");
    });
    socket.on("disconnect", () => {
      setSocketConnected(false);
    });
    socket.on("connect_error", () => {
      setSocketConnected(false);
    });
    socket.on("qr", (payload) => {
      const eventProvider = payload?.provider || DEFAULT_PROVIDER;
      const eventAccountId = payload?.accountId || DEFAULT_ACCOUNT_ID;
      if (eventProvider !== DEFAULT_PROVIDER || eventAccountId !== DEFAULT_ACCOUNT_ID) {
        return;
      }
      setQr(payload?.qr || (typeof payload === 'string' ? payload : "")); // payload can be the string itself backward compat
      setSessionStatus("qr");
    });
    socket.on("ready", (payload) => {
      const eventProvider = payload?.provider || DEFAULT_PROVIDER;
      const eventAccountId = payload?.accountId || DEFAULT_ACCOUNT_ID;
      if (eventProvider !== DEFAULT_PROVIDER || eventAccountId !== DEFAULT_ACCOUNT_ID) {
        return;
      }
      setQr("");
      setSessionStatus("authenticated");
    });
    socket.on("auth_failure", (payload) => {
      const eventProvider = payload?.provider || DEFAULT_PROVIDER;
      const eventAccountId = payload?.accountId || DEFAULT_ACCOUNT_ID;
      if (eventProvider !== DEFAULT_PROVIDER || eventAccountId !== DEFAULT_ACCOUNT_ID) {
        return;
      }
      setSessionStatus("auth_failure");
      showNotice("Fallo de autenticación del proveedor.", "error");
    });
    socket.on("disconnected", (payload) => {
      const eventProvider = payload?.provider || DEFAULT_PROVIDER;
      const eventAccountId = payload?.accountId || DEFAULT_ACCOUNT_ID;
      if (eventProvider !== DEFAULT_PROVIDER || eventAccountId !== DEFAULT_ACCOUNT_ID) {
        return;
      }
      setSessionStatus("disconnected");
      showNotice("La sesión del proveedor se desconectó.", "error");
    });
    socket.on("new_message", (payload) => {
      const eventProvider = payload?.provider || DEFAULT_PROVIDER;
      const eventAccountId = payload?.accountId || DEFAULT_ACCOUNT_ID;
      if (eventProvider !== DEFAULT_PROVIDER || eventAccountId !== DEFAULT_ACCOUNT_ID) {
        return;
      }
      mergeLiveMessage(payload);
    });
    socket.on("message_updated", (updated) => {
      const eventProvider = updated?.provider || DEFAULT_PROVIDER;
      const eventAccountId = updated?.accountId || DEFAULT_ACCOUNT_ID;
      if (eventProvider !== DEFAULT_PROVIDER || eventAccountId !== DEFAULT_ACCOUNT_ID) {
        return;
      }

      const normalized = { ...updated, _uiId: messageId(updated) };
      setMessagesByChat((prev) => {
        const current = prev[updated.chatId] || [];
        const next = current.map((m) => (m.id === updated.id || m._uiId === updated._uiId) ? { ...m, ...normalized } : m);
        if (selectedChatIdRef.current === updated.chatId) {
          setMessages(next);
        }
        return { ...prev, [updated.chatId]: next };
      });
    });

    return () => {
      socket.off("new_message", mergeLiveMessage);
      socket.close();
    };
  }, [apiAuthenticated]);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
    setReplyTarget(null);
    setReplyQueue([]);
    setSendingReplyQueueIds({});
    setShowJumpToLatest(false);
    setPendingIncomingCount(0);
    shouldStickToBottomRef.current = true;
    previousMessageCountRef.current = 0;

    if (!selectedChatId) {
      setMessages([]);
      return;
    }

    setChats((prev) =>
      prev.map((item) => (item.id === selectedChatId ? { ...item, unreadCount: 0 } : item))
    );
    markChatAsRead(selectedChatId);
    setMessages(messagesByChat[selectedChatId] || []);
    fetchMessages(selectedChatId, {
      withLoader: !messagesByChat[selectedChatId],
      background: !!messagesByChat[selectedChatId]
    });
  }, [selectedChatId]);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Escape to close modals and clear context states
      if (e.key === 'Escape') {
        if (showResources) setShowResources(false);
        if (showAiSettings) setShowAiSettings(false);
        if (replyTarget) setReplyTarget(null);
        return; // Don't prevent default, just handle our local logic
      }

      // Ctrl+K to search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }

      // Alt + Up/Down to navigate chats
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (filteredChats.length === 0) return;

        const currentIndex = filteredChats.findIndex(c => c.id === selectedChatId);
        let nextIndex = 0;

        if (e.key === 'ArrowUp') {
          nextIndex = currentIndex <= 0 ? filteredChats.length - 1 : currentIndex - 1;
        } else {
          nextIndex = currentIndex >= filteredChats.length - 1 ? 0 : currentIndex + 1;
        }

        const nextChat = filteredChats[nextIndex];
        if (nextChat) {
          setSelectedChatId(nextChat.id);
          // Auto-scroll to active chat item could be added here
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [filteredChats, selectedChatId]);

  useEffect(() => {
    localStorage.setItem("chatfix_drafts", JSON.stringify(draftsByChat));
  }, [draftsByChat]);

  useEffect(() => {
    if (!Array.isArray(chats) || chats.length === 0) return;
    setCachedChats(DEFAULT_PROVIDER, DEFAULT_ACCOUNT_ID, chats).catch(() => {});
  }, [chats]);

  useEffect(() => {
    if (!selectedChatId || !Array.isArray(messages) || messages.length === 0) return;
    setCachedMessages(DEFAULT_PROVIDER, DEFAULT_ACCOUNT_ID, selectedChatId, messages).catch(() => {});
  }, [messages, selectedChatId]);

  useEffect(() => {
    autoResizeDraftInput();
    if (shouldStickToBottomRef.current) {
      scrollMessagesToBottom("auto");
    }
  }, [draft, selectedChatId]);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    fetchChats(true);
  }, [sessionStatus]);

  useEffect(() => {
    if (!selectedChatId || sessionStatus !== "authenticated") return;
    const intervalMs = syncingChat ? 3000 : 15000;
    const timer = setInterval(() => {
      fetchMessages(selectedChatId, { withLoader: false, background: true });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [selectedChatId, sessionStatus, syncingChat]);

  useEffect(() => {
    const container = messagesAreaRef.current;
    if (!container) return;

    const chatChanged = previousSelectedChatIdRef.current !== selectedChatId;
    const previousCount = previousMessageCountRef.current;
    const currentCount = messages.length;
    const hasNewMessages = currentCount > previousCount;
    const latestMessage = currentCount > 0 ? messages[currentCount - 1] : null;

    if (chatChanged) {
      requestAnimationFrame(() => {
        scrollMessagesToBottom("auto");
      });
    } else if (hasNewMessages) {
      const canAutoScroll = shouldStickToBottomRef.current || Boolean(latestMessage?.fromMe);
      if (canAutoScroll) {
        requestAnimationFrame(() => {
          scrollMessagesToBottom("smooth");
        });
      } else {
        setShowJumpToLatest(true);
        if (!latestMessage?.fromMe) {
          setPendingIncomingCount((prev) => prev + (currentCount - previousCount));
        }
      }
    }

    previousSelectedChatIdRef.current = selectedChatId;
    previousMessageCountRef.current = currentCount;
  }, [messages, selectedChatId]);

  useEffect(() => {
    grammarInsightsRef.current = grammarInsights;
  }, [grammarInsights]);

  useEffect(() => {
    const incoming = messages.filter((msg) => !msg.fromMe).slice(-40);
    incoming.forEach((msg) => {
      enqueueGrammarCheck(msg);
    });
  }, [messages]);



  useEffect(() => {
    if (!apiAuthenticated) return;
    const fetchStatus = async () => {
      try {
        const url = new URL(`${API_URL}/api/status`);
        url.searchParams.set("provider", DEFAULT_PROVIDER);
        url.searchParams.set("accountId", DEFAULT_ACCOUNT_ID);
        const res = await fetch(url.toString());
        if (!res.ok) return;
        const data = await res.json();
        setBackendStatus({
          providerStatus: data.providerStatus || "unknown",
          uptimeSec: Number(data.uptimeSec || 0),
          statusArchive: data.statusArchive || null
        });
      } catch (_error) {
        // silent on status poll
      }
    };
    fetchStatus();
    const timer = setInterval(fetchStatus, 10000);
    return () => clearInterval(timer);
  }, [apiAuthenticated]);

  async function fetchStatusArchive(background = false) {
    if (!apiAuthenticated) return;
    if (!navigator.onLine) return;
    if (!background) setLoadingStatusArchive(true);
    try {
      const url = new URL(`${API_URL}/api/status-archive`);
      url.searchParams.set("provider", DEFAULT_PROVIDER);
      url.searchParams.set("accountId", DEFAULT_ACCOUNT_ID);
      url.searchParams.set("limit", "120");
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("No se pudieron cargar los estados archivados.");
      const data = await res.json();
      setStatusArchiveItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      if (!background) showNotice(error.message, "error");
    } finally {
      if (!background) setLoadingStatusArchive(false);
    }
  }

  async function fetchResources() {
    if (!selectedChatId) return;
    if (!navigator.onLine) {
      showNotice("No se pueden cargar los recursos sin conexión.", "error");
      return;
    }
    setLoadingResources(true);
    setShowResources(true);
    try {
      const url = new URL(`${API_URL}/api/chats/${encodeURIComponent(selectedChatId)}/resources`);
      url.searchParams.set("provider", DEFAULT_PROVIDER);
      url.searchParams.set("accountId", DEFAULT_ACCOUNT_ID);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("No se pudieron cargar los recursos.");
      const data = await res.json();
      setResources(data);
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setLoadingResources(false);
    }
  }

  useEffect(() => {
    if (!apiAuthenticated) return;
    fetchStatusArchive(true);
    const timer = setInterval(() => fetchStatusArchive(true), 60000);
    return () => clearInterval(timer);
  }, [apiAuthenticated]);

  async function fetchChats(selectFirst = false) {
    if (!apiAuthenticated) return;

    setLoadingChats(true);
    try {
      const cachedChats = await getCachedChats(DEFAULT_PROVIDER, DEFAULT_ACCOUNT_ID);
      if (cachedChats.length > 0) {
        const sortedCached = [...cachedChats].sort(
          (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)
        );
        chatsRef.current = sortedCached;
        setChats(sortedCached);

        // PWA Hydration: Auto-select chat from cache immediately to prevent UI jumps
        const existsInCache = sortedCached.some((chat) => chat.id === selectedChatIdRef.current);
        const nextCachedId = existsInCache ? selectedChatIdRef.current : sortedCached[0].id;
        const shouldAutoSelectCache = !isMobileLayout && (selectFirst || !selectedChatIdRef.current || !existsInCache);

        if (shouldAutoSelectCache && sortedCached.length > 0) {
          selectedChatIdRef.current = nextCachedId;
          setSelectedChatId(nextCachedId);
        }
      }

      if (!navigator.onLine) {
         setLoadingChats(false);
         return;
      }

      const url = new URL(`${API_URL}/api/chats`);
      url.searchParams.set("provider", DEFAULT_PROVIDER);
      url.searchParams.set("accountId", DEFAULT_ACCOUNT_ID);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("No se pudieron cargar los chats.");

      const payload = await res.json();
      const { items, syncState } = parseApiItemsPayload(payload);

      if (syncState && (syncState.status === 'syncing' || syncState.status === 'queued')) {
         setSyncingChats(true);
      } else {
         setSyncingChats(false);
      }

      const safeChats = items.sort(
        (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)
      );
      chatsRef.current = safeChats;
      setChats(safeChats);

      if (safeChats.length === 0) {
        if (selectedChatIdRef.current) {
          selectedChatIdRef.current = "";
          setSelectedChatId("");
        }
        await clearCache();
        await setCachedChats(DEFAULT_PROVIDER, DEFAULT_ACCOUNT_ID, []);
        return;
      }

      const exists = safeChats.some((chat) => chat.id === selectedChatIdRef.current);
      const nextChatId = exists ? selectedChatIdRef.current : safeChats[0].id;
      const shouldAutoSelect = !isMobileLayout && (selectFirst || !selectedChatIdRef.current || !exists);

      if (shouldAutoSelect && safeChats.length > 0) {
        selectedChatIdRef.current = nextChatId; // Update ref immediately to avoid jumpy behavior
        setSelectedChatId(nextChatId);
      } else if (!exists && selectedChatIdRef.current) {
        selectedChatIdRef.current = "";
        setSelectedChatId("");
        setMessages([]);
      }

      await setCachedChats(DEFAULT_PROVIDER, DEFAULT_ACCOUNT_ID, safeChats);
    } catch (error) {
      console.error(error);
      showNotice(error.message, "error");
    } finally {
      setLoadingChats(false);
    }
  }

  async function fetchMessages(chatId, options = {}) {
    const { withLoader = true, background = false } = options;
    if (!chatId) return;
    const reqId = ++messageFetchReqIdRef.current;

    if (withLoader) setLoadingMessages(prev => ({ ...prev, [chatId]: true }));
    if (background && navigator.onLine) setSyncingChat(true);

    try {
      if (!background) {
        const cachedMessages = await getCachedMessages(DEFAULT_PROVIDER, DEFAULT_ACCOUNT_ID, chatId);
        if (cachedMessages.length > 0 && selectedChatIdRef.current === chatId) {
          setMessages(cachedMessages);
          setMessagesByChat((prev) => ({ ...prev, [chatId]: cachedMessages }));
          if (withLoader) setLoadingMessages(prev => ({ ...prev, [chatId]: false }));
        }
      }

      if (!navigator.onLine) {
        if (withLoader) setLoadingMessages(prev => ({ ...prev, [chatId]: false }));
        return;
      }

      const url = new URL(`${API_URL}/api/chats/${encodeURIComponent(chatId)}/messages`);
      url.searchParams.set("provider", DEFAULT_PROVIDER);
      url.searchParams.set("accountId", DEFAULT_ACCOUNT_ID);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("No se pudieron cargar los mensajes.");
      const payload = await res.json();
      if (reqId !== messageFetchReqIdRef.current) return;
      const { items, syncState } = parseApiItemsPayload(payload);

      if (syncState && (syncState.status === 'syncing' || syncState.status === 'queued')) {
         setSyncingChat(true);
      } else {
         setSyncingChat(false);
      }
      const safeMessages = items
        .map((msg) => ({ ...msg, _uiId: messageId(msg) }))
        .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

      setMessagesByChat((prev) => ({ ...prev, [chatId]: safeMessages }));
      await setCachedMessages(DEFAULT_PROVIDER, DEFAULT_ACCOUNT_ID, chatId, safeMessages);
      if (selectedChatIdRef.current === chatId) {
        setMessages(prev => {
          // Keep optimistic messages that haven't been confirmed yet by the backend
          const pendingOptimistic = prev.filter(m =>
            m.status === 'sending' &&
            !safeMessages.some(sm => sm.body === m.body && sm.fromMe && sm.status !== 'sending')
          );
          return [...safeMessages, ...pendingOptimistic].sort(
            (a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0)
          );
        });
      }
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      if (withLoader) setLoadingMessages(prev => ({ ...prev, [chatId]: false }));
      if (background) setSyncingChat(false);
    }
  }

  async function markChatAsRead(chatId) {
    if (!chatId || !navigator.onLine) return;
    try {
      const url = new URL(`${API_URL}/api/chats/${encodeURIComponent(chatId)}/read`);
      url.searchParams.set("provider", DEFAULT_PROVIDER);
      url.searchParams.set("accountId", DEFAULT_ACCOUNT_ID);
      await fetch(url.toString(), {
        method: "POST"
      });
      setChats((prev) =>
        prev.map((chat) => (chat.id === chatId ? { ...chat, unreadCount: 0 } : chat))
      );
    } catch (_error) {
      // no-op for optimistic UX
    }
  }

  async function correctDraft() {
    if (!draft.trim()) return;
    setCorrecting(true);
    try {
      const res = await fetch(`${API_URL}/api/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft })
      });
      if (!res.ok) throw new Error("No se pudo corregir el mensaje.");
      const data = await res.json();
      setCorrectedDraft(data.corrected || "");
      showNotice("Sugerencia de IA lista para revisar.", "success");
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setCorrecting(false);
    }
  }

  async function correctAndSend() {
    if (!selectedChatId) {
      showNotice("Seleccioná un chat para enviar.", "error");
      return;
    }
    if (!draft.trim()) return;

    setCorrectingAndSending(true);
    try {
      const res = await fetch(`${API_URL}/api/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft })
      });
      if (!res.ok) throw new Error("No se pudo corregir el mensaje.");
      const data = await res.json();
      const corrected = (data.corrected || "").trim();
      if (!corrected) throw new Error("La IA devolvió texto vacío.");

      setCorrectedDraft(corrected);

      // Stop correcting spinner before triggering sending to allow the UI
      // to transition cleanly to the "Enviando versión IA..." state.
      setCorrectingAndSending(false);

      await sendMessage(corrected, "correctedAndSending");
    } catch (error) {
      showNotice(error.message, "error");
      setCorrectingAndSending(false);
    }
  }

  async function postSendMessage(payload) {
    if (!selectedChatId) {
      showNotice("Seleccioná un chat para enviar.", "error");
      return false;
    }
    const text = String(payload?.text || "").trim();
    if (!text) return false;

    try {
      const res = await fetch(`${API_URL}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: DEFAULT_PROVIDER,
          accountId: DEFAULT_ACCOUNT_ID,
          chatId: selectedChatId,
          text,
          originalText: payload?.originalText || text,
          replyToMessageId: payload?.replyToMessageId || ""
        })
      });
      if (!res.ok) throw new Error("No se pudo enviar el mensaje.");
      return true;
    } catch (error) {
      showNotice(error.message, "error");
      return false;
    }
  }

  async function sendMessage(textToSend, type = "original") {
    if (!String(textToSend || "").trim()) return;
    if (!navigator.onLine) {
       showNotice("No puedes enviar mensajes sin conexión a internet.", "error");
       return;
    }
    const optimisticMsg = {
      _uiId: `optimistic-${Date.now()}`,
      chatId: selectedChatId,
      body: textToSend,
      fromMe: true,
      timestamp: Math.floor(Date.now() / 1000),
      status: 'sending'
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setSending(true);
    setSendingType(type);
    try {
      const ok = await postSendMessage({
        text: textToSend,
        originalText: draftsByChat[selectedChatId] || textToSend,
        replyToMessageId: replyTarget?.id || ""
      });
      if (!ok) {
        setMessages(prev => prev.filter(m => m._uiId !== optimisticMsg._uiId));
        return;
      }
      setDraft("");
      setCorrectedDraft("");
      setReplyTarget(null);
      showNotice(type === "corrected" || type === "correctedAndSending" ? "✨ Mensaje mejorado por IA y enviado." : "📤 Mensaje original enviado.", "success");
      await fetchMessages(selectedChatId, { withLoader: false, background: true });
    } catch (error) {
      setMessages(prev => prev.filter(m => m._uiId !== optimisticMsg._uiId));
      showNotice(error.message, "error");
    } finally {
      setSending(false);
      setSendingType(null);
    }
  }

  function handleDraftKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!sending && !correcting && !correctingAndSending && (draft.trim() || correctedDraft)) {
        if (event.ctrlKey || event.metaKey) {
          // Force send original
          sendMessage(draft, "original");
        } else {
          if (correctedDraft) {
            sendMessage(correctedDraft, "corrected");
          } else if (draft.trim()) {
            correctAndSend();
          }
        }
      }
    }
  }

  function startReply(msg) {
    const replyBody = (msg.body || "").trim();
    setReplyTarget({
      id: msg.id || msg._uiId,
      text: replyBody || (msg.mediaType === "image" ? "[Imagen]" : "[Mensaje vacío]"),
      fromMe: Boolean(msg.fromMe)
    });
  }

  function buildGrammarReplyTemplate(original, corrected) {
    const safeOriginal = String(original || "").trim();
    const safeCorrected = String(corrected || "").trim();
    if (!safeOriginal || !safeCorrected) return "";
    return `Se escribe "${safeCorrected}" y no "${safeOriginal}".`;
  }

  function updateQueuedReplyText(localId, text) {
    setReplyQueue((prev) =>
      prev.map((item) => (item.localId === localId ? { ...item, text } : item))
    );
  }

  function removeQueuedReply(localId) {
    setReplyQueue((prev) => prev.filter((item) => item.localId !== localId));
    setSendingReplyQueueIds((prev) => {
      if (!prev[localId]) return prev;
      const next = { ...prev };
      delete next[localId];
      return next;
    });
  }

  function loadQueuedReplyToComposer(item) {
    setReplyTarget({
      id: item.replyToMessageId,
      text: item.original,
      fromMe: false
    });
    setDraft(item.text);
    setCorrectedDraft("");
    setTimeout(() => draftInputRef.current?.focus(), 0);
  }

  async function sendQueuedReply(item, options = {}) {
    const { silent = false, skipRefresh = false } = options;
    if (!item?.text?.trim()) return false;
    setSendingReplyQueueIds((prev) => ({ ...prev, [item.localId]: true }));
    try {
      const ok = await postSendMessage({
        text: item.text,
        originalText: item.text,
        replyToMessageId: item.replyToMessageId
      });
      if (!ok) return false;
      setReplyQueue((prev) => prev.filter((entry) => entry.localId !== item.localId));
      if (!silent) {
        showNotice("Respuesta enviada.", "success");
      }
      if (!skipRefresh) {
        await fetchMessages(selectedChatId, { withLoader: false, background: true });
      }
      return true;
    } finally {
      setSendingReplyQueueIds((prev) => {
        const next = { ...prev };
        delete next[item.localId];
        return next;
      });
    }
  }

  async function sendAllQueuedReplies() {
    const pending = replyQueue.filter((item) => item.text.trim());
    if (pending.length === 0) return;
    await Promise.all(pending.map((item) => sendQueuedReply(item, { silent: true, skipRefresh: true })));
    showNotice("Respuestas en paralelo enviadas.", "success");
    await fetchMessages(selectedChatId, { withLoader: false, background: true });
  }

  function prepareGrammarReply(msg) {
    const key = msg?._uiId || messageId(msg);
    const insight = key ? grammarInsights[key] : null;
    if (!insight?.hasErrors) return;
    const template = buildGrammarReplyTemplate(insight.original, insight.corrected);
    if (!template) return;
    const localId = `grammar-${msg.id || msg._uiId}`;
    setReplyQueue((prev) => {
      const exists = prev.some((item) => item.localId === localId);
      if (exists) return prev;
      return [
        {
          localId,
          replyToMessageId: msg.id || msg._uiId,
          original: insight.original,
          text: template
        },
        ...prev
      ];
    });
    showNotice("Respuesta sugerida agregada a la cola paralela.", "info");
  }

  async function fetchAiConfig() {
    setLoadingAiConfig(true);
    try {
      const res = await fetch(`${API_URL}/api/ai/config`);
      if (!res.ok) throw new Error("No se pudo obtener configuración de IA.");
      const data = await res.json();
      setAiConfig({
        provider: data.provider || "lmstudio",
        aiBaseUrl: data.aiBaseUrl || "",
        lmStudioBaseUrl: data.lmStudioBaseUrl || "",
        cloudflareAccountId: data.cloudflareAccountId || "",
        cloudflareApiToken: data.cloudflareApiToken || "",
        cloudflareBaseUrl: data.cloudflareBaseUrl || "",
        modelName: data.modelName || "",
        temperature: Number(data.temperature ?? 0.7),
        maxTokens: Number(data.maxTokens ?? 180),
        timeoutMs: Number(data.timeoutMs ?? 90000),
        systemPrompt: data.systemPrompt || "",
        userPromptTemplate: data.userPromptTemplate || ""
      });
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setLoadingAiConfig(false);
    }
  }

  async function fetchAiModels() {
    try {
      const res = await fetch(`${API_URL}/api/ai/models`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "No se pudieron cargar modelos.");
      }
      setAiModels(Array.isArray(data.models) ? data.models : []);
    } catch (error) {
      showNotice(error.message, "error");
      setAiModels([]);
    }
  }

  async function saveAiConfig() {
    setSavingAiConfig(true);
    try {
      const res = await fetch(`${API_URL}/api/ai/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: aiConfig.provider,
          lmStudioBaseUrl: aiConfig.lmStudioBaseUrl,
          cloudflareAccountId: aiConfig.cloudflareAccountId,
          cloudflareApiToken: aiConfig.cloudflareApiToken,
          cloudflareBaseUrl: aiConfig.cloudflareBaseUrl,
          modelName: aiConfig.modelName,
          temperature: aiConfig.temperature,
          maxTokens: aiConfig.maxTokens,
          timeoutMs: aiConfig.timeoutMs,
          systemPrompt: aiConfig.systemPrompt,
          userPromptTemplate: aiConfig.userPromptTemplate
        })
      });
      if (!res.ok) throw new Error("No se pudo guardar la configuración.");
      showNotice("Prompts y configuración IA guardados.", "success");
      await fetchAiConfig();
      await fetchAiModels();
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setSavingAiConfig(false);
    }
  }

  async function checkAiHealth() {
    setCheckingAiHealth(true);
    setAiHealth(null);
    try {
      const res = await fetch(`${API_URL}/api/ai/health?probe=1`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setAiHealth({ ok: false, message: data.error || "El proveedor IA no responde." });
        return;
      }
      if (data.probeOk === false) {
        setAiHealth({
          ok: false,
          message: `Conexión OK, pero el modelo falló: ${data.probeError}`
        });
        return;
      }
      setAiHealth({
        ok: true,
        message: `Conectado (${data.provider}). Modelos detectados: ${data.modelCount}. Prueba de inferencia OK.`
      });
    } catch (error) {
      setAiHealth({ ok: false, message: error.message });
    } finally {
      setCheckingAiHealth(false);
    }
  }

  if (!apiAuthenticated) {
    return (
      <>
        <div className="bg-blob-container" aria-hidden="true">
          <div className="bg-blob blob-1"></div>
          <div className="bg-blob blob-2"></div>
        </div>
        <main className="authScreen">
        <section className="authCard" aria-labelledby="apiKeyHeading">
          <h1 id="apiKeyHeading">ChatFix API</h1>
          {authError && <div id="apiKeyError" role="alert" aria-live="assertive" className="notice error" style={{ marginBottom: '15px' }}>{authError}</div>}

          <div className="onboarding-wizard">
            <p><strong>¡Bienvenido a ChatFix!</strong></p>
            <p>Para proteger tus conversaciones y conectar de forma segura con tu servidor (LM Studio, Cloudflare, o el proveedor), ingresa la clave de acceso API provista por tu administrador.</p>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); checkAuth(inputApiKey); }}>
            <label htmlFor="apiKeyInput" className="sr-only">Clave de acceso API</label>
            <div className="passwordInputWrapper">
              <input
                id="apiKeyInput"
                className="authInput"
                type={showApiKey ? "text" : "password"}
                value={inputApiKey}
                onChange={(e) => setInputApiKey(e.target.value)}
                placeholder="Introduce tu API Key"
                aria-required="true"
                aria-invalid={!!authError}
                aria-describedby={authError ? "apiKeyError" : undefined}
                spellCheck="false"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
              />
              <button
                type="button"
                className="passwordToggleBtn" aria-pressed={showApiKey}
                onClick={() => setShowApiKey(!showApiKey)}
                aria-label={showApiKey ? "Ocultar API Key" : "Mostrar API Key"}
              >
                {showApiKey ? "🙈" : "👁️"}
              </button>
            </div>
            <button
              type="submit"
              className="primary fullWidth"
              aria-label="Ingresar al panel de control"
              disabled={authChecking || !inputApiKey}
              aria-busy={authChecking}
            >
              {authChecking ? (
                <>
                  <span className="buttonSpinner" aria-hidden="true" />
                  <span>Comprobando...</span>
                </>
              ) : "Ingresar de forma segura"}
            </button>
          </form>
        </section>

      {toasts.length > 0 && (
        <div className="toast-container" aria-live="polite">
          {toasts.map(t => (
            <div key={t.id} className={`toast ${t.type}`}>
              {t.text}
            </div>
          ))}
        </div>
      )}
      </main>
    </>
    );
  }

  // Revert: As per UX Audit and the repo state, 'connecting' should NOT be a blocking UI state. The user needs to see the warning banner instead.
  const isBlockingSessionState = sessionStatus === "qr" || sessionStatus === "auth_failure";
  if (isBlockingSessionState) {
    return (
      <>
        <div className="bg-blob-container" aria-hidden="true">
          <div className="bg-blob blob-1"></div>
          <div className="bg-blob blob-2"></div>
        </div>
        <main className="authScreen">
        <section className="authCard" aria-live="polite" aria-labelledby="waAuthHeading">
          <h1 id="waAuthHeading">ChatFix</h1>
          <h2>{authScreenLabel}</h2>

          {sessionStatus === "qr" && socketConnected && (
            <>
              {qr ? (
                <>
                  <div className="instructionList">
                    <p>Para usar el proveedor en ChatFix:</p>
                    <ol>
                      <li>Abre la aplicación del proveedor en tu teléfono</li>
                      <li>Toca el menú (tres puntos) o "Configuración"</li>
                      <li>Selecciona <strong>"Dispositivos vinculados"</strong></li>
                      <li>Toca <strong>"Vincular un dispositivo"</strong> y apunta tu cámara a esta pantalla</li>
                    </ol>
                  </div>
                  <div className="qrBox" role="img" aria-label="Código QR para vincular dispositivo">
                    <QRCode value={qr} size={230} />
                  </div>
                </>
              ) : (
                <div className="loadingSpinnerContainer" aria-busy="true" aria-live="polite">
                  <div className="largeSpinner" aria-hidden="true"></div>
                  <p className="helperText">Generando código QR...</p>
                </div>
              )}
              <div className="authRecoveryOptions mt-4">
                <button
                  className="secondary fullWidth"
                  aria-label="Cancelar y salir"
                  onClick={handleLogout}
                >
                  Cancelar y salir
                </button>
              </div>
            </>
          )}

          {sessionStatus === "connecting" && socketConnected && (
            <div className="loadingSpinnerContainer" aria-busy="true" aria-live="polite">
              <div className="largeSpinner" aria-hidden="true"></div>
              <p className="helperText">Sincronizando mensajes y contactos...</p>
            </div>
          )}

          {!socketConnected && (
             <div className="loadingSpinnerContainer" aria-busy="true" aria-live="assertive">
                <div className="largeSpinner warningSpinner" aria-hidden="true"></div>
                <p className="helperText errorText">Reconectando con el servidor...</p>
             </div>
          )}

          {(sessionStatus === "auth_failure" && socketConnected) && (
            <div className="authRecoveryOptions">
              <button
                className="primary fullWidth"
                aria-label="Reintentar conexión con el proveedor"
                onClick={() => fetchChats(true)}
              >
                Reintentar conexión
              </button>
              <button
                className="secondary fullWidth mt-2"
                aria-label="Cerrar sesión y volver al inicio"
                onClick={handleLogout}
              >
                Cerrar sesión
              </button>
              <div className="notice error mt-2" role="alert" aria-live="assertive">
                <p className="helperText errorText">
                  <strong>⚠️ Error de Autenticación de Proveedor</strong><br />
                  Si el problema persiste, es posible que el dispositivo haya sido desvinculado desde tu teléfono u origen.
                </p>
              </div>
            </div>
          )}
        </section>
      </main>
    </>
    );
  }

  return (
    <>
      <div className="bg-blob-container">
        <div className="bg-blob blob-1"></div>
        <div className="bg-blob blob-2"></div>
      </div>
      {pwaUpdateAvailable && (
        <div className="updateBanner" role="alert" aria-live="assertive">
          <span aria-hidden="true">🎁</span> Hay una nueva versión de ChatFix disponible.
          <button className="primary" onClick={() => pwaUpdateAvailable(true)}>Actualizar ahora</button>
          <button className="secondary" onClick={() => setPwaUpdateAvailable(null)}>Ignorar</button>
        </div>
      )}
      {isOffline && (
        <div className="offlineBanner" role="alert" aria-live="assertive">
          <span aria-hidden="true">⚠️</span> Estás navegando sin conexión. Mostrando versión guardada.
        </div>
      )}
      {!isOffline && !socketConnected && (
        <div className="warningBanner" role="alert" aria-live="assertive">
          <span aria-hidden="true">⚡</span> Reconectando con el servidor...
        </div>
      )}
      {!isOffline && socketConnected && sessionStatus === "disconnected" && (
        <div className="warningBanner" role="alert" aria-live="assertive">
          <span aria-hidden="true">⚠️</span> Proveedor desconectado. Revisa la conexión en tu teléfono.
        </div>
      )}
      {!isOffline && socketConnected && sessionStatus === "connecting" && (
        <div className="infoBanner" role="status" aria-live="polite">
          <span aria-hidden="true">🔄</span> Estableciendo conexión con el proveedor...
        </div>
      )}
      <main className={`waApp ${selectedChatId || viewMode === "statuses" ? "chatOpen" : ""}`}>
        <aside className="sidebar">
        <header className="sidebarHeader">
          <h2>
            {viewMode === "statuses" ? "Estados" : "Chats"}
            {viewMode === "chats" && syncingChats && (
              <span className="syncIndicator" title="Sincronizando chats..." aria-live="polite"> 🔄</span>
            )}
          </h2>
          <div className="headerActions">
            <button
              className={`secondary ${viewMode === "statuses" ? "activeToggle" : ""}`}
              aria-label="Ver estados archivados"
              onClick={() => {
                setViewMode("statuses");
                setSelectedChatId("");
                fetchStatusArchive(false);
              }}
            >
              Estados
            </button>
            <button
              className={`secondary ${viewMode === "chats" ? "activeToggle" : ""}`}
              aria-label="Ver chats"
              onClick={() => setViewMode("chats")}
            >
              Chats
            </button>
            <button
              className="secondary"
              aria-label="Configuración de IA"
              onClick={() => {
                setShowAiSettings(true);
                fetchAiConfig();
                fetchAiModels();
              }}
            >
              ✨ IA
            </button>
            <button
              className="secondary"
              aria-label="Actualizar chats"
              onClick={() => fetchChats(false)}
              disabled={loadingChats}
              aria-busy={loadingChats}
            >
              {loadingChats ? <><span className="buttonSpinner" aria-hidden="true" /><span className="hideOnMobile">Actualizando...</span></> : <>🔄 <span className="hideOnMobile">Actualizar</span></>}
            </button>
          </div>
        </header>

        <div className="statusBar" role="status" aria-live="polite" aria-atomic="true">
          <span className={`dot ${dotClass}`} aria-hidden="true" />
          <span className="sr-only">{socketConnected ? "Conectado al servidor." : "Desconectado del servidor."}</span>
          <span>
            {connectionLabel} · Provider: {backendStatus.providerStatus}
          </span>
          {totalUnread > 0 ? <strong className="pendingCounter" aria-label={`${totalUnread} mensajes pendientes`}>{totalUnread} pendientes</strong> : null}
        </div>

        <div className="searchWrap">
          <label htmlFor="chatSearchInput" className="sr-only">
            {viewMode === "statuses" ? "Buscar estado" : "Buscar chat"}
          </label>
          <input
            id="chatSearchInput"
            ref={searchInputRef}
            type="text"
            value={chatSearch}
            onChange={(e) => setChatSearch(e.target.value)}
            placeholder={viewMode === "statuses" ? "🔍 Buscar estado..." : "🔍 Buscar chat... (Ctrl+K)"}
          />
        </div>

        <div className="chatList">
          {viewMode === "statuses" ? filteredStatusArchive.map((item) => (
            <button
              key={item._id || item.id || item.providerStatusMessageId}
              className="chatItem statusArchiveSidebarItem"
              onClick={() => setSelectedChatId("")}
            >
              <div className="chatAvatar statusArchiveThumb" aria-hidden="true">
                {(item.imageUrl || item.mediaUrl) ? (
                  <img
                    className="chatAvatarImg"
                    src={item.mediaUrl ? `${API_URL}${item.mediaUrl}` : `${API_URL}${item.imageUrl}`}
                    alt={`Estado de ${item.statusOwnerName || item.statusOwnerId}`}
                    loading="lazy"
                  />
                ) : "ST"}
              </div>
              <div className="chatText">
                <div className="chatNameRow">
                  <div className="chatName">{item.statusOwnerName || item.statusOwnerId || "Estado"}</div>
                  <div className="chatTopMeta">
                    {item.timestamp ? <time className="chatTime">{formatChatTime(item.timestamp)}</time> : null}
                  </div>
                </div>
                <div className="chatMeta">{item.description || "Estado sin descripción"}</div>
              </div>
            </button>
          )) : filteredChats.map((chat) => (
            <button
              key={chat.id}
              aria-label={`Chat con ${chat.name || chat.id}`}
              className={`chatItem ${chat.id === selectedChatId ? "active" : ""}`}
              onClick={() => setSelectedChatId(chat.id)}
              aria-current={chat.id === selectedChatId ? "page" : undefined}
            >
              <div
                className="chatAvatar"
                style={!chat.avatarUrl ? { background: getAvatarGradient(chat.id) } : {}}
                aria-hidden="true"
              >
                {chat.avatarUrl ? (
                  <img
                    className="chatAvatarImg"
                    src={chat.avatarUrl}
                    alt={`Foto de ${chat.name || chat.id}`}
                    loading="lazy"
                  />
                ) : (
                  initialsForChat(chat)
                )}
              </div>
              <div className="chatText">
                <div className="chatNameRow">
                  <div className="chatName">{chat.name || chat.id}</div>
                  <div className="chatTopMeta">
                    {chat.timestamp ? <time className="chatTime">{formatChatTime(chat.timestamp)}</time> : null}
                    {chat.isGroup ? <span className="chatKindBadge">Grupo</span> : null}
                    {chat.unreadCount > 0 ? (
                      <span className="unreadBadge">{chat.unreadCount}</span>
                    ) : null}
                  </div>
                </div>
                <div className="chatMeta">
                  {chat.unreadCount
                    ? `${chat.isGroup ? "Grupo" : "Directo"} · Sin contestar`
                    : `${chat.isGroup ? "Grupo" : "Directo"} · Sin notificaciones`}
                </div>
              </div>
            </button>
          ))}
          {viewMode === "statuses" && filteredStatusArchive.length === 0 ? (
            <p className="helper">{loadingStatusArchive ? "Cargando estados..." : "No hay estados archivados."}</p>
          ) : null}
          {viewMode === "chats" && filteredChats.length === 0 ? <p className="helper">No hay chats.</p> : null}
        </div>
        <footer className="sidebarFooter">
          <span>Ctrl+K buscar</span>
          <span>Alt+↑↓ navegar</span>
          <button className="logoutBtn" onClick={handleLogout} aria-label="Cerrar sesión">Cerrar sesión</button>
        </footer>
      </aside>

      <section className="chatPanel">
        {viewMode === "statuses" ? (
          <>
            <header className="chatHeader">
              <div className="chatHeaderLeft">
                <button
                  className="secondary mobileBackBtn"
                  aria-label="Volver a la lista"
                  onClick={() => setViewMode("chats")}
                >
                  ←
                </button>
                <div className="chatHeaderAvatar statusArchivePanelIcon" aria-hidden="true">ST</div>
                <div className="chatHeaderInfo">
                  <h3>Estados archivados</h3>
                  <p>
                    {backendStatus.statusArchive?.lastRunAt
                      ? `Última revisión ${new Date(backendStatus.statusArchive.lastRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : "Escaneo automático cada minuto"}
                  </p>
                </div>
              </div>
              <div className="chatHeaderActions">
                <button
                  className="secondary"
                  aria-label="Actualizar estados archivados"
                  onClick={() => fetchStatusArchive(false)}
                  disabled={loadingStatusArchive}
                  aria-busy={loadingStatusArchive}
                >
                  {loadingStatusArchive ? <><span className="buttonSpinner" aria-hidden="true" /><span className="hideOnMobile">Actualizando...</span></> : <>🔄 <span className="hideOnMobile">Actualizar</span></>}
                </button>
              </div>
            </header>

            <div className="messagesArea statusArchiveArea">
              {loadingStatusArchive ? <p className="helper">Cargando estados archivados...</p> : null}
              {!loadingStatusArchive && filteredStatusArchive.length === 0 ? (
                <p className="helper">Todavía no hay estados con imagen archivados.</p>
              ) : null}
              <div className="statusArchiveGrid">
                {filteredStatusArchive.map((item) => (
                  <article key={item._id || item.id || item.providerStatusMessageId} className="statusArchiveCard">
                    {item.mediaType === "video" && item.mediaUrl ? (
                      <video className="statusArchiveImage" src={`${API_URL}${item.mediaUrl}`} controls />
                    ) : (item.imageUrl || item.mediaUrl) ? (
                      <img
                        className="statusArchiveImage"
                        src={item.mediaUrl ? `${API_URL}${item.mediaUrl}` : `${API_URL}${item.imageUrl}`}
                        alt={`Estado de ${item.statusOwnerName || item.statusOwnerId}`}
                        loading="lazy"
                      />
                    ) : (
                      <div className="statusArchiveImage statusArchiveImageFallback">Sin imagen</div>
                    )}
                    <div className="statusArchiveBody">
                      <div className="statusArchiveCardHeader">
                        <h4>{item.statusOwnerName || item.statusOwnerId || "Estado"}</h4>
                        <time>{formatStatusDate(item.timestamp)}</time>
                      </div>
                      <p className="statusArchiveDescription">{item.description || "Sin descripción"}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <header className="chatHeader">
              <div className="chatHeaderLeft">
                <button
                  className="secondary mobileBackBtn"
                  aria-label="Volver a lista de chats"
                  onClick={() => setSelectedChatId("")}
                >
                  ←
                </button>
                <div
                  className="chatHeaderAvatar"
                  style={!selectedChat?.avatarUrl ? { background: getAvatarGradient(selectedChat?.id) } : {}}
                  aria-hidden="true"
                >
                  {selectedChat?.avatarUrl ? (
                    <img
                      className="chatAvatarImg"
                      src={selectedChat.avatarUrl}
                      alt={`Foto de ${selectedChat.name || selectedChat.id}`}
                      loading="lazy"
                    />
                  ) : (
                    initialsForChat(selectedChat)
                  )}
                </div>
                <div className="chatHeaderInfo">
                  <h3>{selectedChat?.name || "Seleccioná un chat"}</h3>
                  <p>
                    {selectedChat?.id || "Sin chat seleccionado"}
                    {selectedChat?.isGroup ? " · Grupo" : ""}
                  </p>
                </div>
              </div>
              <div className="chatHeaderActions">
                <button
                  className="secondary"
                  aria-label="Ver recursos del contacto"
                  onClick={fetchResources}
                  disabled={!selectedChatId}
                >
                  📂 <span className="hideOnMobile">Recursos</span>
                </button>
                <button
                  className="secondary"
                  aria-label="Recargar mensajes"
                  onClick={() => fetchMessages(selectedChatId, { withLoader: true })}
                  disabled={!selectedChatId || loadingMessages[selectedChatId]}
                  aria-busy={loadingMessages[selectedChatId]}
                >
                  {loadingMessages[selectedChatId] ? <><span className="buttonSpinner" aria-hidden="true" /><span className="hideOnMobile">Recargando...</span></> : <>🔄 <span className="hideOnMobile">Recargar</span></>}
                </button>
              </div>
            </header>

            <div
              className="messagesArea"
              ref={messagesAreaRef}
              onScroll={handleMessagesScroll}
            >
              {loadingMessages[selectedChatId] && messages.length === 0 ? (
                <>
                  <div className="skeleton-msg"></div>
                  <div className="skeleton-msg"></div>
                  <div className="skeleton-msg"></div>
                </>
              ) : null}
              {!loadingMessages[selectedChatId] && syncingChat && messages.length === 0 ? <p className="helper">Sincronizando...</p> : null}
              {!loadingMessages[selectedChatId] && !syncingChat && messages.length === 0 ? (
                <p className="helper">Este chat todavía no tiene mensajes visibles.</p>
              ) : null}

              {messages.map((msg, idx) => {
                const prevMsg = messages[idx - 1];
                const isConsecutive = prevMsg && prevMsg.fromMe === msg.fromMe;
                return (
                <div key={msg._uiId} className={`bubbleRow ${msg.fromMe ? "mine" : "theirs"} ${isConsecutive ? "consecutive" : ""} ${msg.isRevoked ? "revokedRow" : ""}`}>
                  <article
                    className={`bubble ${
                      !msg.fromMe && grammarInsights[msg._uiId]?.hasErrors ? "incomingGrammarError" : ""
                    } ${msg.isRevoked ? "isRevoked" : ""}`}
                    tabIndex={!msg.fromMe && grammarInsights[msg._uiId]?.hasErrors ? 0 : undefined}
                    role={!msg.fromMe && grammarInsights[msg._uiId]?.hasErrors ? "button" : undefined}
                    onClick={
                      !msg.fromMe && grammarInsights[msg._uiId]?.hasErrors
                        ? () => prepareGrammarReply(msg)
                        : undefined
                    }
                    onKeyDown={
                      !msg.fromMe && grammarInsights[msg._uiId]?.hasErrors
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              prepareGrammarReply(msg);
                            }
                          }
                        : undefined
                    }
                  >
                    {msg.replyToText ? (
                      <div className="replyPreview">
                        <span className="replyLabel">Respuesta a</span>
                        <p>{msg.replyToText}</p>
                      </div>
                    ) : null}
                    {!msg.fromMe && grammarInsights[msg._uiId]?.hasErrors ? (
                      <span className="grammarErrorBadge">Posibles errores gramaticales · Presionar para responder</span>
                    ) : null}
                    {!msg.fromMe && Array.isArray(msg.mentionedIds) && msg.mentionedIds.length > 0 ? (
                      <span className="pingBadge">Ping</span>
                    ) : null}
                    {msg.isRevoked ? (
                      <div className="revokedNotice">🗑️ Mensaje eliminado</div>
                    ) : null}
                    {msg.mediaType === "image" && (msg.imageDataUrl || msg.mediaUrl) ? (
                      <img className="msgImage" src={msg.mediaUrl ? `${API_URL}${msg.mediaUrl}` : msg.imageDataUrl} alt="Imagen del chat" />
                    ) : null}
                    {msg.mediaType === "video" && msg.mediaUrl ? (
                      <video className="msgVideo" src={`${API_URL}${msg.mediaUrl}`} controls />
                    ) : null}
                    {msg.mediaType === "audio" && msg.mediaUrl ? (
                      <audio className="msgAudio" src={`${API_URL}${msg.mediaUrl}`} controls />
                    ) : null}
                    <p className={msg.isRevoked ? "revokedText" : ""}>{msg.body || "[mensaje vacío]"}</p>
                    <div className="bubbleMeta">
                      <time>{formatTime(msg.timestamp)}</time>
                      {msg.fromMe && <AckIcon status={msg.status || msg.ack} />}
                    </div>
                    <div className="bubbleActions">
                      <button
                        className="replyBtn"
                        aria-label="Responder a este mensaje"
                        onClick={(e) => {
                          e.stopPropagation();
                          startReply(msg);
                        }}
                      >
                        Responder
                      </button>
                    </div>
                  </article>
                </div>
              );})}
              {showJumpToLatest ? (
                <button
                  className="jumpToLatest"
                  aria-label="Ir al último mensaje"
                  onClick={() => scrollMessagesToBottom("smooth")}
                >
                  ↓ Ir al último
                  {pendingIncomingCount > 0 ? (
                    <span className="jumpToLatestCount">{pendingIncomingCount}</span>
                  ) : null}
                </button>
              ) : null}
            </div>

            <footer className="composer">
              {replyQueue.length > 0 ? (
                <section className="multiReplyPanel">
                  <div className="multiReplyHeader">
                    <p>{replyQueue.length} respuestas en paralelo listas</p>
                    <button
                      className="primary"
                      aria-label="Enviar todas las respuestas en cola"
                      onClick={sendAllQueuedReplies}
                    >
                      Enviar todas
                    </button>
                  </div>
                  {replyQueue.map((item) => (
                    <article key={item.localId} className="queuedReplyCard">
                      <p className="queuedReplyLabel">Respuesta sugerida</p>
                      <p className="queuedReplyOriginal">{item.original}</p>
                      <textarea
                        value={item.text}
                        onChange={(e) => updateQueuedReplyText(item.localId, e.target.value)}
                        rows={2}
                      />
                      <div className="composerActions">
                        <button
                          className="primary"
                          aria-label="Enviar respuesta sugerida"
                          disabled={Boolean(sendingReplyQueueIds[item.localId]) || !item.text.trim()}
                          onClick={() => sendQueuedReply(item)}
                          aria-busy={Boolean(sendingReplyQueueIds[item.localId])}
                        >
                          {sendingReplyQueueIds[item.localId] ? <><span className="buttonSpinner" aria-hidden="true" /><span>Enviando...</span></> : "Enviar"}
                        </button>
                        <button
                          className="secondary"
                          aria-label="Editar respuesta en el editor principal"
                          onClick={() => loadQueuedReplyToComposer(item)}
                        >
                          Editar en editor
                        </button>
                        <button
                          className="secondary"
                          aria-label="Quitar respuesta de la cola"
                          onClick={() => removeQueuedReply(item.localId)}
                        >
                          Quitar
                        </button>
                      </div>
                    </article>
                  ))}
                </section>
              ) : null}

              {replyTarget ? (
                <div className="replyTarget">
                  <div>
                    <p className="replyTargetLabel">
                      Respondiendo a {replyTarget.fromMe ? "tu mensaje" : "mensaje recibido"}
                    </p>
                    <p className="replyTargetText">{replyTarget.text}</p>
                  </div>
                  <button
                    className="secondary"
                    aria-label="Cancelar respuesta"
                    onClick={() => setReplyTarget(null)}
                  >
                    Cancelar
                  </button>
                </div>
              ) : null}

              {/* Removed redundant syncingChat badge here to prevent layout shift; it's already in the header */}
              <div className={`composerInputWrapper ${correctedDraft ? "hasCorrection" : ""} ${correcting || correctingAndSending ? "isCorrecting" : ""}`}>
                {correctedDraft && <span className="composerOriginalLabel">Tu borrador original (modificarlo descartará la sugerencia IA)</span>}
                <textarea
                  ref={draftInputRef}
                  value={draft}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDraft(val);
                    if (correctedDraft) setCorrectedDraft("");

                    if (debouncedDraftRef.current) clearTimeout(debouncedDraftRef.current);
                    if (val.trim().length > 5) {
                      debouncedDraftRef.current = setTimeout(() => {
                        // Live correction trigger could go here (if requested to auto-correct)
                      }, 1000);
                    }
                  }}
                  onKeyDown={handleDraftKeyDown}
                  placeholder={correctedDraft ? "Escribí un mensaje... (Enter: enviar versión IA | Ctrl+Enter: enviar original)" : "Escribí un mensaje... (Enter: mejorar y enviar | Ctrl+Enter: enviar original sin revisar)"}
                  rows={3}
                  aria-label="Mensaje"
                  disabled={sending || correcting || correctingAndSending}
                />
              </div>

              {correctedDraft ? (
                <div className="correctedPreview">
                  <div className="correctedHeader">
                    <p className="correctedLabel">✨ Versión sugerida por IA</p>
                    <div className="correctedHeaderActions">
                      <button
                        className="iconButton"
                        onClick={() => setCorrectedDraft("")}
                        aria-label="Descartar sugerencia"
                        title="Descartar"
                      >
                        ❌
                      </button>
                    </div>
                  </div>
                  <p className="correctedText">{correctedDraft}</p>

                  <div className="correctedActions">
                    <button
                      className="primary sendCorrectedBtn"
                      aria-label="Enviar la sugerencia de IA"
                      onClick={() => sendMessage(correctedDraft, "corrected")}
                    >
                      ✨ Enviar versión IA
                    </button>
                    <button
                      className="secondary useCorrectedBtn"
                      onClick={() => {
                        setDraft(correctedDraft);
                        setCorrectedDraft("");
                      }}
                      aria-label="Usar sugerencia en el cuadro principal para editar"
                    >
                      ✏️ <span className="hideOnMobile">Usar y editar</span>
                    </button>
                  </div>
                </div>
              ) : null}

              {(sending || correcting || correctingAndSending || syncingChat) ? (
                <div className={`activityStateBadge ${correctingAndSending ? "processingAndSending" : correcting ? "processing" : sending ? "sending" : "syncing"}`}>
                  {(syncingChat && !sending && !correcting && !correctingAndSending) ? (
                    <>
                      <span className="syncSpinner" aria-hidden="true" />
                      <span>Sincronizando chat en segundo plano...</span>
                    </>
                  ) : (
                    <>
                      <span className="spinner" aria-hidden="true" />
                      <span>{correctingAndSending ? "✨ Mejorando y enviando..." : correcting ? "✨ Mejorando redacción..." : sendingType === 'corrected' || sendingType === 'correctedAndSending' ? "✨ Enviando versión IA..." : "📤 Enviando mensaje original..."}</span>
                    </>
                  )}
                </div>
              ) : null}

              {!(sending || correcting || correctingAndSending) ? (
                <div className="composerActions">
                  {!correctedDraft ? (
                    <>
                      <button
                        className="primary"
                        aria-label="Mejorar redacción con IA y enviar"
                        onClick={correctAndSend}
                        disabled={!draft.trim()}
                      >
                        🚀 <span className="hideOnMobile">Mejorar y enviar</span>
                      </button>
                      <button
                        className="secondary"
                        aria-label="Previsualizar corrección de IA sin enviar"
                        onClick={correctDraft}
                        disabled={!draft.trim()}
                      >
                        ✨ <span className="hideOnMobile">Ver sugerencia</span>
                      </button>
                      <button
                        className="secondary plainSendBtn"
                        aria-label="Enviar mensaje original sin revisar"
                        onClick={() => sendMessage(draft, "original")}
                        disabled={!draft.trim()}
                      >
                        📤 <span className="hideOnMobile">Enviar original</span>
                      </button>
                    </>
                  ) : (
                    <button
                      className="secondary plainSendBtn"
                      aria-label="Enviar el texto original, descartando la sugerencia"
                      onClick={() => sendMessage(draft, "original")}
                      disabled={!draft.trim()}
                    >
                      📤 <span className="hideOnMobile">Descartar IA y enviar original</span>
                    </button>
                  )}
                </div>
              ) : null}


            </footer>
          </>
        )}
      </section>

      {showResources ? (
        <section className="modalOverlay" onClick={() => setShowResources(false)}>
          <div
            className="modalCard resourcesModal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="resourcesModalHeading"
          >
            <div className="modalHeader">
              <h3 id="resourcesModalHeading">Recursos de {selectedChat?.name || selectedChatId}</h3>
              <button className="secondary" onClick={() => setShowResources(false)}>Cerrar</button>
            </div>

            {loadingResources ? <p className="helper">Cargando recursos...</p> : (
              <div className="resourcesContent">
                <section className="resourceSection">
                  <h4>📁 Media ({resources.media.length})</h4>
                  <div className="resourceGrid">
                    {resources.media.map(m => (
                      <div key={m._id || m.id || m.providerMessageId} className="resourceItem">
                        {m.mediaType === 'image' ? (
                          <img src={`${API_URL}${m.mediaUrl}`} alt="media" />
                        ) : m.mediaType === 'video' ? (
                          <video src={`${API_URL}${m.mediaUrl}`} controls />
                        ) : (
                          <div className="mediaFallback">{m.mediaType}</div>
                        )}
                        <time>{formatTime(m.timestamp)}</time>
                      </div>
                    ))}
                    {resources.media.length === 0 && <p className="helper">No hay media.</p>}
                  </div>
                </section>

                <section className="resourceSection">
                  <h4>🔗 Enlaces ({resources.links.length})</h4>
                  <ul className="resourceList">
                    {resources.links.map((link, i) => (
                      <li key={i}>
                        <a href={link.url} target="_blank" rel="noopener noreferrer">{link.url}</a>
                        <time>{formatTime(link.timestamp)}</time>
                      </li>
                    ))}
                    {resources.links.length === 0 && <p className="helper">No hay enlaces.</p>}
                  </ul>
                </section>

                <section className="resourceSection">
                  <h4>📱 Estados Archivados ({resources.statuses.length})</h4>
                  <div className="resourceGrid">
                    {resources.statuses.map(s => (
                      <div key={s._id || s.id || s.providerStatusMessageId} className="resourceItem">
                         {s.mediaType === 'video' ? (
                          <video src={`${API_URL}${s.mediaUrl}`} controls />
                        ) : s.mediaUrl ? (
                          <img src={`${API_URL}${s.mediaUrl}`} alt="status" />
                        ) : (
                          <div className="mediaFallback">Texto</div>
                        )}
                        <time>{formatTime(s.timestamp)}</time>
                      </div>
                    ))}
                    {resources.statuses.length === 0 && <p className="helper">No hay estados.</p>}
                  </div>
                </section>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {showAiSettings ? (
        <section className="modalOverlay" onClick={() => setShowAiSettings(false)}>
          <div
            className="modalCard"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="aiSettingsModalHeading"
          >
            <div className="modalHeader">
              <h3 id="aiSettingsModalHeading">Configuración IA</h3>
              <button className="secondary" onClick={() => setShowAiSettings(false)}>Cerrar</button>
            </div>
            {loadingAiConfig ? <p className="helper">Cargando configuración...</p> : null}

            <label htmlFor="aiProvider">Proveedor</label>
            <select
              id="aiProvider"
              value={aiConfig.provider}
              onChange={(e) => setAiConfig((prev) => ({ ...prev, provider: e.target.value }))}
            >
              <option value="lmstudio">LM Studio (local)</option>
              <option value="cloudflare">Cloudflare AI</option>
            </select>

            <label htmlFor="aiEndpoint">Endpoint activo</label>
            <input id="aiEndpoint" value={aiConfig.aiBaseUrl} readOnly />

            {aiConfig.provider === "lmstudio" ? (
              <>
                <label htmlFor="lmStudioBaseUrl">URL LM Studio</label>
                <input
                  id="lmStudioBaseUrl"
                  value={aiConfig.lmStudioBaseUrl}
                  spellCheck="false"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  onChange={(e) =>
                    setAiConfig((prev) => ({ ...prev, lmStudioBaseUrl: e.target.value }))
                  }
                />
              </>
            ) : (
              <>
                <label htmlFor="cfAccountId">Cloudflare Account ID</label>
                <input
                  id="cfAccountId"
                  value={aiConfig.cloudflareAccountId}
                  spellCheck="false"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  onChange={(e) =>
                    setAiConfig((prev) => ({ ...prev, cloudflareAccountId: e.target.value }))
                  }
                />

                <label htmlFor="cfApiToken">Cloudflare API Token</label>
                <div className="passwordInputWrapper">
                  <input
                    id="cfApiToken"
                    type={showCloudflareToken ? "text" : "password"}
                    value={aiConfig.cloudflareApiToken}
                    spellCheck="false"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    onChange={(e) =>
                      setAiConfig((prev) => ({ ...prev, cloudflareApiToken: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="passwordToggleBtn" aria-pressed={showCloudflareToken}
                    onClick={() => setShowCloudflareToken(!showCloudflareToken)}
                    aria-label={showCloudflareToken ? "Ocultar Cloudflare Token" : "Mostrar Cloudflare Token"}
                  >
                    {showCloudflareToken ? "🙈" : "👁️"}
                  </button>
                </div>

                <label htmlFor="cfBaseUrl">Cloudflare Base URL (opcional)</label>
                <input
                  id="cfBaseUrl"
                  value={aiConfig.cloudflareBaseUrl}
                  spellCheck="false"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  onChange={(e) =>
                    setAiConfig((prev) => ({ ...prev, cloudflareBaseUrl: e.target.value }))
                  }
                  placeholder="https://api.cloudflare.com/client/v4/accounts/{account_id}/ai"
                />
              </>
            )}

            <label htmlFor="aiModel">Modelo</label>
            <select
              id="aiModel"
              value={aiConfig.modelName}
              onChange={(e) => setAiConfig((prev) => ({ ...prev, modelName: e.target.value }))}
            >
              <option value="">Seleccionar modelo...</option>
              {aiModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <label htmlFor="aiModelInput" className="sr-only">Modelo (texto)</label>
            <input
              id="aiModelInput"
              value={aiConfig.modelName}
              spellCheck="false"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              onChange={(e) => setAiConfig((prev) => ({ ...prev, modelName: e.target.value }))}
            />

            <label htmlFor="aiTemperature">Temperatura</label>
            <input
              id="aiTemperature"
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={aiConfig.temperature}
              onChange={(e) =>
                setAiConfig((prev) => ({ ...prev, temperature: Number(e.target.value) }))
              }
            />

            <label htmlFor="aiTimeoutMs">Timeout IA (ms)</label>
            <input
              id="aiTimeoutMs"
              type="number"
              min="5000"
              step="1000"
              value={aiConfig.timeoutMs}
              onChange={(e) =>
                setAiConfig((prev) => ({ ...prev, timeoutMs: Number(e.target.value) }))
              }
            />

            <label htmlFor="aiMaxTokens">Max tokens</label>
            <input
              id="aiMaxTokens"
              type="number"
              min="32"
              max="2048"
              step="1"
              value={aiConfig.maxTokens}
              onChange={(e) =>
                setAiConfig((prev) => ({ ...prev, maxTokens: Number(e.target.value) }))
              }
            />

            <label htmlFor="aiSystemPrompt">Prompt de sistema</label>
            <textarea
              id="aiSystemPrompt"
              rows={4}
              value={aiConfig.systemPrompt}
              onChange={(e) => setAiConfig((prev) => ({ ...prev, systemPrompt: e.target.value }))}
            />

            <label htmlFor="aiUserPrompt">Prompt de usuario (usar {`{{text}}`})</label>
            <textarea
              id="aiUserPrompt"
              rows={5}
              value={aiConfig.userPromptTemplate}
              onChange={(e) =>
                setAiConfig((prev) => ({ ...prev, userPromptTemplate: e.target.value }))
              }
            />

            <div className="composerActions">
              <button
                className="secondary"
                aria-label="Probar conexión con IA"
                onClick={checkAiHealth}
                disabled={checkingAiHealth}
                aria-busy={checkingAiHealth}
              >
                {checkingAiHealth ? <><span className="buttonSpinner" aria-hidden="true" /><span>Probando...</span></> : "Probar conexión"}
              </button>
              <button
                className="primary"
                aria-label="Guardar configuración de IA"
                onClick={saveAiConfig}
                disabled={savingAiConfig}
                aria-busy={savingAiConfig}
              >
                {savingAiConfig ? <><span className="buttonSpinner" aria-hidden="true" /><span>Guardando...</span></> : "Guardar"}
              </button>
            </div>

            {aiHealth ? (
              <p className={`notice ${aiHealth.ok ? "success" : "error"}`}>{aiHealth.message}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {toasts.length > 0 && (
        <div className="toast-container" aria-live="polite">
          {toasts.map(t => (
            <div key={t.id} className={`toast ${t.type}`}>
              {t.text}
            </div>
          ))}
        </div>
      )}
      </main>
    </>
  );
}

export default App;
