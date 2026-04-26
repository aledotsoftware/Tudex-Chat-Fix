const { EventEmitter } = require('events');

class BaseAdapter extends EventEmitter {
  constructor(provider) {
    super();
    this.provider = String(provider || '').trim().toLowerCase();
    if (!this.provider) {
      throw new Error('Provider adapter requires a provider name');
    }
  }

  getProviderName() {
    return this.provider;
  }

  initialize() {
    throw new Error(`initialize() not implemented for provider=${this.provider}`);
  }

  isReady() {
    throw new Error(`isReady() not implemented for provider=${this.provider}`);
  }

  getStatus() {
    throw new Error(`getStatus() not implemented for provider=${this.provider}`);
  }

  async listChats(_ctx) {
    throw new Error(`listChats() not implemented for provider=${this.provider}`);
  }

  async fetchMessages(_ctx) {
    throw new Error(`fetchMessages() not implemented for provider=${this.provider}`);
  }

  async markRead(_ctx) {
    throw new Error(`markRead() not implemented for provider=${this.provider}`);
  }

  async sendMessage(_ctx) {
    throw new Error(`sendMessage() not implemented for provider=${this.provider}`);
  }

  async getMessageById(messageId) {
    throw new Error(`getMessageById() not implemented for provider=${this.provider}`);
  }

  async fetchStatusDescriptors() {
    throw new Error(`fetchStatusDescriptors() not implemented for provider=${this.provider}`);
  }

  async markStatusRead() {
    throw new Error(`markStatusRead() not implemented for provider=${this.provider}`);
  }

  async downloadMedia(message) {
    throw new Error(`downloadMedia() not implemented for provider=${this.provider}`);
  }

  async getQuotedMessage(message) {
    throw new Error(`getQuotedMessage() not implemented for provider=${this.provider}`);
  }

  async getChatAvatarUrl(chat) {
    throw new Error(`getChatAvatarUrl() not implemented for provider=${this.provider}`);
  }

  async getChatByMessage(message) {
    throw new Error(`getChatByMessage() not implemented for provider=${this.provider}`);
  }

  isStatusMessage(message) {
    throw new Error(`isStatusMessage() not implemented for provider=${this.provider}`);
  }

  getChatIdFromMessage(message) {
    throw new Error(`getChatIdFromMessage() not implemented for provider=${this.provider}`);
  }
}

module.exports = { BaseAdapter };
