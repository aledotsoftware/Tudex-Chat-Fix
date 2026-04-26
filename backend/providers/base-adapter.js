class BaseAdapter {
  constructor(provider) {
    this.provider = String(provider || '').trim().toLowerCase();
    if (!this.provider) {
      throw new Error('Provider adapter requires a provider name');
    }
  }

  getProviderName() {
    return this.provider;
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
}

module.exports = { BaseAdapter };
