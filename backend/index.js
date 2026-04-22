const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ProviderRegistry } = require('./providers/provider-registry');
const { WhatsAppAdapter } = require('./providers/whatsapp-adapter');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

let lastQR = null;
let currentStatus = 'connecting';
let whatsappReady = false;
let lastWhatsappReadyAt = null;
let lastWhatsappDisconnectReason = null;
let modelsCache = { provider: '', expiresAt: 0, data: [] };
const avatarCache = new Map();
const l1ChatsCache = new Map();
const l1MessagesCache = new Map();
const syncQueue = [];
const syncPendingKeys = new Set();
const syncInFlightKeys = new Set();
const syncStateMemory = new Map();
let syncWorkerRunning = false;
const AVATAR_TTL_MS = Number(process.env.AVATAR_TTL_MS || 10 * 60 * 1000);
const AVATAR_FETCH_LIMIT = Number(process.env.AVATAR_FETCH_LIMIT || 40);
const AVATAR_FETCH_TIMEOUT_MS = Number(process.env.AVATAR_FETCH_TIMEOUT_MS || 7000);
const CHATS_CACHE_TTL_MS = Number(process.env.CHATS_CACHE_TTL_MS || 5000);
const MESSAGES_CACHE_TTL_MS = Number(process.env.MESSAGES_CACHE_TTL_MS || 5000);
const DEFAULT_PROVIDER = 'whatsapp';
const DEFAULT_ACCOUNT_ID = process.env.DEFAULT_ACCOUNT_ID || 'default';
const STATUS_ARCHIVE_DIR = path.join(__dirname, 'status-archive');
const STATUS_ARCHIVE_PUBLIC_BASE = '/status-archive';
const MEDIA_ARCHIVE_DIR = path.join(__dirname, 'media-archive');
const MEDIA_ARCHIVE_PUBLIC_BASE = '/media-archive';
const STATUS_POLL_INTERVAL_MS = Number(process.env.STATUS_POLL_INTERVAL_MS || 60 * 1000);
let aiErrorLogState = {
  signature: '',
  count: 0,
  lastAt: 0
};
let providerRegistry = null;
let statusArchivePollInFlight = false;
let lastStatusArchiveRunAt = null;
let lastStatusArchiveStats = {
  checked: 0,
  archived: 0,
  skipped: 0,
  errors: 0,
  source: 'idle'
};

// API Key authentication middleware
const API_KEY = process.env.API_KEY || 'tu_contraseña_super_segura_aqui'; 

const authenticateApiKey = (req, res, next) => {
  if (!API_KEY) return next();
  
  if (req.method === 'OPTIONS') return next();
  
  const providedKey = req.headers['x-api-key'] || req.query.api_key;
  if (providedKey !== API_KEY) {
    console.error(`[AUTH FAILED] Path: ${req.path} | Method: ${req.method} | Expected: '${API_KEY}' vs Received: '${providedKey}'`);
    console.error(`[HEADERS DUMP]`, JSON.stringify(req.headers));
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'A valid API Key is required in X-API-Key header or api_key query parameter.'
    });
  }
  next();
};

/*
io.use((socket, next) => {
  if (!API_KEY) return next();
  const token = socket.handshake.auth.token;
  if (token !== API_KEY) {
    const err = new Error("not authorized");
    err.data = { content: "Please retry later" };
    return next(err);
  }
  next();
});
*/

io.on('connection', (socket) => {
  console.log('🔌 Frontend client connected to socket');
  if (currentStatus === 'qr' && lastQR) {
    socket.emit('qr', lastQR);
  } else if (currentStatus === 'authenticated') {
    socket.emit('ready', { status: 'authenticated' });
  }
});

// Explicit CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, Accept');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(STATUS_ARCHIVE_PUBLIC_BASE, express.static(STATUS_ARCHIVE_DIR));
app.use(MEDIA_ARCHIVE_PUBLIC_BASE, express.static(MEDIA_ARCHIVE_DIR));

// Middleware global para proteger todas las rutas /api/ (excepto health)
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  return authenticateApiKey(req, res, next);
});

// Root endpoint for connectivity check
app.get('/', (req, res) => {
  res.send('🚀 ChatFix Backend is running on port 3005!');
});

// Healthcheck/Auth verify endpoint
app.get('/api/check-auth', (req, res) => {
  res.json({ success: true, message: 'Authenticated' });
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatfix')
  .then(async () => {
    console.log('✅ MongoDB connected');
    await ensureCanonicalProviderFields();
  })
  .catch(err => console.error('❌ MongoDB error:', err));

const MessageSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  provider: { type: String, default: DEFAULT_PROVIDER, index: true },
  accountId: { type: String, default: DEFAULT_ACCOUNT_ID, index: true },
  conversationId: { type: String, index: true },
  providerMessageId: { type: String, index: true },
  conversationKey: { type: String, index: true },
  chatId: { type: String, index: true },
  from: String,
  to: String,
  body: String,
  fromMe: Boolean,
  mediaType: String,
  imageDataUrl: String,
  mediaUrl: String,
  mediaPath: String,
  mimeType: String,
  isRevoked: { type: Boolean, default: false },
  replyToMessageId: String,
  replyToText: String,
  mentionedIds: [String],
  originalText: String,
  correctedText: String,
  sentText: String,
  timestamp: Number
}, { timestamps: true });
MessageSchema.index({ provider: 1, accountId: 1, conversationId: 1, timestamp: -1 });
MessageSchema.index(
  { provider: 1, accountId: 1, providerMessageId: 1 },
  { unique: true, sparse: true }
);

const Message = mongoose.model('Message', MessageSchema);

const ChatSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  provider: { type: String, default: DEFAULT_PROVIDER, index: true },
  accountId: { type: String, default: DEFAULT_ACCOUNT_ID, index: true },
  conversationId: { type: String, index: true },
  conversationKey: { type: String, index: true },
  name: String,
  unreadCount: { type: Number, default: 0 },
  timestamp: Number,
  isGroup: Boolean,
  avatarUrl: String,
  lastSyncedAt: Date
}, { timestamps: true });
ChatSchema.index({ provider: 1, accountId: 1, timestamp: -1 });
ChatSchema.index({ provider: 1, accountId: 1, conversationId: 1 }, { unique: true, sparse: true });

const Chat = mongoose.model('Chat', ChatSchema);

const SyncStateSchema = new mongoose.Schema({
  provider: { type: String, default: DEFAULT_PROVIDER, index: true },
  accountId: { type: String, default: DEFAULT_ACCOUNT_ID, index: true },
  conversationId: { type: String, index: true },
  kind: { type: String, enum: ['chats', 'messages'], index: true },
  status: { type: String, enum: ['idle', 'queued', 'syncing', 'ok', 'error'], default: 'idle' },
  requestedLimit: Number,
  lastRequestedAt: Date,
  lastStartedAt: Date,
  lastFinishedAt: Date,
  lastError: String
}, { timestamps: true });
SyncStateSchema.index({ provider: 1, accountId: 1, conversationId: 1, kind: 1 }, { unique: true });
const SyncState = mongoose.model('SyncState', SyncStateSchema);

const StatusArchiveSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  provider: { type: String, default: DEFAULT_PROVIDER, index: true },
  accountId: { type: String, default: DEFAULT_ACCOUNT_ID, index: true },
  providerStatusMessageId: { type: String, required: true, index: true },
  statusOwnerId: { type: String, index: true },
  statusOwnerName: String,
  chatId: String,
  description: String,
  caption: String,
  mediaType: String,
  mimeType: String,
  mediaSha256: String,
  archivedFrom: { type: String, enum: ['event', 'poll'], default: 'poll' },
  fileName: String,
  filePath: String,
  imageUrl: String,
  mediaUrl: String,
  timestamp: Number,
  viewedAt: Date
}, { timestamps: true });
StatusArchiveSchema.index(
  { provider: 1, accountId: 1, providerStatusMessageId: 1 },
  { unique: true }
);
StatusArchiveSchema.index({ provider: 1, accountId: 1, timestamp: -1 });

const StatusArchive = mongoose.model('StatusArchive', StatusArchiveSchema);

const AiSettingsSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed
}, { timestamps: true });
const AiSettings = mongoose.model('AiSettings', AiSettingsSchema);

const DEFAULT_AI_CONFIG = {
  provider: (process.env.AI_PROVIDER || 'lmstudio').toLowerCase(),
  lmStudioBaseUrl: (process.env.LM_STUDIO_URL || 'http://localhost:1234')
    .replace(/\/+$/, '')
    .replace(/\/v1\/chat\/completions$/, ''),
  cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
  cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN || '',
  cloudflareBaseUrl: (process.env.CLOUDFLARE_AI_BASE_URL || '').replace(/\/+$/, ''),
  modelName: process.env.MODEL_NAME || 'llama-3.1-8b-instruct',
  temperature: Number(process.env.AI_TEMPERATURE || 0.7),
  maxTokens: Number(process.env.AI_MAX_TOKENS || 180),
  systemPrompt: process.env.AI_SYSTEM_PROMPT || 'Eres un corrector experto de mensajes de WhatsApp en español. Corrige ortografía, gramática y claridad manteniendo el tono y la intención original. No incluyas razonamiento interno ni etiquetas como <think>.',
  userPromptTemplate: process.env.AI_USER_PROMPT_TEMPLATE || 'Corregí este texto y devolvé solo la versión final corregida, sin explicación:\n\n{{text}}',
  timeoutMs: Number(process.env.AI_TIMEOUT_MS || 15000)
};

let aiConfig = { ...DEFAULT_AI_CONFIG };

async function loadAiConfig() {
  try {
    const record = await AiSettings.findOne({ key: 'ai_config' }).lean();
    if (record && record.value) {
      aiConfig = {
        ...DEFAULT_AI_CONFIG,
        ...record.value
      };
      aiConfig.provider = getAiProvider(aiConfig);
    }
  } catch (error) {
    console.error('⚠️ AI config load error:', error.message);
  }
}

async function saveAiConfig(nextConfig) {
  aiConfig = {
    ...DEFAULT_AI_CONFIG,
    ...nextConfig
  };
  aiConfig.provider = getAiProvider(aiConfig);

  await AiSettings.findOneAndUpdate(
    { key: 'ai_config' },
    { key: 'ai_config', value: aiConfig },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return aiConfig;
}

function normalizeProvider(value) {
  const normalized = String(value || DEFAULT_PROVIDER).trim().toLowerCase();
  return normalized || DEFAULT_PROVIDER;
}

function normalizeAccountId(value) {
  const normalized = String(value || DEFAULT_ACCOUNT_ID).trim().toLowerCase();
  return normalized || DEFAULT_ACCOUNT_ID;
}

function buildConversationKey(provider, accountId, conversationId) {
  return `${provider}:${accountId}:${conversationId}`;
}

function parseProviderContext(req = {}) {
  const provider = normalizeProvider(req.query?.provider || req.body?.provider || DEFAULT_PROVIDER);
  const accountId = normalizeAccountId(req.query?.accountId || req.body?.accountId || DEFAULT_ACCOUNT_ID);
  return { provider, accountId };
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

ensureDirectory(STATUS_ARCHIVE_DIR);
ensureDirectory(MEDIA_ARCHIVE_DIR);

function toPublicStatusArchiveUrl(fileName) {
  return `${STATUS_ARCHIVE_PUBLIC_BASE}/${encodeURIComponent(fileName)}`;
}

function toPublicMediaArchiveUrl(fileName) {
  return `${MEDIA_ARCHIVE_PUBLIC_BASE}/${encodeURIComponent(fileName)}`;
}

function safeStatusSegment(value, fallback = 'status') {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;
}

function extensionFromMime(mimetype = '') {
  const normalized = String(mimetype || '').toLowerCase();
  if (normalized === 'image/jpeg') return '.jpg';
  if (normalized === 'image/png') return '.png';
  if (normalized === 'image/webp') return '.webp';
  if (normalized === 'image/gif') return '.gif';
  if (normalized === 'image/heic') return '.heic';
  if (normalized === 'image/heif') return '.heif';
  const subtype = normalized.split('/')[1];
  if (!subtype) return '.bin';
  return `.${subtype.replace(/[^a-z0-9]/g, '') || 'bin'}`;
}

function hashBase64(base64Data = '') {
  return crypto.createHash('sha256').update(String(base64Data), 'base64').digest('hex');
}

function trimStatusText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function getL1CachedValue(cacheMap, key) {
  const entry = cacheMap.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cacheMap.delete(key);
    return null;
  }
  return entry.value;
}

function setL1CachedValue(cacheMap, key, value, ttlMs) {
  cacheMap.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

function chatsCacheKey(provider, accountId) {
  return `${provider}:${accountId}:chats`;
}

function messagesCacheKey(provider, accountId, conversationId, limit) {
  return `${provider}:${accountId}:${conversationId}:limit:${limit}`;
}

function invalidateChatsCache(provider, accountId) {
  l1ChatsCache.delete(chatsCacheKey(provider, accountId));
}

function invalidateMessagesCache(provider, accountId, conversationId) {
  const prefix = `${provider}:${accountId}:${conversationId}:limit:`;
  for (const key of l1MessagesCache.keys()) {
    if (key.startsWith(prefix)) {
      l1MessagesCache.delete(key);
    }
  }
}

function getSyncTaskKey(task) {
  return `${task.kind}:${task.provider}:${task.accountId}:${task.conversationId || '__all__'}`;
}

function setSyncState(task, patch) {
  const syncKey = getSyncTaskKey(task);
  const current = syncStateMemory.get(syncKey) || {
    provider: task.provider,
    accountId: task.accountId,
    conversationId: task.conversationId || '__all__',
    kind: task.kind,
    status: 'idle',
    lastRequestedAt: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    requestedLimit: task.limit || null,
    lastError: null
  };
  const next = { ...current, ...patch };
  syncStateMemory.set(syncKey, next);
  SyncState.findOneAndUpdate(
    {
      provider: next.provider,
      accountId: next.accountId,
      conversationId: next.conversationId,
      kind: next.kind
    },
    {
      provider: next.provider,
      accountId: next.accountId,
      conversationId: next.conversationId,
      kind: next.kind,
      status: next.status,
      requestedLimit: next.requestedLimit,
      lastRequestedAt: next.lastRequestedAt,
      lastStartedAt: next.lastStartedAt,
      lastFinishedAt: next.lastFinishedAt,
      lastError: next.lastError
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).catch((error) => {
    console.error('⚠️ SyncState persistence error:', error.message);
  });
  return next;
}

function getSyncStateSnapshot(provider, accountId, conversationId, kind) {
  const taskKey = `${kind}:${provider}:${accountId}:${conversationId || '__all__'}`;
  const local = syncStateMemory.get(taskKey);
  if (!local) {
    return {
      provider,
      accountId,
      conversationId: conversationId || '__all__',
      kind,
      status: 'idle',
      lastRequestedAt: null,
      lastStartedAt: null,
      lastFinishedAt: null,
      requestedLimit: null,
      lastError: null
    };
  }
  return { ...local };
}

function resolveProviderAdapter(provider) {
  if (!providerRegistry) {
    throw new Error('Provider registry not initialized');
  }
  return providerRegistry.resolve(provider);
}

async function ensureCanonicalProviderFields() {
  const chatResult = await Chat.updateMany(
    {
      $or: [
        { provider: { $exists: false } },
        { accountId: { $exists: false } },
        { conversationId: { $exists: false } },
        { conversationKey: { $exists: false } }
      ]
    },
    [
      {
        $set: {
          provider: { $ifNull: ['$provider', DEFAULT_PROVIDER] },
          accountId: { $ifNull: ['$accountId', DEFAULT_ACCOUNT_ID] },
          conversationId: { $ifNull: ['$conversationId', '$id'] },
          conversationKey: {
            $concat: [
              { $ifNull: ['$provider', DEFAULT_PROVIDER] },
              ':',
              { $ifNull: ['$accountId', DEFAULT_ACCOUNT_ID] },
              ':',
              { $ifNull: ['$conversationId', '$id'] }
            ]
          }
        }
      }
    ]
  );

  const messageResult = await Message.updateMany(
    {
      $or: [
        { provider: { $exists: false } },
        { accountId: { $exists: false } },
        { conversationId: { $exists: false } },
        { providerMessageId: { $exists: false } },
        { conversationKey: { $exists: false } }
      ]
    },
    [
      {
        $set: {
          provider: { $ifNull: ['$provider', DEFAULT_PROVIDER] },
          accountId: { $ifNull: ['$accountId', DEFAULT_ACCOUNT_ID] },
          conversationId: { $ifNull: ['$conversationId', '$chatId'] },
          providerMessageId: { $ifNull: ['$providerMessageId', '$id'] },
          conversationKey: {
            $concat: [
              { $ifNull: ['$provider', DEFAULT_PROVIDER] },
              ':',
              { $ifNull: ['$accountId', DEFAULT_ACCOUNT_ID] },
              ':',
              { $ifNull: ['$conversationId', '$chatId'] }
            ]
          }
        }
      }
    ]
  );

  if (chatResult.modifiedCount > 0 || messageResult.modifiedCount > 0) {
    console.log(
      `🧩 Canonical field migration complete chats=${chatResult.modifiedCount} messages=${messageResult.modifiedCount}`
    );
  }
}

function buildUserPrompt(text, template) {
  const safeTemplate = template || DEFAULT_AI_CONFIG.userPromptTemplate;
  if (safeTemplate.includes('{{text}}')) {
    return safeTemplate.replaceAll('{{text}}', text);
  }
  return `${safeTemplate}\n\n${text}`;
}

function getAiProvider(config = aiConfig) {
  return String(config?.provider || 'lmstudio').toLowerCase() === 'cloudflare'
    ? 'cloudflare'
    : 'lmstudio';
}

function getLmStudioChatCompletionsUrl(config = aiConfig) {
  const base = String(config?.lmStudioBaseUrl || DEFAULT_AI_CONFIG.lmStudioBaseUrl)
    .replace(/\/+$/, '')
    .replace(/\/v1\/chat\/completions$/, '');
  return `${base}/v1/chat/completions`;
}

function getCloudflareChatCompletionsUrl(config = aiConfig) {
  const explicitBase = String(config?.cloudflareBaseUrl || '').trim().replace(/\/+$/, '');
  if (explicitBase) {
    if (/\/v1\/chat\/completions\/?$/.test(explicitBase)) return explicitBase;
    return `${explicitBase}/v1/chat/completions`;
  }

  const accountId = String(config?.cloudflareAccountId || '').trim();
  if (!accountId) return '';
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
}

function getAiChatCompletionsUrl(config = aiConfig) {
  return getAiProvider(config) === 'cloudflare'
    ? getCloudflareChatCompletionsUrl(config)
    : getLmStudioChatCompletionsUrl(config);
}

function getAiBaseUrl(config = aiConfig) {
  const completionUrl = getAiChatCompletionsUrl(config);
  return completionUrl.replace(/\/v1\/chat\/completions\/?$/, '');
}

function getAiRequestHeaders(config = aiConfig) {
  if (getAiProvider(config) !== 'cloudflare') return {};
  const token = String(config?.cloudflareApiToken || '').trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isAiConfigured(config = aiConfig) {
  const provider = getAiProvider(config);
  if (provider === 'cloudflare') {
    return Boolean(getCloudflareChatCompletionsUrl(config) && String(config?.cloudflareApiToken || '').trim());
  }
  return Boolean(String(config?.lmStudioBaseUrl || '').trim());
}

function extractUpstreamAiError(error) {
  return (
    error?.response?.data?.error?.message ||
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    'unknown'
  );
}

function logAiError(error, context = 'correct') {
  const status = error?.response?.status || 'n/a';
  const provider = getAiProvider(aiConfig);
  const model = String(aiConfig?.modelName || 'unknown');
  const detail = String(extractUpstreamAiError(error));
  const signature = `${context}|${provider}|${model}|${status}|${detail.slice(0, 160)}`;
  const now = Date.now();

  if (aiErrorLogState.signature === signature && now - aiErrorLogState.lastAt < 15000) {
    aiErrorLogState.count += 1;
    aiErrorLogState.lastAt = now;
    if (aiErrorLogState.count % 10 !== 0) {
      return;
    }
  } else {
    aiErrorLogState = {
      signature,
      count: 1,
      lastAt: now
    };
  }

  console.error(
    `❌ AI error [${context}] provider=${provider} model=${model} status=${status} detail=${detail}`
  );
}

function stripThinking(text) {
  return String(text || '')
    .replace(/<think[\s\S]*?<\/think>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .trim();
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .match(/[a-záéíóúüñ0-9]+/gi) || [];
}

function lexicalOverlapRatio(source, candidate) {
  const sourceTokens = tokenize(source).filter(t => t.length > 2);
  const candSet = new Set(tokenize(candidate).filter(t => t.length > 2));
  if (sourceTokens.length === 0) return 1;
  let overlap = 0;
  for (const t of sourceTokens) {
    if (candSet.has(t)) overlap += 1;
  }
  return overlap / sourceTokens.length;
}

function normalizeCandidate(text) {
  const cleaned = stripThinking(text).replace(/^"(.*)"$/, '$1').trim();
  if (!cleaned) return '';

  const lines = cleaned
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-*•\d\.\)\(]+\s*/, '').trim())
    .filter(Boolean);

  if (lines.length === 0) return '';
  return lines[0];
}

function looksSuspicious(original, candidate, rawOutput) {
  if (!candidate) return true;
  if ((rawOutput || '').split(/\r?\n/).filter(Boolean).length > 3) return true;
  if (/original|corrected|versi[oó]n/i.test(rawOutput || '')) return true;
  const overlap = lexicalOverlapRatio(original, candidate);
  return overlap < 0.15;
}

function applyLightPolish(text) {
  const trimmed = String(text || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  let result = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  if (!/[.!?…]$/.test(result)) {
    result = `${result}.`;
  }
  return result;
}

function shouldRetryWithoutSystemRole(error) {
  const msg =
    error?.response?.data?.error?.message ||
    error?.response?.data?.error ||
    error?.message ||
    '';
  return String(msg).toLowerCase().includes('only user and assistant roles are supported');
}

function shouldRetryWithoutStructuredOutput(error) {
  const msg =
    error?.response?.data?.error?.message ||
    error?.response?.data?.error ||
    error?.message ||
    '';
  const lower = String(msg).toLowerCase();
  return (
    lower.includes('response_format') ||
    lower.includes('json_schema') ||
    lower.includes('structured output')
  );
}

function extractStructuredCorrected(response) {
  const content = response?.data?.choices?.[0]?.message?.content;
  if (!content) return null;

  if (typeof content === 'object' && content.corrected) {
    return String(content.corrected);
  }

  if (typeof content !== 'string') return null;

  try {
    const parsed = JSON.parse(stripThinking(content));
    if (parsed && typeof parsed.corrected === 'string') {
      return parsed.corrected;
    }
  } catch (_error) {
    // ignore parse failure and fallback to plain text flow
  }

  return null;
}

async function requestCorrectionWithModel(text, options = {}) {
  const activeConfig = {
    ...aiConfig,
    ...options
  };
  const userPrompt = buildUserPrompt(text, options.userPromptTemplate || activeConfig.userPromptTemplate);
  const requestBase = {
    model: options.modelName || activeConfig.modelName,
    temperature: Number(options.temperature ?? activeConfig.temperature ?? 0.7),
    max_tokens: Number(options.maxTokens ?? activeConfig.maxTokens ?? 180),
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'chatfix_correction',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            corrected: { type: 'string' }
          },
          required: ['corrected']
        }
      }
    }
  };
  const requestOptions = {
    timeout: Number(options.timeoutMs ?? activeConfig.timeoutMs ?? 15000),
    headers: getAiRequestHeaders(activeConfig)
  };
  const systemPrompt = options.systemPrompt || activeConfig.systemPrompt;
  const provider = getAiProvider(activeConfig);
  const useStructuredOutput = options.structuredOutput !== false && provider !== 'cloudflare';
  const chatCompletionsUrl = getAiChatCompletionsUrl(activeConfig);

  const postCompletion = async (messages, structuredOutput) => {
    const payload = {
      model: requestBase.model,
      temperature: requestBase.temperature,
      max_tokens: requestBase.max_tokens,
      messages
    };
    if (structuredOutput) {
      payload.response_format = requestBase.response_format;
    }

    try {
      return await axios.post(chatCompletionsUrl, payload, requestOptions);
    } catch (error) {
      if (structuredOutput && shouldRetryWithoutStructuredOutput(error)) {
        return axios.post(chatCompletionsUrl, {
          ...payload,
          response_format: undefined
        }, requestOptions);
      }
      throw error;
    }
  };

  try {
    return await postCompletion([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ], useStructuredOutput);
  } catch (error) {
    if (!shouldRetryWithoutSystemRole(error)) {
      throw error;
    }

    const mergedUserPrompt = `${systemPrompt}\n\n${userPrompt}`;
    return postCompletion([{ role: "user", content: mergedUserPrompt }], useStructuredOutput);
  }
}

async function archiveMedia(media, prefix = 'media') {
  if (!media || !media.data || !media.mimetype) return null;

  const mediaSha256 = hashBase64(media.data);
  const extension = extensionFromMime(media.mimetype);
  const fileName = `${prefix}-${Date.now()}-${mediaSha256.slice(0, 16)}${extension}`;
  const filePath = path.join(MEDIA_ARCHIVE_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
  }

  return {
    fileName,
    filePath,
    publicUrl: toPublicMediaArchiveUrl(fileName),
    mimeType: media.mimetype
  };
}

async function buildMediaPayload(message) {
  if (!message.hasMedia) {
    return { mediaType: null, imageDataUrl: null, mediaUrl: null, mimeType: null };
  }

  try {
    const mediaPromise = message.downloadMedia();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Media download timeout')), 8000)
    );

    const media = await Promise.race([mediaPromise, timeoutPromise]);
    
    if (!media || !media.mimetype) {
      return { mediaType: null, imageDataUrl: null, mediaUrl: null, mimeType: null };
    }

    const archived = await archiveMedia(media, 'chat');
    const mediaType = media.mimetype.split('/')[0] || 'document';

    let payload = {
      mediaType,
      mediaUrl: archived?.publicUrl || null,
      mimeType: media.mimetype
    };

    if (mediaType === 'image') {
      payload.imageDataUrl = `data:${media.mimetype};base64,${media.data}`;
    }

    return payload;
  } catch (error) {
    console.warn(`⚠️ Media download skipped for message ${message.id?._serialized || 'unknown'}:`, error.message);
  }

  return { mediaType: null, imageDataUrl: null, mediaUrl: null, mimeType: null };
}

async function buildReplyPayload(message) {
  if (!message?.hasQuotedMsg) {
    return {
      replyToMessageId: null,
      replyToText: null
    };
  }

  try {
    const quoted = await message.getQuotedMessage();
    return {
      replyToMessageId: quoted?.id?._serialized || null,
      replyToText: quoted?.body || '[Mensaje citado]'
    };
  } catch (error) {
    return {
      replyToMessageId: null,
      replyToText: '[No se pudo cargar la respuesta citada]'
    };
  }
}

async function serializeMessage(message, chatId, context = {}) {
  const provider = normalizeProvider(context.provider);
  const accountId = normalizeAccountId(context.accountId);
  const providerMessageId = message?.id?._serialized || `${message?.timestamp}-${Math.random()}`;
  const canonicalMessageId =
    provider === DEFAULT_PROVIDER
      ? providerMessageId
      : `${provider}:${accountId}:${providerMessageId}`;
  const mediaPayload = await buildMediaPayload(message);
  const replyPayload = await buildReplyPayload(message);
  const conversationId = chatId;
  return {
    id: canonicalMessageId,
    provider,
    accountId,
    conversationId,
    providerMessageId,
    conversationKey: buildConversationKey(provider, accountId, conversationId),
    chatId,
    body: message?.body || '',
    timestamp: message?.timestamp || Math.floor(Date.now() / 1000),
    fromMe: Boolean(message?.fromMe),
    from: message?.from,
    to: message?.to,
    mediaType: mediaPayload.mediaType,
    imageDataUrl: mediaPayload.imageDataUrl,
    mediaUrl: mediaPayload.mediaUrl,
    mimeType: mediaPayload.mimeType,
    replyToMessageId: replyPayload.replyToMessageId,
    replyToText: replyPayload.replyToText,
    mentionedIds: Array.isArray(message?.mentionedIds) ? message.mentionedIds : []
  };
}

async function upsertChat(waChat, index, context = {}) {
  try {
    const provider = normalizeProvider(context.provider);
    const accountId = normalizeAccountId(context.accountId);
    const chatId = waChat.id._serialized;
    const conversationId = chatId;
    const avatarUrl = await getChatAvatar(waChat, index || 0);
    const now = new Date();

    await Chat.findOneAndUpdate(
      { provider, accountId, conversationId },
      {
        id: chatId,
        provider,
        accountId,
        conversationId,
        conversationKey: buildConversationKey(provider, accountId, conversationId),
        name: waChat.name,
        unreadCount: waChat.unreadCount,
        timestamp: waChat.timestamp,
        isGroup: Boolean(waChat.isGroup),
        avatarUrl,
        lastSyncedAt: now
      },
      { upsert: true, new: true }
    );
    invalidateChatsCache(provider, accountId);
  } catch (err) {
    console.error(`❌ Error upserting chat ${waChat.id?._serialized}:`, err.message);
  }
}

async function upsertMessage(waMsg, chatId, extraData = {}, context = {}) {
  try {
    const payload = await serializeMessage(waMsg, chatId, context);
    const updateData = {
      ...payload,
      ...extraData
    };

    // Remove undefined values to avoid overwriting existing data with nothing
    Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

    await Message.findOneAndUpdate(
      {
        provider: payload.provider,
        accountId: payload.accountId,
        providerMessageId: payload.providerMessageId
      },
      { $set: updateData },
      { upsert: true, new: true }
    );
    invalidateMessagesCache(payload.provider, payload.accountId, payload.conversationId);
    invalidateChatsCache(payload.provider, payload.accountId);
    return payload;
  } catch (err) {
    console.error(`❌ Error upserting message ${waMsg.id?._serialized}:`, err.message);
    return null;
  }
}

function normalizeStatusDescriptor(entry = {}) {
  const providerStatusMessageId =
    entry.providerStatusMessageId ||
    entry.messageId ||
    entry.id?._serialized ||
    entry.id;
  const statusOwnerId =
    entry.statusOwnerId ||
    entry.contactId ||
    entry.author ||
    entry.from ||
    '';
  return {
    providerStatusMessageId: String(providerStatusMessageId || '').trim(),
    statusOwnerId: String(statusOwnerId || '').trim(),
    statusOwnerName: trimStatusText(
      entry.statusOwnerName ||
      entry.contactName ||
      entry.notifyName ||
      entry.pushname ||
      entry.shortName ||
      ''
    ),
    chatId: String(entry.chatId || 'status@broadcast').trim() || 'status@broadcast',
    description: trimStatusText(entry.description || entry.caption || entry.body || ''),
    caption: trimStatusText(entry.caption || entry.body || ''),
    mediaType: String(entry.mediaType || entry.type || '').trim().toLowerCase(),
    timestamp: Number(entry.timestamp || 0) || Math.floor(Date.now() / 1000)
  };
}

async function fetchCurrentStatusDescriptors() {
  if (!client?.pupPage) return [];
  return client.pupPage.evaluate(async () => {
    const statuses = window.Store.Status?.getModelsArray?.() || [];
    const results = [];

    for (const status of statuses) {
      const ownerId =
        status?.id?._serialized ||
        status?.contact?.id?._serialized ||
        status?.contact?.userid ||
        '';
      const ownerName =
        status?.contact?.formattedName ||
        status?.contact?.pushname ||
        status?.contact?.name ||
        status?.name ||
        '';
      const collection = status?.msgs || status?._msgs;
      const messages =
        typeof collection?.getModelsArray === 'function'
          ? collection.getModelsArray()
          : Array.isArray(collection)
            ? collection
            : [];

      for (const msg of messages) {
        const serialized = window.WWebJS.getMessageModel(msg);
        results.push({
          providerStatusMessageId: serialized?.id?._serialized || serialized?.id,
          statusOwnerId: ownerId || serialized?.author || serialized?.from || '',
          statusOwnerName: ownerName,
          chatId: serialized?.from || 'status@broadcast',
          description: serialized?.caption || serialized?.body || '',
          caption: serialized?.caption || '',
          mediaType: serialized?.type || '',
          timestamp: serialized?.timestamp || serialized?.t || 0
        });
      }
    }

    return results;
  });
}

async function archiveStatusFromDescriptor(entry = {}, source = 'poll') {
  const normalized = normalizeStatusDescriptor(entry);
  if (!normalized.providerStatusMessageId) {
    return { archived: false, reason: 'missing_message_id' };
  }

  const existing = await StatusArchive.findOne({
    provider: DEFAULT_PROVIDER,
    accountId: DEFAULT_ACCOUNT_ID,
    providerStatusMessageId: normalized.providerStatusMessageId
  }).lean();
  if (existing) {
    return { archived: false, reason: 'duplicate' };
  }

  await client.sendSeen('status@broadcast').catch(() => {});

  const statusMessage = await client.getMessageById(normalized.providerStatusMessageId).catch(() => null);
  if (!statusMessage) {
    return { archived: false, reason: 'status_not_found' };
  }

  let mediaPayload = { fileName: null, filePath: null, publicUrl: null, mimeType: null, mediaSha256: null };

  if (statusMessage.hasMedia) {
    const media = await statusMessage.downloadMedia().catch(() => null);
    if (media && media.data) {
      const archived = await archiveMedia(media, 'status');
      if (archived) {
        mediaPayload = {
          ...archived,
          mediaSha256: hashBase64(media.data)
        };
      }
    }
  }

  const payload = {
    id: `${DEFAULT_PROVIDER}:${DEFAULT_ACCOUNT_ID}:${normalized.providerStatusMessageId}`,
    provider: DEFAULT_PROVIDER,
    accountId: DEFAULT_ACCOUNT_ID,
    providerStatusMessageId: normalized.providerStatusMessageId,
    statusOwnerId: normalized.statusOwnerId,
    statusOwnerName: normalized.statusOwnerName || normalized.statusOwnerId,
    chatId: normalized.chatId,
    description: normalized.description || normalized.caption,
    caption: normalized.caption,
    mediaType: mediaPayload.mimeType ? mediaPayload.mimeType.split('/')[0] : 'text',
    mimeType: mediaPayload.mimeType,
    mediaSha256: mediaPayload.mediaSha256,
    archivedFrom: source === 'event' ? 'event' : 'poll',
    fileName: mediaPayload.fileName,
    filePath: mediaPayload.filePath,
    imageUrl: mediaPayload.publicUrl,
    mediaUrl: mediaPayload.publicUrl,
    timestamp: normalized.timestamp,
    viewedAt: new Date()
  };

  await StatusArchive.findOneAndUpdate(
    {
      provider: payload.provider,
      accountId: payload.accountId,
      providerStatusMessageId: payload.providerStatusMessageId
    },
    { $setOnInsert: payload },
    { upsert: true, new: true }
  );

  return { archived: true, reason: 'stored', payload };
}

async function runStatusArchiveSweep(source = 'poll') {
  if (!whatsappReady || currentStatus !== 'authenticated') {
    return { checked: 0, archived: 0, skipped: 0, errors: 0, source };
  }
  if (statusArchivePollInFlight) {
    return { checked: 0, archived: 0, skipped: 1, errors: 0, source: 'busy' };
  }

  statusArchivePollInFlight = true;
  const stats = {
    checked: 0,
    archived: 0,
    skipped: 0,
    errors: 0,
    source
  };

  try {
    const descriptors = await fetchCurrentStatusDescriptors();
    const results = await Promise.allSettled(
      descriptors.map(async (descriptor) => {
        stats.checked += 1;
        return await archiveStatusFromDescriptor(descriptor, source);
      })
    );

    for (const res of results) {
      if (res.status === 'fulfilled') {
        const result = res.value;
        if (result.archived) stats.archived += 1;
        else stats.skipped += 1;
      } else {
        stats.errors += 1;
        console.error('⚠️ Status archive item error:', res.reason?.message || res.reason);
      }
    }
  } catch (error) {
    stats.errors += 1;
    console.error('⚠️ Status archive sweep error:', error.message);
  } finally {
    statusArchivePollInFlight = false;
    lastStatusArchiveRunAt = nowIso();
    lastStatusArchiveStats = stats;
  }

  return stats;
}

async function syncAllChats(context = {}) {
  const provider = normalizeProvider(context.provider);
  const accountId = normalizeAccountId(context.accountId);
  const adapter = resolveProviderAdapter(provider);
  if (!adapter.isReady()) return;
  console.log(`🔄 Starting full chat sync provider=${provider} account=${accountId}`);
  try {
    const chats = await adapter.listChats({ accountId });
    for (let i = 0; i < chats.length; i++) {
      await upsertChat(chats[i], i, { provider, accountId });
    }
    console.log(`✅ Synced ${chats.length} chats.`);
  } catch (err) {
    console.error('❌ Error in syncAllChats:', err.message);
  }
}

async function syncChatMessages(chatId, limit = 50, context = {}) {
  const provider = normalizeProvider(context.provider);
  const accountId = normalizeAccountId(context.accountId);
  const adapter = resolveProviderAdapter(provider);
  if (!adapter.isReady()) return;
  try {
    const messages = await adapter.fetchMessages({
      accountId,
      conversationId: chatId,
      limit
    });
    for (const m of messages) {
      await upsertMessage(m, chatId, {}, { provider, accountId });
    }
  } catch (err) {
    console.error(`❌ Error syncing messages for chat ${chatId}:`, err.message);
  }
}

async function executeSyncTask(task) {
  const adapter = resolveProviderAdapter(task.provider);
  if (!adapter.isReady()) {
    setSyncState(task, {
      status: 'idle',
      lastFinishedAt: nowIso(),
      lastError: null
    });
    return;
  }
  setSyncState(task, {
    status: 'syncing',
    lastStartedAt: nowIso(),
    lastError: null
  });
  try {
    if (task.kind === 'chats') {
      await syncAllChats({ provider: task.provider, accountId: task.accountId });
    } else {
      await syncChatMessages(task.conversationId, task.limit || 80, {
        provider: task.provider,
        accountId: task.accountId
      });
    }
    setSyncState(task, {
      status: 'ok',
      lastFinishedAt: nowIso(),
      lastError: null
    });
  } catch (error) {
    setSyncState(task, {
      status: 'error',
      lastFinishedAt: nowIso(),
      lastError: String(error?.message || error)
    });
  }
}

async function startSyncWorker() {
  if (syncWorkerRunning) return;
  syncWorkerRunning = true;
  try {
    while (syncQueue.length > 0) {
      const task = syncQueue.shift();
      const key = getSyncTaskKey(task);
      syncPendingKeys.delete(key);
      if (syncInFlightKeys.has(key)) {
        continue;
      }
      syncInFlightKeys.add(key);
      try {
        await executeSyncTask(task);
      } finally {
        syncInFlightKeys.delete(key);
      }
    }
  } finally {
    syncWorkerRunning = false;
  }
}

function enqueueSyncTask(taskInput) {
  const task = {
    provider: normalizeProvider(taskInput.provider),
    accountId: normalizeAccountId(taskInput.accountId),
    kind: taskInput.kind === 'messages' ? 'messages' : 'chats',
    conversationId: taskInput.kind === 'messages' ? String(taskInput.conversationId || '') : '__all__',
    limit: Number(taskInput.limit || 80),
    reason: String(taskInput.reason || '')
  };

  if (task.kind === 'messages' && !task.conversationId) {
    return;
  }

  const key = getSyncTaskKey(task);
  setSyncState(task, {
    status: 'queued',
    lastRequestedAt: nowIso(),
    requestedLimit: task.limit
  });

  if (syncPendingKeys.has(key) || syncInFlightKeys.has(key)) {
    return;
  }

  syncPendingKeys.add(key);
  syncQueue.push(task);
  setImmediate(startSyncWorker);
}

function parsePositiveInt(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function sanitizeTextInput(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .trim();
}

async function getAvailableModels(forceRefresh = false) {
  const provider = getAiProvider(aiConfig);
  if (!forceRefresh && modelsCache.provider === provider && modelsCache.expiresAt > Date.now()) {
    return modelsCache.data;
  }

  let models = [];
  if (provider === 'cloudflare') {
    models = [String(aiConfig.modelName || '').trim()].filter(Boolean);
  } else {
    const response = await axios.get(`${getAiBaseUrl(aiConfig)}/v1/models`, {
      timeout: 7000
    });
    models = Array.isArray(response.data?.data) ? response.data.data.map((model) => model.id) : [];
  }

  modelsCache = {
    provider,
    data: models,
    expiresAt: Date.now() + 30000
  };
  return models;
}

async function resolveChatAvatar(chat) {
  if (!chat) return null;
  try {
    if (typeof chat.getProfilePicUrl === 'function') {
      const pic = await chat.getProfilePicUrl();
      if (pic) return pic;
    }
  } catch (_error) {
    // ignore and fallback
  }

  try {
    if (typeof chat.getContact === 'function') {
      const contact = await chat.getContact();
      if (contact && typeof contact.getProfilePicUrl === 'function') {
        const pic = await contact.getProfilePicUrl();
        if (pic) return pic;
      }
    }
  } catch (_error) {
    // ignore and fallback
  }

  return null;
}

async function toImageDataUrl(url) {
  if (!url) return null;
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: AVATAR_FETCH_TIMEOUT_MS,
      maxContentLength: 2 * 1024 * 1024
    });
    const mime = String(response.headers?.['content-type'] || '').toLowerCase();
    if (!mime.startsWith('image/')) return null;
    const base64 = Buffer.from(response.data).toString('base64');
    return `data:${mime};base64,${base64}`;
  } catch (_error) {
    return null;
  }
}

async function getChatAvatar(chat, index) {
  const chatId = chat?.id?._serialized;
  if (!chatId) return null;

  const cached = avatarCache.get(chatId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.dataUrl || null;
  }

  if (index >= AVATAR_FETCH_LIMIT) {
    return cached?.dataUrl || null;
  }

  const avatarSourceUrl = await resolveChatAvatar(chat);
  const avatarDataUrl = await toImageDataUrl(avatarSourceUrl);
  avatarCache.set(chatId, {
    dataUrl: avatarDataUrl || null,
    expiresAt: Date.now() + AVATAR_TTL_MS
  });

  return avatarDataUrl || null;
}

const chromeExecutablePath = process.env.CHROME_EXECUTABLE_PATH ||
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/usr/bin/chromium');

// WhatsApp Client
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './.wwebjs_auth'
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions'
    ],
    executablePath: chromeExecutablePath
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1018921608-alpha.html'
  }
});

providerRegistry = new ProviderRegistry();
providerRegistry.register(
  new WhatsAppAdapter({
    client,
    getStatus: () => currentStatus,
    isReady: () => whatsappReady && currentStatus === 'authenticated',
    markRead: async ({ conversationId }) => {
      const chat = await client.getChatById(conversationId);
      if (chat) {
        await chat.sendSeen();
      }
    }
  })
);

client.on('qr', (qr) => {
  console.log('📡 QR Received - Emitting to frontend...');
  lastQR = qr;
  currentStatus = 'qr';
  whatsappReady = false;
  lastWhatsappDisconnectReason = null;
  io.emit('qr', qr);
});

client.on('ready', () => {
  console.log('✅ Client is ready!');
  lastQR = null;
  currentStatus = 'authenticated';
  whatsappReady = true;
  lastWhatsappReadyAt = new Date().toISOString();
  lastWhatsappDisconnectReason = null;
  io.emit('ready', { status: 'authenticated' });

  // Start background sync (async queue, read-path safe)
  enqueueSyncTask({
    kind: 'chats',
    provider: DEFAULT_PROVIDER,
    accountId: DEFAULT_ACCOUNT_ID,
    reason: 'provider_ready'
  });
  runStatusArchiveSweep('poll').catch((error) => {
    console.error('⚠️ Initial status archive sweep failed:', error.message);
  });
});

client.on('authenticated', () => {
  console.log('AUTHENTICATED');
});

client.on('auth_failure', msg => {
  console.error('AUTHENTICATION FAILURE', msg);
  whatsappReady = false;
  io.emit('auth_failure', msg);
});

client.on('disconnected', (reason) => {
  console.log('Client was logged out', reason);
  whatsappReady = false;
  lastWhatsappDisconnectReason = String(reason || 'unknown');
  io.emit('disconnected', reason);
});

async function handleMessageRevoke(after, before) {
  const msgId = (before || after)?.id?._serialized;
  if (!msgId) return;

  console.log(`🗑️ Message revoked: ${msgId}`);

  try {
    const updated = await Message.findOneAndUpdate(
      { providerMessageId: msgId },
      { $set: { isRevoked: true } },
      { new: true }
    );

    if (updated) {
      io.emit('message_updated', updated);
    }
  } catch (err) {
    console.error(`❌ Error handling revoke for ${msgId}:`, err.message);
  }
}

client.on('message_revoke_everyone', handleMessageRevoke);
client.on('message_revoke_me', handleMessageRevoke);

// Message handling (incoming and outgoing)
client.on('message_create', async (msg) => {
  // Auto-ver estados (Stories) para que no aparezcan como pendientes en el teléfono
  if (msg.from === 'status@broadcast' || msg.type === 'status_v3' || msg.isStatus) {
    try {
      // Marcamos el chat de estados como visto de forma directa y rápida
      await client.sendSeen('status@broadcast');
      await archiveStatusFromDescriptor({
        providerStatusMessageId: msg.id?._serialized,
        statusOwnerId: msg.author || msg.from,
        description: msg.caption || msg.body || '',
        caption: msg.caption || '',
        mediaType: msg.type,
        timestamp: msg.timestamp || Math.floor(Date.now() / 1000)
      }, 'event');
      console.log(`👁️ Status auto-visto [${msg.type}] de: ${msg.author || msg.from}`);
    } catch (e) {
      console.error('⚠️ Error al auto-ver status:', e.message);
    }
    return; // No procesamos los estados como mensajes normales en la UI
  }

  let chatId = msg.from;
  if (msg.fromMe) {
    chatId = msg.to;
  }

  // Cache and Emit
  const payload = await upsertMessage(
    msg,
    chatId,
    {},
    { provider: DEFAULT_PROVIDER, accountId: DEFAULT_ACCOUNT_ID }
  );
  if (payload) {
    io.emit('new_message', payload);
  }

  // Also update chat timestamp/unread in cache
  try {
    const chat = await msg.getChat();
    await upsertChat(chat, 0, { provider: DEFAULT_PROVIDER, accountId: DEFAULT_ACCOUNT_ID });
  } catch (err) {
    console.error('⚠️ Failed to update chat on message_create:', err.message);
  }
});

// Función para limpiar bloqueos de Chromium antes de iniciar
function cleanChromiumLocks() {
  const authPath = path.resolve(__dirname, './.wwebjs_auth');
  if (fs.existsSync(authPath)) {
    try {
      // Buscamos archivos SingletonLock recursivamente y los borramos
      const deleteLock = (dir) => {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          if (fs.lstatSync(fullPath).isDirectory()) {
            deleteLock(fullPath);
          } else if (file === 'SingletonLock') {
            fs.unlinkSync(fullPath);
            console.log('🧹 Archivo SingletonLock eliminado para permitir el inicio.');
          }
        }
      };
      deleteLock(authPath);
    } catch (err) {
      console.warn('⚠️ No se pudo limpiar SingletonLock (puede que no exista o no haya permisos):', err.message);
    }
  }
}

cleanChromiumLocks();
client.initialize();

setInterval(() => {
  runStatusArchiveSweep('poll').catch((error) => {
    console.error('⚠️ Scheduled status archive sweep failed:', error.message);
  });
}, STATUS_POLL_INTERVAL_MS);

function ensureWhatsappReady(res) {
  if (!whatsappReady || currentStatus !== 'authenticated') {
    res.status(503).json({
      error: 'WhatsApp client not ready',
      whatsappStatus: currentStatus,
      ready: whatsappReady
    });
    return false;
  }
  return true;
}

// AI API endpoint
app.post('/api/correct', async (req, res) => {
  try {
    const text = sanitizeTextInput(req.body?.text);
    if (!text) return res.status(400).json({ error: 'No text provided' });
    if (text.length > 2500) {
      return res.status(400).json({ error: 'Text is too long (max 2500 chars)' });
    }
    const response = await requestCorrectionWithModel(text);
    const raw = response?.data?.choices?.[0]?.message?.content || '';
    const structured = extractStructuredCorrected(response);
    let cleanedText = normalizeCandidate(structured || raw);

    if (looksSuspicious(text, cleanedText, structured || raw)) {
      const strictResponse = await requestCorrectionWithModel(text, {
        temperature: 0.1,
        maxTokens: 80,
        systemPrompt: 'Sos un corrector ortográfico. Devolvés únicamente una sola línea final corregida, sin alternativas, sin listas y sin explicaciones.',
        userPromptTemplate: 'Corregí este mensaje manteniendo significado y el mismo idioma. Devolvé solo la versión final:\n\n{{text}}'
      });
      const strictRaw = strictResponse?.data?.choices?.[0]?.message?.content || '';
      const strictStructured = extractStructuredCorrected(strictResponse);
      const strictCleaned = normalizeCandidate(strictStructured || strictRaw);
      cleanedText = looksSuspicious(text, strictCleaned, strictStructured || strictRaw) ? text.trim() : strictCleaned;
    }

    if (cleanedText === String(text || '').trim()) {
      cleanedText = applyLightPolish(cleanedText);
    }

    res.json({ original: text, corrected: cleanedText });
  } catch (error) {
    logAiError(error, 'api/correct');
    const upstreamDetail = extractUpstreamAiError(error);
    res.status(500).json({
      error: 'AI server error',
      detail: upstreamDetail || error.message
    });
  }
});

app.get('/api/ai/config', async (_req, res) => {
  res.json({
    ...aiConfig,
    provider: getAiProvider(aiConfig),
    aiBaseUrl: getAiBaseUrl(aiConfig)
  });
});

app.put('/api/ai/config', async (req, res) => {
  try {
    const nextConfig = {
      ...aiConfig
    };

    if (typeof req.body.systemPrompt === 'string') {
      nextConfig.systemPrompt = req.body.systemPrompt.trim() || DEFAULT_AI_CONFIG.systemPrompt;
    }
    if (typeof req.body.userPromptTemplate === 'string') {
      nextConfig.userPromptTemplate = req.body.userPromptTemplate.trim() || DEFAULT_AI_CONFIG.userPromptTemplate;
    }
    if (typeof req.body.modelName === 'string') {
      nextConfig.modelName = req.body.modelName.trim() || DEFAULT_AI_CONFIG.modelName;
    }
    if (typeof req.body.provider === 'string') {
      nextConfig.provider = String(req.body.provider).toLowerCase() === 'cloudflare' ? 'cloudflare' : 'lmstudio';
    }
    if (typeof req.body.lmStudioBaseUrl === 'string') {
      nextConfig.lmStudioBaseUrl = req.body.lmStudioBaseUrl.trim() || DEFAULT_AI_CONFIG.lmStudioBaseUrl;
    }
    if (typeof req.body.cloudflareAccountId === 'string') {
      nextConfig.cloudflareAccountId = req.body.cloudflareAccountId.trim();
    }
    if (typeof req.body.cloudflareApiToken === 'string') {
      nextConfig.cloudflareApiToken = req.body.cloudflareApiToken.trim();
    }
    if (typeof req.body.cloudflareBaseUrl === 'string') {
      nextConfig.cloudflareBaseUrl = req.body.cloudflareBaseUrl.trim();
    }
    if (req.body.temperature !== undefined) {
      const parsed = Number(req.body.temperature);
      nextConfig.temperature = Number.isFinite(parsed) ? parsed : aiConfig.temperature;
    }
    if (req.body.maxTokens !== undefined) {
      const parsed = Number(req.body.maxTokens);
      nextConfig.maxTokens = Number.isFinite(parsed) && parsed > 0 ? parsed : aiConfig.maxTokens;
    }
    if (req.body.timeoutMs !== undefined) {
      const parsed = Number(req.body.timeoutMs);
      nextConfig.timeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : aiConfig.timeoutMs;
    }

    const saved = await saveAiConfig(nextConfig);
    res.json({ success: true, config: saved });
  } catch (error) {
    console.error('❌ Save AI config error:', error.message);
    res.status(500).json({ error: 'Failed to save AI config' });
  }
});

app.get('/api/ai/health', async (_req, res) => {
  try {
    const models = await getAvailableModels(_req.query.refresh === '1');
    const provider = getAiProvider(aiConfig);
    const payload = {
      ok: true,
      provider,
      aiBaseUrl: getAiBaseUrl(aiConfig),
      modelCount: models.length,
      models
    };

    const shouldProbe = _req.query.probe === '1';
    if (shouldProbe) {
      try {
        const probe = await axios.post(getAiChatCompletionsUrl(aiConfig), {
          model: aiConfig.modelName,
          messages: [
            { role: 'system', content: 'Respondé solo "OK".' },
            { role: 'user', content: 'Ping' }
          ],
          temperature: 0
        }, {
          timeout: Math.min(Number(aiConfig.timeoutMs ?? 15000), 25000),
          headers: getAiRequestHeaders(aiConfig)
        });
        payload.probeOk = true;
        payload.probeResponse = probe.data?.choices?.[0]?.message?.content || null;
      } catch (probeError) {
        payload.probeOk = false;
        payload.probeError = probeError.response?.data?.error?.message || probeError.message;
      }
    }

    res.json(payload);
  } catch (error) {
    res.status(503).json({
      ok: false,
      provider: getAiProvider(aiConfig),
      aiBaseUrl: getAiBaseUrl(aiConfig),
      error: error.message
    });
  }
});

app.get('/api/ai/models', async (_req, res) => {
  try {
    const models = await getAvailableModels(_req.query.refresh === '1');
    res.json({
      ok: true,
      models
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error.message
    });
  }
});

// Get chats - helps the frontend list who we can talk to
app.get('/api/chats', async (req, res) => {
  try {
    const { provider, accountId } = parseProviderContext(req);
    const cacheKey = chatsCacheKey(provider, accountId);
    const l1Cached = getL1CachedValue(l1ChatsCache, cacheKey);

    if (l1Cached) {
      enqueueSyncTask({
        kind: 'chats',
        provider,
        accountId,
        reason: 'api_chats_l1_hit'
      });
      return res.json({
        items: l1Cached,
        provider,
        accountId,
        cache: { level: 'l1', staleWhileRevalidate: true },
        syncState: getSyncStateSnapshot(provider, accountId, '__all__', 'chats')
      });
    }

    const cachedChats = await Chat.find({ provider, accountId }).sort({ timestamp: -1 }).lean();
    setL1CachedValue(l1ChatsCache, cacheKey, cachedChats, CHATS_CACHE_TTL_MS);

    enqueueSyncTask({
      kind: 'chats',
      provider,
      accountId,
      reason: 'api_chats'
    });

    res.json({
      items: cachedChats,
      provider,
      accountId,
      cache: { level: 'mongo', staleWhileRevalidate: true },
      syncState: getSyncStateSnapshot(provider, accountId, '__all__', 'chats')
    });
  } catch (error) {
    console.error('❌ Fetch chats error:', error.message);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

app.get('/api/chats/:chatId/messages', async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const limit = parsePositiveInt(req.query.limit, 80, 200);
    const { provider, accountId } = parseProviderContext(req);

    if (!chatId) {
      return res.status(400).json({ error: 'Missing chatId' });
    }

    const l1Key = messagesCacheKey(provider, accountId, chatId, limit);
    const l1Cached = getL1CachedValue(l1MessagesCache, l1Key);
    if (l1Cached) {
      enqueueSyncTask({
        kind: 'messages',
        provider,
        accountId,
        conversationId: chatId,
        limit,
        reason: 'api_messages_l1_hit'
      });
      return res.json({
        items: l1Cached,
        provider,
        accountId,
        conversationId: chatId,
        cache: { level: 'l1', staleWhileRevalidate: true },
        syncState: getSyncStateSnapshot(provider, accountId, chatId, 'messages')
      });
    }

    const cachedMessages = await Message.find({
      provider,
      accountId,
      conversationId: chatId
    })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    // Reverse to chronological order for frontend
    const results = cachedMessages.reverse();

    setL1CachedValue(l1MessagesCache, l1Key, results, MESSAGES_CACHE_TTL_MS);
    enqueueSyncTask({
      kind: 'messages',
      provider,
      accountId,
      conversationId: chatId,
      limit,
      reason: 'api_messages'
    });

    res.json({
      items: results,
      provider,
      accountId,
      conversationId: chatId,
      cache: { level: 'mongo', staleWhileRevalidate: true },
      syncState: getSyncStateSnapshot(provider, accountId, chatId, 'messages')
    });
  } catch (error) {
    console.error('❌ Fetch messages error details:', error);
    res.status(500).json({ 
      error: 'Failed to fetch messages', 
      detail: error.message 
    });
  }
});

app.get('/api/chats/:chatId/resources', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { provider, accountId } = parseProviderContext(req);

    if (!chatId) return res.status(400).json({ error: 'Missing chatId' });

    const mediaMessages = await Message.find({
      provider,
      accountId,
      conversationId: chatId,
      mediaUrl: { $exists: true, $ne: null }
    }).sort({ timestamp: -1 }).limit(100).lean();

    const allMessages = await Message.find({
      provider,
      accountId,
      conversationId: chatId,
      body: { $regex: /https?:\/\/[^\s]+/ }
    }).sort({ timestamp: -1 }).limit(100).lean();

    const links = [];
    allMessages.forEach(m => {
      const found = m.body.match(/https?:\/\/[^\s]+/g);
      if (found) {
        found.forEach(url => {
          links.push({
            url,
            timestamp: m.timestamp,
            fromMe: m.fromMe
          });
        });
      }
    });

    const statuses = await StatusArchive.find({
      provider,
      accountId,
      statusOwnerId: chatId
    }).sort({ timestamp: -1 }).limit(50).lean();

    res.json({
      chatId,
      media: mediaMessages,
      links,
      statuses
    });
  } catch (error) {
    console.error('❌ Fetch resources error:', error.message);
    res.status(500).json({ error: 'Failed to fetch resources', detail: error.message });
  }
});

app.post('/api/chats/:chatId/read', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { provider, accountId } = parseProviderContext(req);
    if (!chatId) {
      return res.status(400).json({ error: 'Missing chatId' });
    }

    // Update local cache first
    await Chat.findOneAndUpdate(
      { provider, accountId, conversationId: chatId },
      { unreadCount: 0 },
      { new: true }
    );
    invalidateChatsCache(provider, accountId);

    const adapter = resolveProviderAdapter(provider);
    if (adapter.isReady()) {
      try {
        await adapter.markRead({ accountId, conversationId: chatId });
      } catch (waErr) {
        console.warn(`⚠️ Failed to sendSeen via provider ${provider} for ${chatId}:`, waErr.message);
      }
    }

    res.json({ success: true, provider, accountId, conversationId: chatId });
  } catch (error) {
    console.error('❌ Mark read error:', error.message);
    res.status(500).json({ error: 'Failed to mark chat as read' });
  }
});

// Send message / API Publish
// Accepts chatId via: route param, query string, or JSON body
app.post(['/api/send', '/api/send/:channelCode'], async (req, res) => {
  try {
    const { provider, accountId } = parseProviderContext(req);
    if (provider !== DEFAULT_PROVIDER) {
      return res.status(501).json({
        error: 'Provider not implemented yet',
        provider
      });
    }
    if (!ensureWhatsappReady(res)) return;

    // 1. Resolve chatId from: route param > query > body
    let chatId = String(
      req.params.channelCode || req.query.chatId || req.body?.chatId || ''
    ).trim();

    // 2. Auto-resolve WhatsApp Channel URLs or bare invite codes
    const isChannelUrl = chatId.includes('whatsapp.com/channel/');
    const looksLikeInviteCode = !chatId.includes('@') && /^[A-Za-z0-9_-]{10,}$/.test(chatId);

    if (isChannelUrl || looksLikeInviteCode) {
      const parts = chatId.split('/channel/');
      const code = (parts.length > 1 ? parts[1] : chatId).split('?')[0].trim();

      try {
        console.log(`🔍 Resolving channel for invite code: ${code}...`);
        
        // Call queryNewsletterMetadataByInviteCode directly, skipping getRoleByIdentifier
        // which doesn't exist in current WhatsApp Web version
        const page = client.pupPage;
        const channelData = await page.evaluate(async (inviteCode) => {
          try {
            // Direct Store call - no role parameter needed for resolution
            const response = await window.Store.ChannelUtils.queryNewsletterMetadataByInviteCode(inviteCode);
            if (response && response.idJid) {
              const name = response.newsletterNameMetadataMixin?.nameElementValue || null;
              return { id: response.idJid, name };
            }
            return null;
          } catch (err) {
            if (err.name === 'ServerStatusCodeError') return null;
            return { error: err.message || String(err) };
          }
        }, code);

        if (channelData && channelData.error) {
          return res.status(404).json({
            error: 'Channel resolution failed',
            detail: channelData.error
          });
        }

        if (channelData && channelData.id) {
          chatId = channelData.id;
          console.log(`✅ Channel resolved: ${channelData.name || 'Newsletter'} → ${chatId}`);
        } else {
          console.warn('⚠️ Channel metadata returned empty for:', code);
          return res.status(404).json({
            error: 'Channel not found',
            detail: `Could not resolve invite code: ${code}`
          });
        }
      } catch (err) {
        console.error('❌ Channel resolution failed:', err.message || err);
        return res.status(404).json({
          error: 'Channel resolution failed',
          detail: err.message || 'Unknown error resolving invite code'
        });
      }
    }

    const text = sanitizeTextInput(req.body?.text);
    const originalText = sanitizeTextInput(req.body?.originalText || text);
    const replyToMessageId = String(req.body?.replyToMessageId || '').trim();

    const mediaUrl = String(req.body?.mediaUrl || '').trim();
    const mediaBase64 = String(req.body?.mediaBase64 || '').trim();
    const mediaName = String(req.body?.mediaName || 'image.jpg').trim();
    const mediaMimeType = String(req.body?.mediaMimeType || 'image/jpeg').trim();

    if (!chatId || (!text && !mediaUrl && !mediaBase64)) {
      return res.status(400).json({ error: 'Missing parameters (chatId + text/media)' });
    }

    // 3. Build send options (strip incompatible ones for newsletters)
    const isNewsletter = chatId.includes('@newsletter');
    const sendOptions = {};
    if (replyToMessageId && !isNewsletter) {
      sendOptions.quotedMessageId = replyToMessageId;
    }

    // 4. Send
    if (isNewsletter) {
      // Newsletter: bypass client.sendMessage which crashes on getChat()
      // Send directly through WhatsApp Web internal Store
      let mediaData = null;
      if (mediaUrl || mediaBase64) {
        let media;
        if (mediaUrl) {
          media = await MessageMedia.fromUrl(mediaUrl).catch(e => {
            console.error('❌ Failed to fetch media from URL:', e.message);
            return null;
          });
        } else {
          media = new MessageMedia(mediaMimeType, mediaBase64, mediaName);
        }
        if (!media) {
          return res.status(422).json({ error: 'Failed to process media content' });
        }
        mediaData = { data: media.data, mimetype: media.mimetype, filename: media.filename || 'file' };
      }

      const sendResult = await client.pupPage.evaluate(async (newsletterId, content, mediaInfo) => {
        try {
          // Get or load the channel chat object from the Store directly
          const chatWid = window.Store.WidFactory.createWid(newsletterId);
          let chat = window.Store.WAWebNewsletterMetadataCollection.get(newsletterId);
          if (!chat) {
            await window.Store.ChannelUtils.loadNewsletterPreviewChat(newsletterId);
            chat = await window.Store.WAWebNewsletterMetadataCollection.find(chatWid);
          }
          if (!chat) return { error: 'Could not load channel chat object' };

          // Process media if provided
          let mediaOptions = {};
          let mediaHandle = null;
          if (mediaInfo) {
            const processedMedia = await window.WWebJS.processMediaData(mediaInfo, {
              sendToChannel: true
            });
            mediaOptions = processedMedia.toJSON ? processedMedia.toJSON() : processedMedia;
            mediaHandle = mediaOptions.mediaHandle || null;
          }

          // Build message
          const meUser = window.Store.User.getMaybeMePnUser();
          const newId = await window.Store.MsgKey.newId();
          const newMsgKey = new window.Store.MsgKey({
            from: meUser, to: chat.id, id: newId, selfDir: 'out'
          });

          const ephemeralFields = window.Store.EphemeralFields.getEphemeralFields(chat);
          const msgBody = mediaInfo ? (content || '') : content;
          const message = {
            id: newMsgKey, ack: 0, body: mediaInfo ? '' : content,
            from: meUser, to: chat.id, local: true, self: 'out',
            t: parseInt(new Date().getTime() / 1000), isNewMsg: true, type: 'chat',
            ...ephemeralFields, ...mediaOptions,
            ...(mediaInfo && content ? { caption: content } : {})
          };

          const msg = new window.Store.Msg.modelClass(message);
          const msgData = window.Store.SendChannelMessage.msgDataFromMsgModel(msg);
          const isMedia = mediaInfo != null;
          await window.Store.SendChannelMessage.addNewsletterMsgsRecords([msgData]);
          if (chat.msgs) chat.msgs.add(msg);
          if (chat.t !== undefined) chat.t = msg.t;

          const sendResponse = await window.Store.SendChannelMessage.sendNewsletterMessageJob({
            msg, type: message.type === 'chat' ? 'text' : isMedia ? 'media' : 'text',
            newsletterJid: chat.id.toJid(),
            ...(isMedia ? { mediaMetadata: msg.avParams(), mediaHandle } : {})
          });

          if (sendResponse.success) {
            msg.t = sendResponse.ack.t;
            msg.serverId = sendResponse.serverId;
          }
          msg.updateAck(1, true);
          await window.Store.SendChannelMessage.updateNewsletterMsgRecord(msg);

          return { success: true, serverId: sendResponse.serverId || null };
        } catch (err) {
          return { error: err.message || String(err) };
        }
      }, chatId, text, mediaData);

      if (sendResult && sendResult.error) {
        return res.status(500).json({ error: 'Failed to send to channel', details: sendResult.error });
      }
    } else {
      // Regular chat: use client.sendMessage as usual
      if (mediaUrl || mediaBase64) {
        let media;
        if (mediaUrl) {
          media = await MessageMedia.fromUrl(mediaUrl).catch(e => {
            console.error('❌ Failed to fetch media from URL:', e.message);
            return null;
          });
        } else {
          media = new MessageMedia(mediaMimeType, mediaBase64, mediaName);
        }
        if (!media) {
          return res.status(422).json({ error: 'Failed to process media content' });
        }
        await client.sendMessage(chatId, media, { ...sendOptions, caption: text || undefined });
      } else {
        await client.sendMessage(chatId, text, sendOptions);
      }
    }

    // 5. Cache correction metadata
    // We can't easily upsert here because we don't have the message ID yet,
    // but we can store it temporarily or just rely on the fact that if it's sent from here,
    // we could potentially match it in message_create by body and chatId.
    // For now, let's keep it simple: the UI sends originalText/correctedText,
    // we could use a temporary store or just accept that the very first load might
    // not have the metadata until we implement a better matching.

    res.json({
      success: true,
      chatId,
      provider,
      accountId,
      isNewsletter,
      message: isNewsletter ? 'Published to channel' : 'Message sent'
    });
    enqueueSyncTask({
      kind: 'messages',
      provider,
      accountId,
      conversationId: chatId,
      limit: 120,
      reason: 'send_message'
    });
  } catch (error) {
    const detail = typeof error === 'object'
      ? (error.message || JSON.stringify(error))
      : String(error);
    console.error('❌ Send error:', detail);
    res.status(500).json({
      error: 'Failed to send message',
      details: detail
    });
  }
});

app.get('/api/status', async (_req, res) => {
  res.json({
    whatsappStatus: currentStatus,
    providers: providerRegistry ? providerRegistry.listProviders() : [DEFAULT_PROVIDER],
    hasQr: Boolean(lastQR),
    lastWhatsappReadyAt,
    lastWhatsappDisconnectReason,
    statusArchive: {
      lastRunAt: lastStatusArchiveRunAt,
      inFlight: statusArchivePollInFlight,
      stats: lastStatusArchiveStats
    },
    syncQueue: {
      queued: syncQueue.length,
      pendingKeys: syncPendingKeys.size,
      inFlightKeys: syncInFlightKeys.size
    },
    uptimeSec: Math.floor(process.uptime())
  });
});

app.get('/api/status-archive', async (req, res) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 100, 500);
    const ownerId = String(req.query.ownerId || '').trim();
    const query = {
      provider: DEFAULT_PROVIDER,
      accountId: DEFAULT_ACCOUNT_ID
    };
    if (ownerId) {
      query.statusOwnerId = ownerId;
    }

    const items = await StatusArchive.find(query)
      .sort({ timestamp: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      items,
      meta: {
        limit,
        ownerId: ownerId || null,
        lastRunAt: lastStatusArchiveRunAt,
        inFlight: statusArchivePollInFlight,
        stats: lastStatusArchiveStats
      }
    });
  } catch (error) {
    console.error('❌ Fetch status archive error:', error.message);
    res.status(500).json({ error: 'Failed to fetch status archive', detail: error.message });
  }
});

app.post('/api/status-archive/sweep', async (_req, res) => {
  try {
    const stats = await runStatusArchiveSweep('poll');
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ error: 'Failed to sweep status archive', detail: error.message });
  }
});

app.get('/api/health', async (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const aiConfigured = isAiConfigured(aiConfig);
  const whatsappOk = currentStatus === 'authenticated' || currentStatus === 'qr';
  res.status(mongoOk ? 200 : 503).json({
    ok: mongoOk,
    services: {
      mongo: mongoOk ? 'up' : 'down',
      whatsapp: whatsappOk ? currentStatus : 'down',
      ai: aiConfigured ? 'configured' : 'missing'
    },
    uptimeSec: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/sync/state', async (req, res) => {
  try {
    const { provider, accountId } = parseProviderContext(req);
    const kind = req.query.kind === 'messages' ? 'messages' : 'chats';
    const conversationId = String(req.query.conversationId || (kind === 'messages' ? '' : '__all__')).trim();
    const safeConversationId = conversationId || '__all__';
    const local = getSyncStateSnapshot(provider, accountId, safeConversationId, kind);
    const persisted = await SyncState.findOne({
      provider,
      accountId,
      conversationId: safeConversationId,
      kind
    }).lean();
    res.json({
      provider,
      accountId,
      conversationId: safeConversationId,
      kind,
      local,
      persisted: persisted || null
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sync state', detail: error.message });
  }
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});

loadAiConfig();
