import { test, describe } from 'node:test';
import assert from 'node:assert';
import { getCachedChats } from './cacheStore.js';

describe('cacheStore error recovery', () => {
  test('getCachedChats returns empty array when indexedDB.open fails', async () => {
    // Mock global window and indexedDB
    global.window = {
      indexedDB: {
        open: () => {
          const request = {};
          process.nextTick(() => {
            request.error = new Error('IndexedDB connection failed');
            if (request.onerror) request.onerror();
          });
          return request;
        }
      }
    };

    try {
      const result = await getCachedChats('whatsapp', 'test-account');
      assert.deepStrictEqual(result, [], 'Should return empty array on failure');
    } finally {
      // Cleanup global mock
      delete global.window;
    }
  });

  test('getCachedChats returns empty array when transaction fails', async () => {
    // Mock global window and indexedDB with a successful open but failing transaction
    global.window = {
      indexedDB: {
        open: () => {
          const request = {};
          process.nextTick(() => {
            request.result = {
              transaction: () => ({
                objectStore: () => ({
                  get: () => {
                    const req = {};
                    process.nextTick(() => {
                      req.error = new Error('Transaction failed');
                      if (req.onerror) req.onerror();
                    });
                    return req;
                  }
                })
              })
            };
            if (request.onsuccess) request.onsuccess();
          });
          return request;
        }
      }
    };

    try {
      const result = await getCachedChats('whatsapp', 'test-account');
      assert.deepStrictEqual(result, [], 'Should return empty array on transaction failure');
    } finally {
      // Cleanup global mock
      delete global.window;
    }
  });
});
