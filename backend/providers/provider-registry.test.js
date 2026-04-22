const { test, describe } = require('node:test');
const assert = require('node:assert');
const { ProviderRegistry } = require('./provider-registry');

describe('ProviderRegistry', () => {
  const createMockAdapter = (name) => ({
    getProviderName: () => name,
    isReady: () => true,
    getStatus: () => 'ready'
  });

  test('register() should add an adapter to the registry', () => {
    const registry = new ProviderRegistry();
    const adapter = createMockAdapter('whatsapp');

    const result = registry.register(adapter);

    assert.strictEqual(result, adapter);
    assert.deepStrictEqual(registry.listProviders(), ['whatsapp']);
  });

  test('resolve() should return the correct adapter for a valid key', () => {
    const registry = new ProviderRegistry();
    const adapter = createMockAdapter('whatsapp');
    registry.register(adapter);

    const resolved = registry.resolve('whatsapp');

    assert.strictEqual(resolved, adapter);
  });

  test('resolve() should be case-insensitive and trim whitespace', () => {
    const registry = new ProviderRegistry();
    const adapter = createMockAdapter('whatsapp');
    registry.register(adapter);

    assert.strictEqual(registry.resolve(' WhatsApp '), adapter);
    assert.strictEqual(registry.resolve('WHATSAPP'), adapter);
  });

  test('resolve() should throw an error for non-existent providers', () => {
    const registry = new ProviderRegistry();

    assert.throws(() => {
      registry.resolve('telegram');
    }, /Provider adapter not found: telegram/);
  });

  test('resolve() should throw an error for null, undefined, or empty input', () => {
    const registry = new ProviderRegistry();

    assert.throws(() => {
      registry.resolve(null);
    }, /Provider adapter not found: null/);

    assert.throws(() => {
      registry.resolve(undefined);
    }, /Provider adapter not found: undefined/);

    assert.throws(() => {
      registry.resolve('');
    }, /Provider adapter not found: /);
  });

  test('listProviders() should return all registered provider names', () => {
    const registry = new ProviderRegistry();
    registry.register(createMockAdapter('whatsapp'));
    registry.register(createMockAdapter('telegram'));

    const providers = registry.listProviders();

    assert.strictEqual(providers.length, 2);
    assert.ok(providers.includes('whatsapp'));
    assert.ok(providers.includes('telegram'));
  });
});
