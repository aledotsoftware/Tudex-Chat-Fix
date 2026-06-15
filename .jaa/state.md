# JAA Global System State

## 🚀 ACTIVE MILESTONES
- [JAA] Implementación de Jerarquía de Contexto (.jaa.md global) - **COMPLETADO**
- [JAA] Sistema de Estado Global (system-state.md) - **EN PROCESO**
- [GENERAL] Estandarización de agentes para todos los repositorios.

## 📝 AGENT NOTES
- **Vision Agent**: Reportando progreso en el diseño premium del dashboard.
- **ErrorGuardian**: Monitoreando logs de error en producción.
- **ChatFix-Orchestrator**: Completó la revisión y corrección de la configuración de IA. Aseguró que `cloudflareApiToken` se enmascara correctamente (con `********`) en la respuesta de `PUT /api/ai/config` para evitar fugas de credenciales. La serialización de objetos Mongoose en la respuesta fue corregida usando `.toJSON()`. La documentación en `docs/OPERATIONS_RUNBOOK.md` fue actualizada para reflejar este comportamiento de seguridad. Todos los tests pasan exitosamente.
- **ChatFix-Orchestrator**: Se documentó la excepción intencional arquitectónica del endpoint `/api/chats/:chatId/resources` que no utiliza el contrato `items + syncState` en `CENTRALIZED_MESSAGING_ARCHITECTURE.md` y `OPERATIONS_RUNBOOK.md`. El frontend ya lo maneja correctamente mediante un objeto directo `{ chatId, media, links, statuses }`.
- **ChatFix-Backend-Core**: Fixed `StatusArchive.findOneAndUpdate` to use `$set` operator instead of `$setOnInsert` to ensure existing documents get updated correctly without losing data. Fixed a document serialization issue in `handleMessageRevoke` by calling `.toJSON()` on the Mongoose document returned from `Message.findOneAndUpdate` before emitting via Socket.IO, preventing raw Mongoose internal state from being broadcast to the frontend. All tests passing.
- **ChatFix-Provider-Bridge**: Updated the `BaseAdapter` interface and `WhatsAppAdapter` implementation to accurately enforce the canonical messaging contract by appending and destructuring the `{ provider, accountId, conversationId }` context object to all adapter methods. Additionally, refactored `backend/index.js` to correctly propagate this context to adapters, strictly resolving `provider` and `accountId`. Tests passing securely without breaking default behaviors.
- **ChatFix-Frontend-PWA**: Fixed a bug where `postSendMessage` unconditionally sent messages to the currently `selectedChatId`. Now it properly respects the `chatId` passed in the payload, ensuring queued replies and background message sends are accurately routed to their correct conversations, even if the user has navigated away to a different chat. Verified `frontend/src/*.test.js` successfully.
