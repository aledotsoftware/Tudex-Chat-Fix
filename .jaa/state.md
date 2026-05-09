# JAA Agent State

## Objective Completed: UX Accesibilidad, Confianza y Feedback

* Mejorada la accesibilidad de la pantalla de autenticación al envolver los inputs y botones de la API Key en un elemento nativo `<form>` que usa `onSubmit` en lugar de handlers de teclado manuales, mejorando compatibilidad con lectores de pantalla y navegación por teclado.
* Actualizados los atributos ARIA en los banners de desconexión de red y de sesión de `polite` a `assertive` para asegurar que el feedback de estados críticos no se interrumpa o pierda con el focus del componente de pantalla.
* Añadido `aria-atomic="true"` en la barra de estado general (`.statusBar`) para forzar la lectura completa y coherente del contexto de estado.
* Eliminado el spinner bloqueante innecesario de `connecting` en la carga del provider ya que ese estado es solo informativo.
* Aclarado el contraste de los textos de error de validación visual `.errorText` para superar estandáres en fondos oscuros.

## Global Project Context Note

* Los inputs de autenticación usan ahora el submit nativo. Modificar el manejo en un input de autenticación requiere utilizar el `onSubmit` del form contenedor.
* Los banners superiores mantienen responsabilidad exclusiva del feedback de desconexiones no bloqueantes y ahora son assertivos.
* Frontend `.waApp` mobile layout no longer uses `display: none` / `flex` swapping on chat panel state changes. It now uses `translateX(100%)` and `visibility: hidden` vs `translateX(0)` and `visibility: visible` over an `overflow: hidden` relative flex container.

## Objective Completed: Core Backend y Persistencia Canonica

* Se habilitó la autenticación para las conexiones de WebSockets (`socket.io`) verificando que el cliente envíe un token válido (`API_KEY`) al conectarse.
* Se incluyó la lógica de normalización canónica (agregando campos `provider` y `accountId` faltantes) para los documentos de las colecciones `SyncState` y `StatusArchive` dentro de la función de migración inicial `ensureCanonicalProviderFields`.

## Objective Completed: Bridge de Proveedor y Estado de Mensajeria

* Se verificó la exitosa transición y normalización a la arquitectura canónica (campos `provider` y `accountId`) dentro del enrutado en `backend/index.js` para los adaptadores.
* Se validó que el adaptador `WhatsAppAdapter` no dependa de variables globales de WhatsApp (como `waChat` o `waMsg`) y no realice mutaciones directas de variables de estado (ej. `state.status` manuales).
* Se verificó que todos los componentes clave delegan operaciones (`send`, `read`, etc.) limpiamente a través de métodos polimórficos de la instancia de la clase `BaseAdapter`.
* Los eventos del adaptador se gestionan correctamente mediante `_bindDefaultEvents()`. Todo responde y notifica al cliente PWA con la información de estado en la nueva estructura sin romper el camino rápido o la latencia.

## Objective Completed: UX Flujo Conversacional

* Aclaradas las etiquetas de la interfaz en `App.jsx` para reducir la ambigüedad en la redacción (ej. "Corregir y enviar" -> "Mejorar y enviar", "Ignorar IA y enviar original" -> "Descartar IA y enviar original").
* Se hizo más explícita la etiqueta del borrador original para dejar claro que editarlo descartará la sugerencia actual de la IA.
* Mejorada la jerarquía visual de los estados de actividad introduciendo un nuevo modificador de badge CSS `.processingAndSending` en `App.css`. Este badge utiliza una velocidad de pulso más rápida (`1s` frente a `2s`) y un estilo elevado para priorizar visualmente la inminencia de la acción combinada frente a la simple corrección en segundo plano.
* Añadido `touch-action: manipulation` a todos los elementos `button` en `App.css` para eliminar el retraso de 300ms de zoom en dispositivos móviles, mejorando la respuesta percibida.

## Objective Completed: Orchestrator Architecture Coordination

* Validated that the backend properly enforces the canonical messaging architecture (provider, accountId, conversationId).
* Updated `docker-compose.yml` to use `CMD-SHELL` for the backend health check to correctly pass the `X-API-Key` header with the configured `${API_KEY}`, ensuring compatibility with the authentication middleware on `/api/health`.
* Checked `frontend/src/App.jsx` API fetch implementations and confirmed they set canonical context values in payloads for multi-provider operations without breaking the read-path logic and caching expectations.
- **ChatFix-Provider-Bridge**: Bridge adapter revisado y verificado. Se confirma el diseño multi-canal agnóstico, el paso de las pruebas unitarias y la adherencia al contrato base sin fugas de implementaciones específicas (waChat, waMsg).

## Objective Completed: Core Backend y Persistencia Canonica 2

* Verified proper API protection globally checking `app.use('/api', authenticateApiKey)`. The API key protection works as intended and healthchecks function natively under this security blanket.
* Confirmed database normalization via `ensureCanonicalProviderFields()` accurately scopes up missing fields into canonical formats resolving old data into new data paradigms (`provider, accountId, conversationId`).
* Audited Mongoose models (`Chat`, `Message`, `SyncState`, `StatusArchive`) indicating that deduplication keys operate robustly using deterministic identifiers preventing database inflation.
* Re-ran full backend validation testing via `npm test` achieving `100% pass rate` validating structural integrity of `WhatsAppAdapter`, `BaseAdapter`, and `ProviderRegistry`.
## Objective Completed: Bridge de Proveedor y Estado de Mensajeria (Refactor extractStatusDescriptor)
## Objective Completed: Bridge de Proveedor y Estado de Mensajeria (Refactor extractMessage/ChatContext)

* Added `extractMessageContext` and `extractChatContext` to `BaseAdapter` and implemented them in `WhatsAppAdapter`.
* Completely replaced remaining direct access of WhatsApp-specific object properties (`._serialized`, `.fromMe`, `.body`, etc.) in `backend/index.js` with polymorphic adapter context extraction methods.
* Verified full unit test coverage and pass rate for adapter extraction logic.

* Abstracted WhatsApp-specific status message parsing from `index.js` into the `BaseAdapter` interface via the new `extractStatusDescriptor()` method.
* Implemented `extractStatusDescriptor()` in `WhatsAppAdapter` to handle extracting fields like `_serialized`, `author`, and `caption`.
* Updated `message_create` event listener in `backend/index.js` to rely exclusively on `adapter.extractStatusDescriptor(msg)` instead of hardcoded WhatsApp properties, fully decoupling the backend core from WhatsApp's message structure for the status archiving feature.
## 🚀 ACTIVE MILESTONES
- [JAA] Implementación de Jerarquía de Contexto (.jaa.md global) - **COMPLETADO**
- [JAA] Sistema de Estado Global (system-state.md) - **EN PROCESO**
- [Tudex-Chat-Fix] Mobile UX Polish (Transiciones, Targets, Hover) - **COMPLETADO**
- [GENERAL] Estandarización de agentes para todos los repositorios.
## Objective Completed: Orchestrator Canonical Front-End Fixes
* Reviewed frontend `App.jsx` API fetch functions.
* Added missing query parameters (`provider`, `accountId`) to `fetchStatus`, `fetchStatusArchive`, and `fetchResources`.
* Ensured canonical context fields are systematically sent for these endpoints from the PWA, upholding the JAA centralized messaging architecture contract.
* Ran successful `npm run build` and `npm test` verifying syntax, functionality, and tests pass for all adapters.
## Objective Completed: Orchestrator Architecture Coordination (Status & Health endpoints)

* Updated the `/api/status` and `/api/health` endpoints in `backend/index.js` to parse the provider context (`provider` and `accountId`) directly from the request (`req`) via `parseProviderContext(req)`, ensuring multi-provider compatibility dynamically.
* Replaced the hardcoded usage of `DEFAULT_PROVIDER` in `getProviderState` with the extracted dynamic `provider` variable.
* Added support for `/:channelCode` route parameters to match identical behavior in the `/api/send` endpoint.
* Verified that tests still pass completely.
## Objective Completed: Orchestrator Architecture Coordination (Provider Isolation)

* Removed hardcoded dependencies on `DEFAULT_PROVIDER` in core background systems.
* Refactored `io.on('connection')` in `backend/index.js` to initialize the frontend client Socket.IO connections with the correct multi-provider `qr` and `ready` states.
* Refactored `fetchCurrentStatusDescriptors(provider)` to resolve the active provider adapter dynamically, avoiding hardcoding `whatsapp` and enabling full multi-channel state fetching.
* Refactored the `setInterval` background `runStatusArchiveSweep` loop to iterate dynamically over all available adapters via `providerRegistry.listProviders()` instead of only scraping the default provider.
* Secured WebSockets events (`qr`, `ready`, `auth_failure`, `disconnected`) on the frontend (`frontend/src/App.jsx`) to filter out and ignore events whose `provider` payload does not match the active `DEFAULT_PROVIDER` to ensure isolated session states.
## Objective Completed: Orchestrator Architecture Coordination (Socket Isolation)

* Updated `frontend/src/App.jsx` socket logic to fully filter and isolate all incoming socket events (`qr`, `ready`, `auth_failure`, `disconnected`, `new_message`, `message_updated`) enforcing the `eventProvider === DEFAULT_PROVIDER && eventAccountId === DEFAULT_ACCOUNT_ID` match, effectively preventing cross-talk between multi-provider sessions on the PWA frontend.
* Modified the legacy `io.emit` implementations inside `backend/index.js` (`bindProviderEvents` and `adapter.on('message_create')`/`adapter.on('message_revoke')`) to attach the correct `provider` and `accountId` directly inside the payload object sent to `frontend/src/App.jsx` for all emitted states. Verified backward compatibility string handling on `qr` codes.
## Objective Completed: Orchestrator Architecture Coordination (Routes & Sockets Integration)

* Updated the Express routes (`/api/chats`, `/api/chats/:chatId/messages`, `/api/chats/:chatId/resources`, `/api/chats/:chatId/read`, `/api/status-archive`, `/api/status-archive/sweep`, `/api/sync/state`) in `backend/index.js` to handle dynamic `/:channelCode` channel overrides, enabling URL-based multi-provider context mapping without changing core frontend logic.
* Updated frontend payload validation logic: confirmed canonical query variables map safely without conflicting with backend parameter precedence rules.
* Updated remaining raw Socket.io global initial emissions in `io.on('connection')` inside `backend/index.js` to bundle canonical states containing `accountId: DEFAULT_ACCOUNT_ID` ensuring frontend sockets properly sync their states upon refresh.
## Objective Completed: Orchestrator Architecture Coordination (Global Endpoints)

* Refactored global backend endpoints (`/api/check-auth`, `/api/correct`, `/api/ai/*`) to remove dynamic channel routing (`/:channelCode`) and canonical provider context extraction.
* Ensured these routes operate globally without depending on messaging channel parameters, aligning with the architectural mandate that global services (like AI and Health checks) should remain independent of specific provider channels.
* Verified the corresponding API calls on the frontend to ensure no breaking changes were introduced, running test suites in both components successfully.
## Objective Completed: Orchestrator Architecture Coordination (API Send Canonical Fix)

* Fixed a critical routing bug in `backend/index.js` where the `chatId` resolution in the `POST /api/send/:channelCode` endpoint mistakenly evaluated `req.params.channelCode` as the actual destination `chatId`, effectively breaking external API publishing to specific chats when a channel code was provided in the route.
* Removed the `req.params.channelCode` fallback in the `chatId` assignment block, ensuring the payload's body or query `chatId` is strictly respected for message delivery.
