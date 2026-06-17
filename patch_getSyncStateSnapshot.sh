sed -i 's/return { ...local };/return { provider, accountId, conversationId: conversationId || "__all__", kind, ...local };/' backend/index.js
