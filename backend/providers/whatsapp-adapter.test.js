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

  test('isReady() should return the internal ready state', () => {
    const adapter = new WhatsAppAdapter({ client: mockClient });
    assert.strictEqual(adapter.isReady(), false);
    adapter._isReady = true;
    assert.strictEqual(adapter.isReady(), true);
  });

  test('getStatus() should return the internal status state', () => {
    const adapter = new WhatsAppAdapter({ client: mockClient });
    assert.strictEqual(adapter.getStatus(), 'initializing');
    adapter._status = 'authenticated';
    assert.strictEqual(adapter.getStatus(), 'authenticated');
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

  describe('getChatByMessage', () => {
    test('should delegate to message.getChat if function exists', async () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      const mockChatInstance = { id: 'chat123' };
      const mockMessage = {
        getChat: async () => mockChatInstance
      };

      const chat = await adapter.getChatByMessage(mockMessage);
      assert.strictEqual(chat.id, 'chat123');
    });

    test('should return null if message.getChat does not exist', async () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      const mockMessage = { text: 'hello' };

      const chat = await adapter.getChatByMessage(mockMessage);
      assert.strictEqual(chat, null);
    });
  });

  describe('markRead', () => {
    test('should delegate to chat.sendSeen if chat exists', async () => {
      mockChat.seenSent = false;
      const adapter = new WhatsAppAdapter({ client: mockClient });
      await adapter.markRead({ conversationId: 'valid' });
      assert.strictEqual(mockChat.seenSent, true);
    });

    test('should do nothing if chat does not exist', async () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      await adapter.markRead({ conversationId: 'invalid' });
    });
  });
});
