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

  describe('hasMedia', () => {
    test('should return true if message hasMedia is true', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      assert.strictEqual(adapter.hasMedia({ hasMedia: true }), true);
    });

    test('should return false if message hasMedia is false or missing', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      assert.strictEqual(adapter.hasMedia({ hasMedia: false }), false);
      assert.strictEqual(adapter.hasMedia({}), false);
    });
  });

  describe('hasQuotedMsg', () => {
    test('should return true if message hasQuotedMsg is true', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      assert.strictEqual(adapter.hasQuotedMsg({ hasQuotedMsg: true }), true);
    });

    test('should return false if message hasQuotedMsg is false or missing', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      assert.strictEqual(adapter.hasQuotedMsg({ hasQuotedMsg: false }), false);
      assert.strictEqual(adapter.hasQuotedMsg({}), false);
    });
  });

  describe('isStatusMessage', () => {
    test('should return true for status messages', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      assert.strictEqual(adapter.isStatusMessage({ from: 'status@broadcast' }), true);
      assert.strictEqual(adapter.isStatusMessage({ type: 'status_v3' }), true);
      assert.strictEqual(adapter.isStatusMessage({ isStatus: true }), true);
    });

    test('should return false for regular messages', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      assert.strictEqual(adapter.isStatusMessage({ from: '123@c.us', type: 'chat' }), false);
    });
  });

  describe('getChatIdFromMessage', () => {
    test('should return to if fromMe is true', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      assert.strictEqual(adapter.getChatIdFromMessage({ fromMe: true, to: '123@c.us', from: 'me@c.us' }), '123@c.us');
    });

    test('should return from if fromMe is false', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      assert.strictEqual(adapter.getChatIdFromMessage({ fromMe: false, to: 'me@c.us', from: '123@c.us' }), '123@c.us');
    });
  });

  describe('extractStatusDescriptor', () => {
    test('should extract status descriptor fields correctly', () => {
      const adapter = new WhatsAppAdapter({ client: mockClient });
      const mockMessage = {
        id: { _serialized: 'msg123' },
        author: 'author@c.us',
        caption: 'Test Status',
        type: 'image',
        timestamp: 1620000000
      };
      const descriptor = adapter.extractStatusDescriptor(mockMessage);
      assert.deepStrictEqual(descriptor, {
        providerStatusMessageId: 'msg123',
        statusOwnerId: 'author@c.us',
        description: 'Test Status',
        caption: 'Test Status',
        mediaType: 'image',
        timestamp: 1620000000
      });
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
