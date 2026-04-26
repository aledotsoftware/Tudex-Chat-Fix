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

  test('isReady() should throw not implemented error', () => {
    const adapter = new BaseAdapter('test');
    assert.throws(() => adapter.isReady(), /isReady\(\) not implemented for provider=test/);
  });

  test('getStatus() should throw not implemented error', () => {
    const adapter = new BaseAdapter('test');
    assert.throws(() => adapter.getStatus(), /getStatus\(\) not implemented for provider=test/);
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
});
