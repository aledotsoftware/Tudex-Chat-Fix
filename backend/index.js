const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
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

io.on('connection', (socket) => {
  console.log('🔌 Frontend client connected to socket');
  if (currentStatus === 'qr' && lastQR) {
    socket.emit('qr', lastQR);
  } else if (currentStatus === 'authenticated') {
    socket.emit('ready', { status: 'authenticated' });
  }
});

app.use(cors());
app.use(express.json());

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
  timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', MessageSchema);

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
    executablePath: '/usr/bin/google-chrome-stable'
  }
});

client.on('qr', (qr) => {
  console.log('📡 QR Received - Emitting to frontend...');
  lastQR = qr;
  currentStatus = 'qr';
  io.emit('qr', qr);
});

client.on('ready', () => {
  console.log('✅ Client is ready!');
  lastQR = null;
  currentStatus = 'authenticated';
  io.emit('ready', { status: 'authenticated' });
});

client.on('authenticated', () => {
  console.log('AUTHENTICATED');
});

client.on('auth_failure', msg => {
  console.error('AUTHENTICATION FAILURE', msg);
  io.emit('auth_failure', msg);
});

client.on('disconnected', (reason) => {
  console.log('Client was logged out', reason);
  io.emit('disconnected', reason);
});

// Message handling
client.on('message', async (msg) => {
  io.emit('new_message', {
    from: msg.from,
    body: msg.body,
    timestamp: msg.timestamp
  });
});

client.initialize();

// AI API endpoint
app.post('/api/correct', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });

    const prompt = `Actúa como un corrector de mensajes de WhatsApp. Corrige la ortografía, gramática y mejora el estilo del siguiente mensaje, manteniendo el tono original. Devuelve ÚNICAMENTE el texto corregido.

    Mensaje original: "${text}"`;

    const response = await axios.post(process.env.LM_STUDIO_URL || 'http://localhost:1234/v1/chat/completions', {
      model: process.env.MODEL_NAME || "llama-3.1-8b-instruct",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const correctedText = response.data.choices[0].message.content.trim();
    // Some models wrap in quotes, remove them
    const cleanedText = correctedText.replace(/^"(.*)"$/, '$1');

    res.json({ original: text, corrected: cleanedText });
  } catch (error) {
    console.error('❌ AI error:', error.message);
    res.status(500).json({ error: 'AI server error' });
  }
});

// Get chats - helps the frontend list who we can talk to
app.get('/api/chats', async (req, res) => {
  try {
    const chats = await client.getChats();
    res.json(chats.map(c => ({
      id: c.id._serialized,
      name: c.name,
      unreadCount: c.unreadCount,
      timestamp: c.timestamp
    })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// Send message
app.post('/api/send', async (req, res) => {
  try {
    const { chatId, text, originalText } = req.body;
    if (!chatId || !text) return res.status(400).json({ error: 'Missing parameters' });

    await client.sendMessage(chatId, text);

    // Store in DB
    const msg = new Message({
      to: chatId,
      originalText: originalText || text,
      correctedText: text,
      sentText: text
    });
    await msg.save();

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Send error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});
