const fs = require('fs');
let code = fs.readFileSync('backend/index.js', 'utf8');

code = code.replace(
  `let lastQR = null;
let currentStatus = 'connecting';
let whatsappReady = false;
let lastWhatsappReadyAt = null;
let lastWhatsappDisconnectReason = null;`,
  `const providerStates = new Map();
function getProviderState(provider) {
  const key = String(provider || '').trim().toLowerCase();
  if (!providerStates.has(key)) {
    providerStates.set(key, {
      status: 'connecting',
      isReady: false,
      lastQR: null,
      lastReadyAt: null,
      lastDisconnectReason: null
    });
  }
  return providerStates.get(key);
}`
);

fs.writeFileSync('backend/index.js', code);
