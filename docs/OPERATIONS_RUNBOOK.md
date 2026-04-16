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
