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
}

module.exports = { BaseAdapter };
