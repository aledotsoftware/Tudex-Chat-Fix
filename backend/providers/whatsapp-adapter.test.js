const { test, describe } = require('node:test');
const assert = require('node:assert');
const { WhatsAppAdapter } = require('./whatsapp-adapter');

describe('WhatsAppAdapter', () => {
  const mockChat = {
    fetchMessages: async ({ limit }) => Array(limit).fill({ id: 'msg' }),
    sendSeen: async () => { mockChat.seenSent = true; }
  };

  const mockClient = {
    getChats: async () => [{ id: 'chat1' }],
    getChatById: async (id) => id === 'valid' ? mockChat : null
  };

  test('isReady() should return true when isReadyFn returns true', () => {
    const adapter = new WhatsAppAdapter({ isReady: () => true });
    assert.strictEqual(adapter.isReady(), true);
  });

  test('isReady() should return false when isReadyFn is not provided', () => {
    const adapter = new WhatsAppAdapter({});
    assert.strictEqual(adapter.isReady(), false);
  });

  test('getStatus() should return the status from getStatusFn', () => {
    const adapter = new WhatsAppAdapter({ getStatus: () => 'connected' });
    assert.strictEqual(adapter.getStatus(), 'connected');
  });

  test('getStatus() should return "unknown" when getStatusFn is not provided', () => {
    const adapter = new WhatsAppAdapter({});
    assert.strictEqual(adapter.getStatus(), 'unknown');
  });

  test('listChats() should delegate to client.getChats', async () => {
    const adapter = new WhatsAppAdapter({ client: mockClient });
    const chats = await adapter.listChats();
    assert.deepStrictEqual(chats, [{ id: 'chat1' }]);
  });

  describe('fetchMessages', () => {
    test('should return messages for a valid conversationId', async () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      const messages = await adapter.fetchMessages({ conversationId: 'valid', limit: 10 });
      assert.strictEqual(messages.length, 10);
    });

    test('should use default limit of 80', async () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      const messages = await adapter.fetchMessages({ conversationId: 'valid' });
      assert.strictEqual(messages.length, 80);
    });

    test('should return empty array if chat not found', async () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      const messages = await adapter.fetchMessages({ conversationId: 'invalid' });
      assert.deepStrictEqual(messages, []);
    });
  });

  describe('markRead', () => {
    test('should use markReadFn if provided', async () => {
      let called = false;
      const adapter = new WhatsAppAdapter({
        markRead: ({ conversationId }) => {
          called = conversationId === 'testId';
        }
      });
      await adapter.markRead({ conversationId: 'testId' });
      assert.strictEqual(called, true);
    });

    test('should delegate to chat.sendSeen if markReadFn is not provided and chat exists', async () => {
      mockChat.seenSent = false;
      const adapter = new WhatsAppAdapter({ client: mockClient });
      await adapter.markRead({ conversationId: 'valid' });
      assert.strictEqual(mockChat.seenSent, true);
    });

    test('should do nothing if markReadFn is not provided and chat does not exist', async () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      // Should not throw
      await adapter.markRead({ conversationId: 'invalid' });
    });
  });
});
