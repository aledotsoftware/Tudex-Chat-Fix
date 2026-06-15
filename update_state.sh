#!/bin/bash
cat << 'MERGE' > patch.diff
<<<<<<< SEARCH
- **ChatFix-Provider-Bridge**: Updated the `BaseAdapter` interface and `WhatsAppAdapter` implementation to accurately enforce the canonical messaging contract by appending and destructuring the `{ provider, accountId, conversationId }` context object to all adapter methods. Additionally, refactored `backend/index.js` to correctly propagate this context to adapters, strictly resolving `provider` and `accountId`. Tests passing securely without breaking default behaviors.
=======
- **ChatFix-Provider-Bridge**: Updated the `BaseAdapter` interface and `WhatsAppAdapter` implementation to accurately enforce the canonical messaging contract by appending and destructuring the `{ provider, accountId, conversationId }` context object to all adapter methods. Additionally, refactored `backend/index.js` to correctly propagate this context to adapters, strictly resolving `provider` and `accountId`. Tests passing securely without breaking default behaviors.
- **ChatFix-Frontend-PWA**: Fixed a bug where `postSendMessage` unconditionally sent messages to the currently `selectedChatId`. Now it properly respects the `chatId` passed in the payload, ensuring queued replies and background message sends are accurately routed to their correct conversations, even if the user has navigated away to a different chat. Verified `frontend/src/*.test.js` successfully.
>>>>>>> REPLACE
MERGE
