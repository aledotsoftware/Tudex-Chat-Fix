import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import QRCode from "react-qr-code";

const runtimeHost =
  typeof window !== "undefined" ? window.location.hostname : "localhost";
const runtimeProtocol =
  typeof window !== "undefined" ? window.location.protocol : "http:";
const defaultApiUrl = `${runtimeProtocol}//${runtimeHost}:3001`;

const API_URL = import.meta.env.VITE_API_URL || defaultApiUrl;
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || defaultApiUrl;

function formatTime(unixTs) {
  const value = Number(unixTs) || Math.floor(Date.now() / 1000);
  return new Date(value * 1000).toLocaleTimeString([], {
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

function App() {
  const socketRef = useRef(null);
  const selectedChatIdRef = useRef("");
  const messagesEndRef = useRef(null);
  const messageFetchReqIdRef = useRef(0);
  const grammarCheckInFlightRef = useRef(new Set());
  const grammarQueueRef = useRef([]);
  const grammarQueueSetRef = useRef(new Set());
  const grammarWorkersRef = useRef(0);
  const grammarInsightsRef = useRef({});
  const grammarFailuresRef = useRef(0);
  const grammarCooldownUntilRef = useRef(0);
  const grammarCooldownNoticeRef = useRef(0);
  const draftInputRef = useRef(null);

  const [sessionStatus, setSessionStatus] = useState("connecting");
  const [socketConnected, setSocketConnected] = useState(false);
  const [qr, setQr] = useState("");
  const [backendStatus, setBackendStatus] = useState({
    whatsappStatus: "unknown",
    uptimeSec: 0
  });

  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState("info");

  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [correctingAndSending, setCorrectingAndSending] = useState(false);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [loadingAiConfig, setLoadingAiConfig] = useState(false);
  const [savingAiConfig, setSavingAiConfig] = useState(false);
  const [checkingAiHealth, setCheckingAiHealth] = useState(false);
  const [aiHealth, setAiHealth] = useState(null);
  const [aiModels, setAiModels] = useState([]);

  const [chatSearch, setChatSearch] = useState("");
  const [chats, setChats] = useState([]);
  const [messagesByChat, setMessagesByChat] = useState({});
  const [selectedChatId, setSelectedChatId] = useState("");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [correctedDraft, setCorrectedDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState(null);
  const [grammarInsights, setGrammarInsights] = useState({});
  const [replyQueue, setReplyQueue] = useState([]);
  const [sendingReplyQueueIds, setSendingReplyQueueIds] = useState({});
  const [syncingChat, setSyncingChat] = useState(false);
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
    timeoutMs: 90000,
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

  const connectionLabel = useMemo(() => {
    if (!socketConnected) return "Socket desconectado";
    if (sessionStatus === "authenticated") return "Conectado";
    if (sessionStatus === "qr") return "Esperando escaneo QR";
    if (sessionStatus === "auth_failure") return "Error de autenticación";
    if (sessionStatus === "disconnected") return "WhatsApp desconectado";
    return "Conectando sesión...";
  }, [sessionStatus, socketConnected]);

  const activityState = useMemo(() => {
    if (correctingAndSending) {
      return { type: "loading", text: "Generando con IA y enviando..." };
    }
    if (correcting) {
      return { type: "loading", text: "Generando corrección con IA..." };
    }
    if (sending) {
      return { type: "loading", text: "Enviando mensaje..." };
    }
    if (syncingChat) {
      return { type: "info", text: "Sincronizando chat en segundo plano..." };
    }
    return null;
  }, [correctingAndSending, correcting, sending, syncingChat]);

  function showNotice(text, type = "info") {
    setNotice(text);
    setNoticeType(type);
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

  function runGrammarQueue() {
    if (Date.now() < grammarCooldownUntilRef.current) return;
    const maxWorkers = 2;
    while (grammarWorkersRef.current < maxWorkers && grammarQueueRef.current.length > 0) {
      const nextMsg = grammarQueueRef.current.shift();
      grammarWorkersRef.current += 1;
      checkGrammarForMessage(nextMsg).finally(() => {
        grammarWorkersRef.current -= 1;
        runGrammarQueue();
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

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
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
    socket.on("qr", (value) => {
      setQr(value);
      setSessionStatus("qr");
    });
    socket.on("ready", () => {
      setQr("");
      setSessionStatus("authenticated");
    });
    socket.on("auth_failure", () => {
      setSessionStatus("auth_failure");
      showNotice("Fallo de autenticación de WhatsApp.", "error");
    });
    socket.on("disconnected", () => {
      setSessionStatus("disconnected");
      showNotice("La sesión de WhatsApp se desconectó.", "error");
    });
    socket.on("new_message", mergeLiveMessage);

    return () => {
      socket.off("new_message", mergeLiveMessage);
      socket.close();
    };
  }, []);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
    setReplyTarget(null);
    setReplyQueue([]);
    setSendingReplyQueueIds({});
  }, [selectedChatId]);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    fetchChats(true);
  }, [sessionStatus]);

  useEffect(() => {
    if (!selectedChatId || sessionStatus !== "authenticated") return;
    const timer = setInterval(() => {
      fetchMessages(selectedChatId, { withLoader: false, background: true });
    }, 15000);
    return () => clearInterval(timer);
  }, [selectedChatId, sessionStatus]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_URL}/api/status`);
        if (!res.ok) return;
        const data = await res.json();
        setBackendStatus({
          whatsappStatus: data.whatsappStatus || "unknown",
          uptimeSec: Number(data.uptimeSec || 0)
        });
      } catch (_error) {
        // silent on status poll
      }
    };
    fetchStatus();
    const timer = setInterval(fetchStatus, 10000);
    return () => clearInterval(timer);
  }, []);

  async function fetchChats(selectFirst = false) {
    setLoadingChats(true);
    try {
      const res = await fetch(`${API_URL}/api/chats`);
      if (!res.ok) throw new Error("No se pudieron cargar los chats.");

      const data = await res.json();
      const safeChats = (Array.isArray(data) ? data : []).sort(
        (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)
      );

      setChats(safeChats);

      if (safeChats.length === 0) {
        setSelectedChatId("");
        setMessages([]);
        return;
      }

      const exists = safeChats.some((chat) => chat.id === selectedChatIdRef.current);
      const nextChatId = exists ? selectedChatIdRef.current : safeChats[0].id;

      if (selectFirst || !selectedChatIdRef.current || !exists) {
        setSelectedChatId(nextChatId);
        const cached = messagesByChat[nextChatId];
        if (cached) {
          setMessages(cached);
          fetchMessages(nextChatId, { withLoader: false, background: true });
        } else {
          await fetchMessages(nextChatId, { withLoader: true });
        }
      }
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setLoadingChats(false);
    }
  }

  async function fetchMessages(chatId, options = {}) {
    const { withLoader = true, background = false } = options;
    if (!chatId) return;
    const reqId = ++messageFetchReqIdRef.current;
    if (withLoader) setLoadingMessages(true);
    if (background) setSyncingChat(true);
    try {
      const res = await fetch(`${API_URL}/api/chats/${encodeURIComponent(chatId)}/messages`);
      if (!res.ok) throw new Error("No se pudieron cargar los mensajes.");
      const data = await res.json();
      if (reqId !== messageFetchReqIdRef.current) return;
      const safeMessages = (Array.isArray(data) ? data : [])
        .map((msg) => ({ ...msg, _uiId: messageId(msg) }))
        .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
      setMessagesByChat((prev) => ({ ...prev, [chatId]: safeMessages }));
      if (selectedChatIdRef.current === chatId) {
        setMessages(safeMessages);
      }
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      if (withLoader) setLoadingMessages(false);
      if (background) setSyncingChat(false);
    }
  }

  async function markChatAsRead(chatId) {
    if (!chatId) return;
    try {
      await fetch(`${API_URL}/api/chats/${encodeURIComponent(chatId)}/read`, {
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
      showNotice("Texto corregido listo para enviar.", "success");
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
      await sendMessage(corrected);
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
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

  async function sendMessage(textToSend) {
    if (!String(textToSend || "").trim()) return;
    setSending(true);
    try {
      const ok = await postSendMessage({
        text: textToSend,
        originalText: draft || textToSend,
        replyToMessageId: replyTarget?.id || ""
      });
      if (!ok) return;
      setDraft("");
      setCorrectedDraft("");
      setReplyTarget(null);
      showNotice("Mensaje enviado.", "success");
      await fetchMessages(selectedChatId, { withLoader: false, background: true });
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setSending(false);
    }
  }

  function handleDraftKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!sending && !correcting && !correctingAndSending && draft.trim()) {
        correctAndSend();
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

  if (sessionStatus !== "authenticated") {
    return (
      <main className="authScreen">
        <section className="authCard">
          <h1>ChatFix</h1>
          <p>{connectionLabel}</p>
          {qr ? (
            <div className="qrBox">
              <QRCode value={qr} size={230} />
            </div>
          ) : (
            <button className="primary" onClick={() => fetchChats(true)}>
              Reintentar
            </button>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="waApp">
      <aside className="sidebar">
        <header className="sidebarHeader">
          <h2>Chats</h2>
          <div className="headerActions">
            <button
              className="secondary"
              onClick={() => {
                setShowAiSettings(true);
                fetchAiConfig();
                fetchAiModels();
              }}
            >
              IA
            </button>
            <button className="secondary" onClick={() => fetchChats(false)} disabled={loadingChats}>
              {loadingChats ? "Cargando..." : "Actualizar"}
            </button>
          </div>
        </header>

        <div className="statusBar">
          <span className={`dot ${socketConnected ? "ok" : "bad"}`} />
          <span>
            {connectionLabel} · WA: {backendStatus.whatsappStatus}
          </span>
          {totalUnread > 0 ? <strong className="pendingCounter">{totalUnread} pendientes</strong> : null}
        </div>

        <div className="searchWrap">
          <input
            type="text"
            value={chatSearch}
            onChange={(e) => setChatSearch(e.target.value)}
            placeholder="Buscar chat..."
          />
        </div>

        <div className="chatList">
          {filteredChats.map((chat) => (
            <button
              key={chat.id}
              className={`chatItem ${chat.id === selectedChatId ? "active" : ""}`}
              onClick={() => {
                setSelectedChatId(chat.id);
                setChats((prev) =>
                  prev.map((item) =>
                    item.id === chat.id ? { ...item, unreadCount: 0 } : item
                  )
                );
                markChatAsRead(chat.id);
                const cached = messagesByChat[chat.id];
                if (cached) {
                  setMessages(cached);
                  fetchMessages(chat.id, { withLoader: false, background: true });
                } else {
                  setMessages([]);
                  fetchMessages(chat.id, { withLoader: true });
                }
              }}
            >
              <div className="chatAvatar">
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
                  {chat.isGroup ? <span className="chatKindBadge">Grupo</span> : null}
                  {chat.unreadCount > 0 ? (
                    <span className="unreadBadge">{chat.unreadCount}</span>
                  ) : null}
                </div>
                <div className="chatMeta">
                  {chat.unreadCount
                    ? `${chat.isGroup ? "Grupo" : "Directo"} · Sin contestar`
                    : `${chat.isGroup ? "Grupo" : "Directo"} · Sin notificaciones`}
                </div>
              </div>
            </button>
          ))}
          {filteredChats.length === 0 ? <p className="helper">No hay chats.</p> : null}
        </div>
      </aside>

      <section className="chatPanel">
        <header className="chatHeader">
          <div>
            <h3>{selectedChat?.name || "Seleccioná un chat"}</h3>
            <p>
              {selectedChat?.id || "Sin chat seleccionado"}
              {selectedChat?.isGroup ? " · Grupo" : ""}
            </p>
          </div>
          <button
            className="secondary"
            onClick={() => fetchMessages(selectedChatId, { withLoader: true })}
            disabled={!selectedChatId}
          >
            Recargar
          </button>
        </header>

        <div className="messagesArea">
          {loadingMessages ? <p className="helper">Cargando mensajes...</p> : null}
          {!loadingMessages && syncingChat ? <p className="helper">Sincronizando...</p> : null}
          {!loadingMessages && messages.length === 0 ? (
            <p className="helper">Este chat todavía no tiene mensajes visibles.</p>
          ) : null}

          {messages.map((msg) => (
            <div key={msg._uiId} className={`bubbleRow ${msg.fromMe ? "mine" : "theirs"}`}>
              <article
                className={`bubble ${
                  !msg.fromMe && grammarInsights[msg._uiId]?.hasErrors ? "incomingGrammarError" : ""
                }`}
                onClick={
                  !msg.fromMe && grammarInsights[msg._uiId]?.hasErrors
                    ? () => prepareGrammarReply(msg)
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
                  <span className="grammarErrorBadge">Posibles errores gramaticales · Tocar para responder</span>
                ) : null}
                {!msg.fromMe && Array.isArray(msg.mentionedIds) && msg.mentionedIds.length > 0 ? (
                  <span className="pingBadge">Ping</span>
                ) : null}
                {msg.mediaType === "image" && msg.imageDataUrl ? (
                  <img className="msgImage" src={msg.imageDataUrl} alt="Imagen del chat" />
                ) : null}
                <p>{msg.body || "[mensaje vacío]"}</p>
                <time>{formatTime(msg.timestamp)}</time>
                <div className="bubbleActions">
                  <button
                    className="replyBtn"
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
          ))}
          <div ref={messagesEndRef} />
        </div>

        <footer className="composer">
          {replyQueue.length > 0 ? (
            <section className="multiReplyPanel">
              <div className="multiReplyHeader">
                <p>{replyQueue.length} respuestas en paralelo listas</p>
                <button className="primary" onClick={sendAllQueuedReplies}>
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
                      disabled={Boolean(sendingReplyQueueIds[item.localId]) || !item.text.trim()}
                      onClick={() => sendQueuedReply(item)}
                    >
                      {sendingReplyQueueIds[item.localId] ? "Enviando..." : "Enviar"}
                    </button>
                    <button className="secondary" onClick={() => loadQueuedReplyToComposer(item)}>
                      Editar en editor
                    </button>
                    <button className="secondary" onClick={() => removeQueuedReply(item.localId)}>
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
              <button className="secondary" onClick={() => setReplyTarget(null)}>
                Cancelar
              </button>
            </div>
          ) : null}

          <textarea
            ref={draftInputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleDraftKeyDown}
            placeholder="Escribí un mensaje... (Enter envía, Shift+Enter salto de línea)"
            rows={3}
          />

          <div className="composerActions">
            <button className="secondary" onClick={correctDraft} disabled={correcting || !draft.trim()}>
              {correcting ? "Corrigiendo..." : "Corregir IA"}
            </button>
            <button
              className="primary"
              onClick={correctAndSend}
              disabled={sending || correcting || correctingAndSending || !draft.trim()}
            >
              {correctingAndSending ? "Corrigiendo y enviando..." : "Corregir y enviar"}
            </button>
            <button className="primary" onClick={() => sendMessage(draft)} disabled={sending || !draft.trim()}>
              {sending ? "Enviando..." : "Enviar original"}
            </button>
            <button
              className="primary"
              onClick={() => sendMessage(correctedDraft)}
              disabled={sending || !correctedDraft.trim()}
            >
              Enviar corregido
            </button>
          </div>

          {correctedDraft ? (
            <div className="correctedPreview">
              <p className="correctedLabel">Texto corregido</p>
              <p className="correctedText">{correctedDraft}</p>
            </div>
          ) : null}

          {activityState ? (
            <p className={`notice ${activityState.type}`}>
              {activityState.type === "loading" ? "Procesando. " : ""}
              {activityState.text}
            </p>
          ) : null}

          {notice ? <p className={`notice ${noticeType}`}>{notice}</p> : null}
        </footer>
      </section>

      {showAiSettings ? (
        <section className="modalOverlay" onClick={() => setShowAiSettings(false)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <h3>Configuración IA</h3>
            {loadingAiConfig ? <p className="helper">Cargando configuración...</p> : null}

            <label>Proveedor</label>
            <select
              value={aiConfig.provider}
              onChange={(e) => setAiConfig((prev) => ({ ...prev, provider: e.target.value }))}
            >
              <option value="lmstudio">LM Studio (local)</option>
              <option value="cloudflare">Cloudflare AI</option>
            </select>

            <label>Endpoint activo</label>
            <input value={aiConfig.aiBaseUrl} readOnly />

            {aiConfig.provider === "lmstudio" ? (
              <>
                <label>URL LM Studio</label>
                <input
                  value={aiConfig.lmStudioBaseUrl}
                  onChange={(e) =>
                    setAiConfig((prev) => ({ ...prev, lmStudioBaseUrl: e.target.value }))
                  }
                />
              </>
            ) : (
              <>
                <label>Cloudflare Account ID</label>
                <input
                  value={aiConfig.cloudflareAccountId}
                  onChange={(e) =>
                    setAiConfig((prev) => ({ ...prev, cloudflareAccountId: e.target.value }))
                  }
                />

                <label>Cloudflare API Token</label>
                <input
                  type="password"
                  value={aiConfig.cloudflareApiToken}
                  onChange={(e) =>
                    setAiConfig((prev) => ({ ...prev, cloudflareApiToken: e.target.value }))
                  }
                />

                <label>Cloudflare Base URL (opcional)</label>
                <input
                  value={aiConfig.cloudflareBaseUrl}
                  onChange={(e) =>
                    setAiConfig((prev) => ({ ...prev, cloudflareBaseUrl: e.target.value }))
                  }
                  placeholder="https://api.cloudflare.com/client/v4/accounts/{account_id}/ai"
                />
              </>
            )}

            <label>Modelo</label>
            <select
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
            <input
              value={aiConfig.modelName}
              onChange={(e) => setAiConfig((prev) => ({ ...prev, modelName: e.target.value }))}
            />

            <label>Temperatura</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={aiConfig.temperature}
              onChange={(e) =>
                setAiConfig((prev) => ({ ...prev, temperature: Number(e.target.value) }))
              }
            />

            <label>Timeout IA (ms)</label>
            <input
              type="number"
              min="5000"
              step="1000"
              value={aiConfig.timeoutMs}
              onChange={(e) =>
                setAiConfig((prev) => ({ ...prev, timeoutMs: Number(e.target.value) }))
              }
            />

            <label>Max tokens</label>
            <input
              type="number"
              min="32"
              max="2048"
              step="1"
              value={aiConfig.maxTokens}
              onChange={(e) =>
                setAiConfig((prev) => ({ ...prev, maxTokens: Number(e.target.value) }))
              }
            />

            <label>Prompt de sistema</label>
            <textarea
              rows={4}
              value={aiConfig.systemPrompt}
              onChange={(e) => setAiConfig((prev) => ({ ...prev, systemPrompt: e.target.value }))}
            />

            <label>Prompt de usuario (usar {`{{text}}`})</label>
            <textarea
              rows={5}
              value={aiConfig.userPromptTemplate}
              onChange={(e) =>
                setAiConfig((prev) => ({ ...prev, userPromptTemplate: e.target.value }))
              }
            />

            <div className="composerActions">
              <button className="secondary" onClick={checkAiHealth} disabled={checkingAiHealth}>
                {checkingAiHealth ? "Probando..." : "Probar conexión"}
              </button>
              <button className="primary" onClick={saveAiConfig} disabled={savingAiConfig}>
                {savingAiConfig ? "Guardando..." : "Guardar"}
              </button>
              <button className="secondary" onClick={() => setShowAiSettings(false)}>
                Cerrar
              </button>
            </div>

            {aiHealth ? (
              <p className={`notice ${aiHealth.ok ? "success" : "error"}`}>{aiHealth.message}</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}

export default App;
