# Operations Runbook

## 1) Principios operativos
- El proveedor no está en el camino crítico de lectura.
- Todo `GET /api/chats` y `GET /api/chats/:chatId/messages` responde desde cache/persistencia.
- El refresh contra proveedor corre en background vía cola de sync.

## 2) Verificar estado general
- `GET /api/health`
- `GET /api/status`
- `GET /api/sync/state?provider=whatsapp&accountId=default&kind=chats`
- `GET /api/sync/state?provider=whatsapp&accountId=default&kind=messages&conversationId=<chatId>`

## 3) Contrato API para frontend
### Chats
`GET /api/chats?provider=whatsapp&accountId=default`

Respuesta:
```json
{
  "items": [],
  "provider": "whatsapp",
  "accountId": "default",
  "cache": { "level": "l1|mongo", "staleWhileRevalidate": true },
  "syncState": {}
}
```

### Mensajes
`GET /api/chats/:chatId/messages?provider=whatsapp&accountId=default`

Mismo formato (`items` + metadata).

### Recursos de Chat
`GET /api/chats/:chatId/resources?provider=whatsapp&accountId=default`

**Excepción:** Devuelve un formato especializado en lugar del contrato `items + syncState`:
```json
{
  "chatId": "<id>",
  "media": [],
  "links": [],
  "statuses": []
}
```

### Read receipt
`POST /api/chats/:chatId/read?provider=whatsapp&accountId=default`

### Send
`POST /api/send` body incluye:
- `provider`
- `accountId`
- `chatId`
- `text`

## 4) Agregar nuevo proveedor (ejemplo Telegram)
1. Crear `backend/providers/telegram-adapter.js`.
2. Implementar métodos del `BaseAdapter`.
3. Registrar adapter en `ProviderRegistry`.
4. Usar `provider=telegram` en queries del frontend/API.
5. Mantener normalización canónica (`provider/accountId/conversationId`).

## 5) Objetivos de performance
- `GET /api/chats` p95 < 100ms en cache caliente.
- `GET /api/chats/:chatId/messages` p95 < 150ms en cache caliente.
- Apertura perceptual de chat < 200ms con IndexedDB + L1/L2.

## 6) Validation and Security
- **Startup Configuration**: At startup, explicit functions perform strong assertions. Misconfigured values, out-of-bounds metrics for parameters like `STATUS_POLL_INTERVAL_MS` or `AI_TIMEOUT_MS`, as well as incomplete or missing properties for your `AI_PROVIDER`, log clear warnings so system operators can fix deployments proactively.
- `API_KEY`: Must be at least 8 characters long in production environments to avoid security warnings. Setting the `API_KEY` to an empty string (or completely omitting it in Docker/env deployments) will explicitly disable API authentication, triggering a "⚠️ SEVERE SECURITY WARNING:" in the logs.
- **AI Configuration**: Values provided for `LM_STUDIO_URL` and `CLOUDFLARE_AI_BASE_URL` are proactively strict-validated as proper URLs (must be `http:` or `https:`) regardless of the active provider. If invalid at startup, they log a single non-duplicated warning and fallback to safe defaults or empty strings. For Cloudflare AI, either `CLOUDFLARE_ACCOUNT_ID` or `CLOUDFLARE_AI_BASE_URL` must be provided along with `CLOUDFLARE_API_TOKEN`. During runtime (`PUT /api/ai/config`), malformed URLs are explicitly rejected with a `400 Bad Request` error to prevent misconfiguration. Warnings will also log when `MODEL_NAME` or `CLOUDFLARE_*` properties are improperly configured at startup. Sensitive values like `CLOUDFLARE_API_TOKEN` are masked as `********` in both `GET /api/ai/config` and `PUT /api/ai/config` responses to prevent exposing credentials to the frontend.
- **Timeouts/Intervals**: Limits are strictly enforced via `safeNumber()`.
  - `STATUS_POLL_INTERVAL_MS`: Ensures a minimum of `1000` ms to prevent event loop starvation. Max `86400000` ms. Falls back to `60000` ms.
  - `AI_TIMEOUT_MS`: Bounded between `1000` and `60000` ms. Falls back to `15000` ms.
- **Cache & Fetch Limits**: Internal cache timeouts and fetching constraints are also strictly validated using `safeNumber()`. If invalid or out of bounds, they log a warning during startup and clamp to safe minimum/maximum values or fall back to defaults.
  - `AVATAR_TTL_MS`: Min `1000`, Max `86400000`. Default `600000`.
  - `AVATAR_FETCH_LIMIT`: Min `1`, Max `200`. Default `40`.
  - `AVATAR_FETCH_TIMEOUT_MS`: Min `1000`, Max `30000`. Default `7000`.
  - `CHATS_CACHE_TTL_MS`: Min `0`, Max `3600000`. Default `5000`.
  - `MESSAGES_CACHE_TTL_MS`: Min `0`, Max `3600000`. Default `5000`.
- **Advanced AI Tuning**: Advanced variables are parsed and constrained to safe values via `safeNumber()` validation. Invalid numeric configs log a warning upon parsing.
  - `AI_TEMPERATURE`: Min `0`, Max `2`. Default `0.7`.
  - `AI_MAX_TOKENS`: Min `1`, Max `8192`. Default `180`.
