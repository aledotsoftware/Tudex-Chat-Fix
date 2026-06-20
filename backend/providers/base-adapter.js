const { EventEmitter } = require('events');

class BaseAdapter extends EventEmitter {
  constructor(provider, accountId) {
    super();
    this.provider = String(provider || '').trim().toLowerCase();
    if (!this.provider) {
      throw new Error('Provider adapter requires a provider name');
    }
    this.accountId = String(accountId || 'default').trim();
    this._isReady = false;
    this._status = 'initializing';

    this._bindDefaultEvents();
  }

  _bindDefaultEvents() {
    this.on('qr', () => {
      this._status = 'qr';
      this._isReady = false;
    });
    this.on('ready', () => {
      this._status = 'authenticated';
      this._isReady = true;
    });
    this.on('authenticated', () => {
      this._status = 'authenticated';
    });
    this.on('auth_failure', () => {
      this._status = 'auth_failure';
      this._isReady = false;
    });
    this.on('disconnected', () => {
      this._status = 'disconnected';
      this._isReady = false;
    });
  }

  getProviderName() {
    return this.provider;
  }

  getAccountId() {
    return this.accountId;
  }

  initialize() {
    // default implementation is empty. override if needed.
  }

  isReady() {
    return this._isReady;
  }

  getStatus() {
    return this._status;
  }

  async listChats({ provider, accountId } = {}) {
    throw new Error(`listChats() not implemented for provider=${this.provider}`);
  }

  async fetchMessages({ provider, accountId, conversationId, limit = 80 }) {
    throw new Error(`fetchMessages() not implemented for provider=${this.provider}`);
  }

  async markRead({ provider, accountId, conversationId }) {
    throw new Error(`markRead() not implemented for provider=${this.provider}`);
  }

  async sendMessage({ provider, accountId, conversationId, chatId, text, replyToMessageId, mediaUrl, mediaBase64, mediaName, mediaMimeType }) {
    throw new Error(`sendMessage() not implemented for provider=${this.provider}`);
  }

  async getMessageById(messageId, { provider, accountId, conversationId } = {}) {
    throw new Error(`getMessageById() not implemented for provider=${this.provider}`);
  }

  async fetchStatusDescriptors({ provider, accountId } = {}) {
    throw new Error(`fetchStatusDescriptors() not implemented for provider=${this.provider}`);
  }

  async markStatusRead({ provider, accountId } = {}) {
    throw new Error(`markStatusRead() not implemented for provider=${this.provider}`);
  }

  async downloadMedia(message, { provider, accountId, conversationId } = {}) {
    throw new Error(`downloadMedia() not implemented for provider=${this.provider}`);
  }

  async getQuotedMessage(message, { provider, accountId, conversationId } = {}) {
    throw new Error(`getQuotedMessage() not implemented for provider=${this.provider}`);
  }

  async getChatAvatarUrl(chat, { provider, accountId } = {}) {
    throw new Error(`getChatAvatarUrl() not implemented for provider=${this.provider}`);
  }

  async getChatByMessage(message, { provider, accountId, conversationId } = {}) {
    throw new Error(`getChatByMessage() not implemented for provider=${this.provider}`);
  }

  isStatusMessage(message, { provider, accountId } = {}) {
    throw new Error(`isStatusMessage() not implemented for provider=${this.provider}`);
  }

  hasMedia(message, { provider, accountId, conversationId } = {}) {
    throw new Error(`hasMedia() not implemented for provider=${this.provider}`);
  }

  hasQuotedMsg(message, { provider, accountId, conversationId } = {}) {
    throw new Error(`hasQuotedMsg() not implemented for provider=${this.provider}`);
  }

  getChatIdFromMessage(message, { provider, accountId, conversationId } = {}) {
    throw new Error(`getChatIdFromMessage() not implemented for provider=${this.provider}`);
  }

  extractMessageContext(message, { provider, accountId, conversationId } = {}) {
    throw new Error(`extractMessageContext() not implemented for provider=${this.provider}`);
  }

  extractChatContext(chat, { provider, accountId, conversationId } = {}) {
    throw new Error(`extractChatContext() not implemented for provider=${this.provider}`);
  }

  extractStatusDescriptor(message, { provider, accountId } = {}) {
    throw new Error(`extractStatusDescriptor() not implemented for provider=${this.provider}`);
  }
}

module.exports = { BaseAdapter };
