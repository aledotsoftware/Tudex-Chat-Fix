const fs = require('fs');
let code = fs.readFileSync('backend/index.js', 'utf8');

// Replacements for io.on connection
code = code.replace(
  `io.on('connection', (socket) => {
  console.log('🔌 Frontend client connected to socket');
  if (currentStatus === 'qr' && lastQR) {
    socket.emit('qr', lastQR);
  } else if (currentStatus === 'authenticated') {
    socket.emit('ready', { status: 'authenticated' });
  }
});`,
  `io.on('connection', (socket) => {
  console.log('🔌 Frontend client connected to socket');
  const defaultState = getProviderState(DEFAULT_PROVIDER);
  if (defaultState.status === 'qr' && defaultState.lastQR) {
    socket.emit('qr', defaultState.lastQR);
  } else if (defaultState.status === 'authenticated') {
    socket.emit('ready', { status: 'authenticated' });
  }
});`
);

// Replacements for fetchCurrentStatusDescriptors
code = code.replace(
  `async function fetchCurrentStatusDescriptors() {
  const adapter = resolveProviderAdapter(DEFAULT_PROVIDER);
  if (typeof adapter.fetchStatusDescriptors === 'function') {
    return adapter.fetchStatusDescriptors();
  }
  return [];
}`,
  `async function fetchCurrentStatusDescriptors() {
  const adapter = resolveProviderAdapter(DEFAULT_PROVIDER);
  if (typeof adapter.fetchStatusDescriptors === 'function') {
    return adapter.fetchStatusDescriptors();
  }
  return [];
}`
);

// Replacements for runStatusArchiveSweep
code = code.replace(
  `  if (!whatsappReady || currentStatus !== 'authenticated') {
    return { checked: 0, archived: 0, skipped: 0, errors: 0, source };
  }`,
  `  const adapter = resolveProviderAdapter(provider);
  if (!adapter.isReady()) {
    return { checked: 0, archived: 0, skipped: 0, errors: 0, source };
  }`
);


// Replacements for init code
code = code.replace(
  `waAdapter.on('qr', (qr) => {
  console.log('📡 QR Received - Emitting to frontend...');
  lastQR = qr;
  currentStatus = 'qr';
  whatsappReady = false;
  lastWhatsappDisconnectReason = null;
  io.emit('qr', qr);
});

waAdapter.on('ready', () => {
  console.log('✅ Client is ready!');
  lastQR = null;
  currentStatus = 'authenticated';
  whatsappReady = true;
  lastWhatsappReadyAt = new Date().toISOString();
  lastWhatsappDisconnectReason = null;
  io.emit('ready', { status: 'authenticated' });`,
  `waAdapter.on('qr', (qr) => {
  console.log('📡 QR Received - Emitting to frontend...');
  const state = getProviderState(waAdapter.getProviderName());
  state.lastQR = qr;
  state.status = 'qr';
  state.isReady = false;
  state.lastDisconnectReason = null;
  io.emit('qr', qr);
});

waAdapter.on('ready', () => {
  console.log('✅ Client is ready!');
  const state = getProviderState(waAdapter.getProviderName());
  state.lastQR = null;
  state.status = 'authenticated';
  state.isReady = true;
  state.lastReadyAt = new Date().toISOString();
  state.lastDisconnectReason = null;
  io.emit('ready', { status: 'authenticated' });`
);

code = code.replace(
  `waAdapter.on('auth_failure', msg => {
  console.error('AUTHENTICATION FAILURE', msg);
  whatsappReady = false;
  io.emit('auth_failure', msg);
});

waAdapter.on('disconnected', (reason) => {
  console.log('Client was logged out', reason);
  whatsappReady = false;
  lastWhatsappDisconnectReason = String(reason || 'unknown');
  io.emit('disconnected', reason);
});`,
  `waAdapter.on('auth_failure', msg => {
  console.error('AUTHENTICATION FAILURE', msg);
  const state = getProviderState(waAdapter.getProviderName());
  state.isReady = false;
  state.status = 'auth_failure';
  io.emit('auth_failure', msg);
});

waAdapter.on('disconnected', (reason) => {
  console.log('Client was logged out', reason);
  const state = getProviderState(waAdapter.getProviderName());
  state.isReady = false;
  state.status = 'disconnected';
  state.lastDisconnectReason = String(reason || 'unknown');
  io.emit('disconnected', reason);
});`
);

code = code.replace(
  `function ensureWhatsappReady(res) {
  if (!whatsappReady || currentStatus !== 'authenticated') {
    res.status(503).json({
      error: 'WhatsApp client not ready',
      whatsappStatus: currentStatus,
      ready: whatsappReady
    });
    return false;
  }
  return true;
}`,
  `function ensureProviderReady(res, provider) {
  const adapter = resolveProviderAdapter(provider);
  if (!adapter.isReady()) {
    res.status(503).json({
      error: \`\${provider} client not ready\`,
      providerStatus: adapter.getStatus(),
      ready: false
    });
    return false;
  }
  return true;
}`
);

// We need to also replace the status endpoint and health endpoint.
code = code.replace(
  `app.get('/api/status', async (_req, res) => {
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
});`,
  `app.get('/api/status', async (_req, res) => {
  const defaultState = getProviderState(DEFAULT_PROVIDER);
  res.json({
    whatsappStatus: defaultState.status,
    providers: providerRegistry ? providerRegistry.listProviders() : [DEFAULT_PROVIDER],
    hasQr: Boolean(defaultState.lastQR),
    lastWhatsappReadyAt: defaultState.lastReadyAt,
    lastWhatsappDisconnectReason: defaultState.lastDisconnectReason,
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
});`
);

code = code.replace(
  `app.get('/api/health', async (_req, res) => {
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
});`,
  `app.get('/api/health', async (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const aiConfigured = isAiConfigured(aiConfig);
  const defaultState = getProviderState(DEFAULT_PROVIDER);
  const whatsappOk = defaultState.status === 'authenticated' || defaultState.status === 'qr';
  res.status(mongoOk ? 200 : 503).json({
    ok: mongoOk,
    services: {
      mongo: mongoOk ? 'up' : 'down',
      whatsapp: whatsappOk ? defaultState.status : 'down',
      ai: aiConfigured ? 'configured' : 'missing'
    },
    uptimeSec: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});`
);

fs.writeFileSync('backend/index.js', code);
