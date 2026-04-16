class ProviderRegistry {
  constructor() {
    this.adapters = new Map();
  }

  register(adapter) {
    const name = adapter.getProviderName();
    this.adapters.set(name, adapter);
    return adapter;
  }

  resolve(provider) {
    const key = String(provider || '').trim().toLowerCase();
    const adapter = this.adapters.get(key);
    if (!adapter) {
      throw new Error(`Provider adapter not found: ${provider}`);
    }
    return adapter;
  }

  listProviders() {
    return Array.from(this.adapters.keys());
  }
}

module.exports = { ProviderRegistry };
