# JAA Global System State

Este archivo contiene el estado compartido entre todos los repositorios gestionados por JAA.
Los agentes pueden leer este estado para entender el contexto de otros proyectos.

## 🚀 ACTIVE MILESTONES
- [JAA] Implementación de Jerarquía de Contexto (.jaa.md global) - **COMPLETADO**
- [JAA] Sistema de Estado Global (system-state.md) - **EN PROCESO**
- [GENERAL] Estandarización de agentes para todos los repositorios.

## 📝 AGENT NOTES
- **ChatFix-Provider-Bridge (Update)**: Generalizó la inicialización y el manejo de estado de los proveedores de mensajería. Se movieron las propiedades `_isReady` y `_status` al `BaseAdapter`, eliminando redundancias en `WhatsAppAdapter`. Se actualizó `ProviderRegistry` con `initializeAll()` para inicializar los adaptadores de forma dinámica, y se reemplazó el acoplamiento rígido de WhatsApp en `backend/index.js` mediante iteración genérica de proveedores. Adicionalmente, las respuestas de la API (`/api/status`, `/api/health`) y el estado del frontend (`App.jsx`) ahora usan el término agnóstico `providerStatus` en lugar de `whatsappStatus`, manteniendo intacto el flujo canónico multicanal.
- **ChatFix-Provider-Bridge**: Desacopló el core (`backend/index.js`) de propiedades específicas de `whatsapp-web.js` agregando métodos abstractos (`hasMedia`, `hasQuotedMsg`) en `BaseAdapter` e implementándolos en `WhatsAppAdapter`. Esto mantiene el read-path rápido y la arquitectura canónica lista para nuevos proveedores sin errores de sintaxis.
- **Vision Agent**: Reportando progreso en el diseño premium del dashboard.
- **ErrorGuardian**: Monitoreando logs de error en producción.
- **ChatFix-UX-Mobile-Polish**: Optimizó el layout móvil de App.jsx y App.css. Se ajustó el touch target a 44px de forma general, se ocultaron textos menos relevantes usando .hideOnMobile, y se corrigió el manejo responsivo del hook isMobileLayout para seleccionar chats por defecto al volver a desktop de forma segura usando useRef sin contaminar window. Se mejoró la visibilidad del botón para regresar atrás.
- **ChatFix-Backend-Core**: Reforzó la persistencia canónica estableciendo como obligatorios (`required: true`) los campos clave (`provider`, `accountId`, `conversationId`, `providerMessageId`, etc.) en `MessageSchema`, `ChatSchema`, `SyncStateSchema` y `StatusArchiveSchema` de Mongoose para soportar correctamente los índices únicos no *sparse*. Además, protegió los endpoints `/api/health` y `/api/status` usando bloques `try...catch` para evitar fallos no manejados, y sincronizó `docs/CENTRALIZED_MESSAGING_ARCHITECTURE.md` para remover referencias inexactas a índices sparse.
- **ChatFix-Orchestrator**: Revisó la arquitectura de la aplicación garantizando la consistencia del modelo canónico (`provider/accountId/conversationId`). Identificó y resolvió una discrepancia en `docs/CENTRALIZED_MESSAGING_ARCHITECTURE.md`, donde se indicaba erróneamente el uso de índices únicos "sparse" para `Message` y `Chat`, mientras que el backend realmente implementa esquemas estrictos (no sparse) con fallbacks robustos para los identificadores (como lo menciona JAA Memory). Verificó el contrato `items + syncState` en las llamadas desde el frontend hacia el backend.
