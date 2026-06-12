class ProviderRegistry {
  constructor() {
    this.adapters = new Map();
  }

  register(adapter) {
    const name = adapter.getProviderName();
    const accountId = typeof adapter.getAccountId === 'function' ? adapter.getAccountId() : 'default';
    const key = `${name}:${accountId}`;
    this.adapters.set(key, adapter);
    return adapter;
  }

  resolve(provider, accountId = 'default') {
    const providerKey = String(provider || '').trim().toLowerCase();
    const accKey = String(accountId || 'default').trim();
    const key = `${providerKey}:${accKey}`;
    let adapter = this.adapters.get(key);

    if (!adapter) {
      // Fallback for backwards compatibility if they just look up by provider
      const fallbackKey = `${providerKey}:default`;
      adapter = this.adapters.get(fallbackKey);
    }

    if (!adapter) {
      throw new Error(`Provider adapter not found: ${provider} (account: ${accountId})`);
    }
    return adapter;
  }

  listProviders() {
    // Return unique provider names
    const names = new Set();
    for (const key of this.adapters.keys()) {
      names.add(key.split(':')[0]);
    }
    return Array.from(names);
  }

  getAdapters() {
    return Array.from(this.adapters.values());
  }

  initializeAll() {
    for (const [name, adapter] of this.adapters.entries()) {
      try {
        if (!adapter.isReady()) {
          console.log(`🚀 Initializing provider adapter: ${name}...`);
          adapter.initialize();
        }
      } catch (err) {
        console.error(`❌ Failed to initialize provider ${name}:`, err.message);
      }
    }
  }

  initializeProvider(providerName, accountId = 'default') {
    const adapter = this.resolve(providerName, accountId);
    if (!adapter.isReady()) {
      console.log(`🚀 Initializing provider adapter: ${providerName} (account: ${accountId})...`);
      adapter.initialize();
    }
  }
}

module.exports = { ProviderRegistry };
