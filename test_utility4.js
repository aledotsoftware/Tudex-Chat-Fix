const { WhatsAppAdapter } = require('./backend/providers/whatsapp-adapter');
const adapter = new WhatsAppAdapter();

console.log(adapter.getChatIdFromMessage({ fromMe: false, from: 'user1' }));
console.log(adapter.getChatIdFromMessage({ fromMe: true, to: 'user2' }));
console.log(adapter.getChatIdFromMessage('user3'));
