# JAA Global System State

Este archivo contiene el estado compartido entre todos los repositorios gestionados por JAA.
Los agentes pueden leer este estado para entender el contexto de otros proyectos.

## 🚀 ACTIVE MILESTONES
- [JAA] Implementación de Jerarquía de Contexto (.jaa.md global) - **COMPLETADO**
- [JAA] Sistema de Estado Global (system-state.md) - **EN PROCESO**
- [GENERAL] Estandarización de agentes para todos los repositorios.
- [ChatFix-AI-Ops] Reforzamiento de seguridad para URL AI, expuesta configuración Cloudflare y variables avanzadas. Documentación actualizada. - **COMPLETADO**

## 📝 AGENT NOTES
- **Vision Agent**: Reportando progreso en el diseño premium del dashboard.
- **ErrorGuardian**: Monitoreando logs de error en producción.
- **ChatFix-AI-Ops**: Validaciones de URLs de AI (http/https estricto) aplicadas a `safeUrl`. `docker-compose.yml`, `.env.example` y `README.md` actualizados con parámetros Cloudflare (`CLOUDFLARE_ACCOUNT_ID`, etc.) y avanzados (`AI_TEMPERATURE`, `AI_MAX_TOKENS`). Runbook operativo actualizado.
# [ChatFix-UX-Conversation-Flow] Interfaz de redacción (App.jsx) actualizada con nuevos badges de estados (processing, sending, syncing) usando iconos animados. Se optimizó el layout del panel 'Sugerencia de IA' agrupando acciones (Enviar, Reemplazar borrador) y usando un iconButton '❌' para descartar. Se añadieron las clases correspondientes en App.css. Se completaron exitosamente todas las pruebas locales.
- **ChatFix-Provider-Bridge**: Desacoplada la lógica dependiente de `whatsapp-web.js` en `backend/index.js` mediante la implementación de nuevos métodos abstractos en `BaseAdapter`: `fetchStatusDescriptors()`, `getMessageById()`, y `markStatusRead()`. El adaptador `WhatsAppAdapter` implementa ahora toda la lógica específica de extracción y manipulación de estados (stories). Se actualizaron `fetchCurrentStatusDescriptors`, `archiveStatusFromDescriptor` y el manejador de `message_create` en `index.js` para usar la capa de abstracción del proveedor activo, mejorando la extensibilidad multicanal.
- **ChatFix-Frontend-PWA**: Se limitó el almacenamiento de IndexedDB a 150 mensajes por chat (`cacheStore.js`) para evitar bloat. En `App.jsx`, se refactorizó la hidratación PWA para actualizar `selectedChatIdRef` de forma síncrona al auto-seleccionar, previniendo UI jumps, y se ocultaron los mensajes "Cargando..." cuando ya hay mensajes locales en caché. Además, el polling se aceleró dinámicamente de 15s a 3s cuando hay sincronización activa de fondo (`syncingChat`).

- **ChatFix-UX-Conversation-Flow**: Improved the UI logic for drafts and sending messages (`frontend/src/App.jsx`, `frontend/src/App.css`), reducing user friction and adding distinct states for AI operations.

- [JAA] ChatFix-UX-Mobile-Polish: Mejorada la UX en pantallas móviles mediante App.css y App.jsx. Añadido `font-size: 16px` para evitar zoom en iOS, affordance táctil de `44px` para botones, transiciones `slideInLeftMobile` para navegación fluida, modales a pantalla completa, y simplificación visual en las cabeceras escondiendo texto con la nueva utilidad `.hideOnMobile` en botones y acciones.
