const { BaseAdapter } = require('./base-adapter');

class WhatsAppAdapter extends BaseAdapter {
  constructor(options) {
    super('whatsapp');
    this.client = options.client;
    this.getStatusFn = options.getStatus;
    this.isReadyFn = options.isReady;
    this.markReadFn = options.markRead;
  }

  isReady() {
    return Boolean(this.isReadyFn?.());
  }

  getStatus() {
    return String(this.getStatusFn?.() || 'unknown');
  }

  async listChats() {
    return this.client.getChats();
  }

  async fetchMessages({ conversationId, limit = 80 }) {
    const chat = await this.client.getChatById(conversationId);
    if (!chat) return [];
    return chat.fetchMessages({ limit });
  }

  async markRead({ conversationId }) {
    if (typeof this.markReadFn === 'function') {
      return this.markReadFn({ conversationId });
    }
    const chat = await this.client.getChatById(conversationId);
    if (chat) {
      await chat.sendSeen();
    }
  }
}

module.exports = { WhatsAppAdapter };
