const { test, describe } = require('node:test');
const assert = require('node:assert');
const { BaseAdapter } = require('./base-adapter');

describe('BaseAdapter', () => {
  test('constructor should set provider name, trim and lowercase it', () => {
    const adapter = new BaseAdapter('  WhatsApp  ');
    assert.strictEqual(adapter.getProviderName(), 'whatsapp');
  });

  test('constructor should throw if provider name is missing or empty', () => {
    assert.throws(() => new BaseAdapter(), /Provider adapter requires a provider name/);
    assert.throws(() => new BaseAdapter(''), /Provider adapter requires a provider name/);
    assert.throws(() => new BaseAdapter('   '), /Provider adapter requires a provider name/);
  });

  test('getProviderName() should return the provider name', () => {
    const adapter = new BaseAdapter('test-provider');
    assert.strictEqual(adapter.getProviderName(), 'test-provider');
  });

  test('isReady() should return the internal state', () => {
    const adapter = new BaseAdapter('test');
    assert.strictEqual(adapter.isReady(), false);
    adapter._isReady = true;
    assert.strictEqual(adapter.isReady(), true);
  });

  test('getStatus() should return the internal status', () => {
    const adapter = new BaseAdapter('test');
    assert.strictEqual(adapter.getStatus(), 'initializing');
    adapter._status = 'connected';
    assert.strictEqual(adapter.getStatus(), 'connected');
  });

  test('listChats() should throw not implemented error', async () => {
    const adapter = new BaseAdapter('test');
    await assert.rejects(() => adapter.listChats({}), /listChats\(\) not implemented for provider=test/);
  });

  test('fetchMessages() should throw not implemented error', async () => {
    const adapter = new BaseAdapter('test');
    await assert.rejects(() => adapter.fetchMessages({}), /fetchMessages\(\) not implemented for provider=test/);
  });

  test('markRead() should throw not implemented error', async () => {
    const adapter = new BaseAdapter('test');
    await assert.rejects(() => adapter.markRead({}), /markRead\(\) not implemented for provider=test/);
  });

  test('getChatByMessage() should throw not implemented error', async () => {
    const adapter = new BaseAdapter('test');
    await assert.rejects(() => adapter.getChatByMessage({}), /getChatByMessage\(\) not implemented for provider=test/);
  });

  test('isStatusMessage() should throw not implemented error', () => {
    const adapter = new BaseAdapter('test');
    assert.throws(() => adapter.isStatusMessage({}), /isStatusMessage\(\) not implemented for provider=test/);
  });

  test('getChatIdFromMessage() should throw not implemented error', () => {
    const adapter = new BaseAdapter('test');
    assert.throws(() => adapter.getChatIdFromMessage({}), /getChatIdFromMessage\(\) not implemented for provider=test/);
  });
});
