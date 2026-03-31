const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');
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
const AVATAR_TTL_MS = Number(process.env.AVATAR_TTL_MS || 10 * 60 * 1000);
const AVATAR_FETCH_LIMIT = Number(process.env.AVATAR_FETCH_LIMIT || 40);
const AVATAR_FETCH_TIMEOUT_MS = Number(process.env.AVATAR_FETCH_TIMEOUT_MS || 7000);
let aiErrorLogState = {
  signature: '',
  count: 0,
  lastAt: 0
};

// API Key authentication middleware
const API_KEY = process.env.API_KEY || ''; // If empty, authentication is disabled

const authenticateApiKey = (req, res, next) => {
  if (!API_KEY) return next();
  
  const providedKey = req.headers['x-api-key'] || req.query.api_key;
  if (providedKey !== API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'A valid API Key is required in X-API-Key header or api_key query parameter.'
    });
  }
  next();
};

io.on('connection', (socket) => {
  console.log('🔌 Frontend client connected to socket');
  if (currentStatus === 'qr' && lastQR) {
    socket.emit('qr', lastQR);
  } else if (currentStatus === 'authenticated') {
    socket.emit('ready', { status: 'authenticated' });
  }
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatfix')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

const MessageSchema = new mongoose.Schema({
  from: String,
  to: String,
  originalText: String,
  correctedText: String,
  sentText: String,
  replyToMessageId: String,
  timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', MessageSchema);
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
  timeoutMs: Number(process.env.AI_TIMEOUT_MS || 90000)
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
    timeout: Number(options.timeoutMs ?? activeConfig.timeoutMs ?? 90000),
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

async function buildMediaPayload(message) {
  if (!message.hasMedia) {
    return { mediaType: null, imageDataUrl: null };
  }

  try {
    const media = await message.downloadMedia();
    if (!media || !media.mimetype) {
      return { mediaType: null, imageDataUrl: null };
    }

    if (media.mimetype.startsWith('image/')) {
      return {
        mediaType: 'image',
        imageDataUrl: `data:${media.mimetype};base64,${media.data}`
      };
    }
  } catch (error) {
    console.error('⚠️ Media parse error:', error.message);
  }

  return { mediaType: null, imageDataUrl: null };
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

async function serializeMessage(message, chatId) {
  const mediaPayload = await buildMediaPayload(message);
  const replyPayload = await buildReplyPayload(message);
  return {
    id: message?.id?._serialized || `${message?.timestamp}-${Math.random()}`,
    chatId,
    body: message?.body || '',
    timestamp: message?.timestamp || Math.floor(Date.now() / 1000),
    fromMe: Boolean(message?.fromMe),
    from: message?.from,
    to: message?.to,
    mediaType: mediaPayload.mediaType,
    imageDataUrl: mediaPayload.imageDataUrl,
    replyToMessageId: replyPayload.replyToMessageId,
    replyToText: replyPayload.replyToText,
    mentionedIds: Array.isArray(message?.mentionedIds) ? message.mentionedIds : []
  };
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
    : '/usr/bin/google-chrome-stable');

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
      '--disable-gpu'
    ],
    executablePath: chromeExecutablePath
  }
});

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

// Message handling (incoming and outgoing)
client.on('message_create', async (msg) => {
  let chatId = msg.from;
  if (msg.fromMe) {
    chatId = msg.to;
  }
  const payload = await serializeMessage(msg, chatId);
  io.emit('new_message', payload);
});

client.initialize();

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
          timeout: Math.min(Number(aiConfig.timeoutMs ?? 90000), 25000),
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
    if (!ensureWhatsappReady(res)) return;
    const chats = await client.getChats();
    const normalized = await Promise.all(chats.map(async (c, index) => ({
      id: c.id._serialized,
      name: c.name,
      unreadCount: c.unreadCount,
      timestamp: c.timestamp,
      isGroup: Boolean(c.isGroup),
      avatarUrl: await getChatAvatar(c, index)
    })));
    res.json(normalized);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

app.get('/api/chats/:chatId/messages', async (req, res) => {
  try {
    if (!ensureWhatsappReady(res)) return;
    const { chatId } = req.params;
    const limit = parsePositiveInt(req.query.limit, 80, 200);
    if (!chatId) {
      return res.status(400).json({ error: 'Missing chatId' });
    }

    const chats = await client.getChats();
    const chat = chats.find(c => c.id && c.id._serialized === chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const messages = await chat.fetchMessages({ limit });

    const normalized = await Promise.all(messages.map((m) => serializeMessage(m, chatId)));

    res.json(normalized);
  } catch (error) {
    console.error('❌ Fetch messages error:', error.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/chats/:chatId/read', async (req, res) => {
  try {
    if (!ensureWhatsappReady(res)) return;
    const { chatId } = req.params;
    if (!chatId) {
      return res.status(400).json({ error: 'Missing chatId' });
    }

    const chats = await client.getChats();
    const chat = chats.find(c => c.id && c.id._serialized === chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    if (typeof chat.sendSeen === 'function') {
      await chat.sendSeen();
    } else {
      await client.sendSeen(chatId);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Mark read error:', error.message);
    res.status(500).json({ error: 'Failed to mark chat as read' });
  }
});

// Send message / API Publish
// Accepts chatId via: route param, query string, or JSON body
app.post('/api/send{/:channelCode}', authenticateApiKey, async (req, res) => {
  try {
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

    // 5. Store in DB
    const msg = new Message({
      to: chatId,
      originalText: originalText || text,
      correctedText: text,
      sentText: text,
      replyToMessageId: isNewsletter ? null : (replyToMessageId || null)
    });
    await msg.save();

    res.json({
      success: true,
      chatId,
      isNewsletter,
      message: isNewsletter ? 'Published to channel' : 'Message sent'
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
    hasQr: Boolean(lastQR),
    lastWhatsappReadyAt,
    lastWhatsappDisconnectReason,
    uptimeSec: Math.floor(process.uptime())
  });
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

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});

loadAiConfig();
