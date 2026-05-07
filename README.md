# 📱 ChatFix PWA - Cliente de WhatsApp con Corrección IA Local

## 📖 Descripción del Proyecto

ChatFix es una plataforma de mensajería (PWA) independiente que emula una sesión de WhatsApp Web.
Su objetivo principal es ayudarte a enviar mensajes bien escritos mediante asistencia de una IA local.

A diferencia del flujo estándar donde un script edita un mensaje ya enviado, esta aplicación web actúa como un paso intermedio: escribes tu mensaje, la IA local lo analiza y corrige, y la plataforma te permite elegir si enviar tu texto original o la versión corregida.

## ✨ Características Principales

- **Privacidad total:** con LM Studio, la IA corre localmente en tu computadora. Tus borradores y chats no se envían a servicios externos de IA.
- **Cero riesgo de baneos por automatización agresiva:** tú revisas y decides manualmente qué mensaje enviar.
- **Interfaz PWA:** cliente web moderno, instalable y adaptable a móvil y escritorio.
- **Almacenamiento local:** integración con MongoDB y Docker para guardar historial y facilitar despliegue.
- **Archivado de estados:** revisión automática cada minuto para marcar estados como vistos y guardar imágenes nuevas en histórico consultable desde la web.

## 🛠️ Tecnologías Utilizadas

- **Backend:** Node.js + Express.
- **Conexión WhatsApp:** `whatsapp-web.js` (con sesión persistente por QR).
- **IA Local:** LM Studio con modelos ligeros (por ejemplo, Llama 3.1 8B o Mistral) en `http://localhost:1234`.
- **Librerías auxiliares:** `axios`, `socket.io`, `mongoose`, `cors`, `dotenv`.
- **Infraestructura:** Docker + Docker Compose + MongoDB.

## 🧠 Arquitectura Centralizada

El sistema ya opera con arquitectura de cache multinivel y fuente de verdad central en backend:

- **Frontend ↔ Backend:** lectura rápida vía cache local (IndexedDB) + backend cacheado.
- **Backend ↔ Proveedor:** sync asíncrono (cola) para evitar bloquear el read-path.
- **Modelo canónico multi-proveedor:** `provider`, `accountId`, `conversationId`.
- **Base para extensibilidad:** registry de adapters (WhatsApp implementado; Telegram listo para integrar).

Documentación técnica:

- [Arquitectura centralizada](./docs/CENTRALIZED_MESSAGING_ARCHITECTURE.md)
- [Runbook operativo](./docs/OPERATIONS_RUNBOOK.md)

## 🚀 Instalación y Configuración

### 1. Configurar IA local (LM Studio)

1. Abre LM Studio y descarga un modelo ligero.
1. Ve a **AI Server**.
1. Inicia el servidor en `http://localhost:1234`.
1. Verifica que el modelo esté cargado en memoria.

### 2. Levantar servicios con Docker

Desde la raíz del proyecto:

```bash
docker compose up --build
```

Esto levanta:

- `chatfix-backend` en `http://localhost:3005`
- `chatfix-mongo` en `mongodb://localhost:27017`

### 3. Sesión permanente de WhatsApp

El backend usa `LocalAuth`, guardando sesión en un volumen Docker (`whatsapp_auth`) para no escanear QR en cada reinicio.

## 🔄 Flujo de Uso del Sistema

1. **Inicio de sesión:** levantas contenedores y escaneas el QR desde WhatsApp > Dispositivos vinculados.
1. **Redacción:** escribes el mensaje en la interfaz PWA.
1. **Procesamiento IA:** el backend envía el texto a LM Studio vía API local.
1. **Decisión:** visualizas "antes/después" y eliges qué versión enviar.
1. **Envío final:** la app envía el mensaje elegido por WhatsApp.

## 🧩 Variables de Entorno Relevantes

En Docker Compose ya se inyectan:

- `PORT=3005`
- `MONGODB_URI=mongodb://mongo:27017/chatfix`
- `LM_STUDIO_URL=http://host.docker.internal:1234`
- `AI_PROVIDER=lmstudio` (o `cloudflare` usando `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN`)
- `MODEL_NAME=llama-3.1-8b-instruct`
- `CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome-stable`
- `STATUS_POLL_INTERVAL_MS=60000` para controlar cada cuánto se revisan estados y se archivan imágenes nuevas (Mínimo de 1000ms).
- `AI_TEMPERATURE=0.7` Configuración avanzada de la temperatura del modelo IA.
- `AI_MAX_TOKENS=180` Configuración del máximo de tokens para la generación de la IA.
- `AI_TIMEOUT_MS=15000` Configuración de timeout para la IA en milisegundos.
- `AI_SYSTEM_PROMPT` Define el rol y comportamiento esperado de la IA.
- `AI_USER_PROMPT_TEMPLATE` Formato en el que se envía el mensaje original a la IA.
- `API_KEY` para autenticar la API. Debe tener al menos 8 caracteres para considerarse segura en entornos de producción. Se puede configurar como un string vacío (o omitir por completo) para **deshabilitar la autenticación**, lo que registrará un warning de seguridad.
- `LM_STUDIO_URL` y configuraciones de IA son estrictamente validadas para garantizar que sean URLs válidas.
- Variables de caché (`CHATS_CACHE_TTL_MS`, `MESSAGES_CACHE_TTL_MS`, `AVATAR_TTL_MS`, `AVATAR_FETCH_LIMIT`, `AVATAR_FETCH_TIMEOUT_MS`) para controlar los tiempos de expiración y límites de la caché local del backend. Todas estas variables están protegidas mediante validación estricta y se limitan a rangos seguros.
- `DEFAULT_ACCOUNT_ID` para especificar el ID de cuenta de proveedor predeterminado (por defecto es `default`).


## 🩺 Diagnóstico y Estado

Endpoints útiles para monitoreo:

- `GET /api/health` estado general del backend y servicios.
- `GET /api/status` estado de sesión WhatsApp y uptime.
- `GET /api/ai/health?probe=1` verifica conectividad e inferencia con LM Studio.
- `GET /api/ai/models` lista modelos disponibles en LM Studio.

## 🧪 Logs útiles

```bash
docker compose logs -f backend
docker compose logs -f mongo
```

## 🛡️ Referencia de la API (Publicación Externa)

ChatFix expone un endpoint para publicar en canales o chats desde servicios externos.

**Endpoint:** `POST /api/send`

**Autenticación:**
Requiere el header `X-API-Key` o el parámetro `api_key` en la URL (si se definió `API_KEY` en el `docker-compose.yml`).

**Cuerpo de la petición (JSON):**

| Parámetro | Tipo | Descripción |
| :--- | :--- | :--- |
| `chatId` | String | ID del chat o canal (ej: `123456789@newsletter`). **Requerido**. |
| `text` | String | Texto del mensaje o pie de foto (soporta links). |
| `mediaUrl` | String | URL pública de una imagen para enviar. |
| `mediaBase64`| String | Imagen en formato Base64 (si no usas `mediaUrl`). |
| `mediaName` | String | Nombre del archivo (opcional, por defecto `image.jpg`). |

**Ejemplo con `curl`:**

```bash
curl -X POST http://localhost:3005/api/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: chatfix_secret_key_123" \
  -d '{
    "chatId": "1234567890@newsletter",
    "text": "🚀 Mensaje automático con imagen: https://ejemplo.com",
    "mediaUrl": "https://piks.eldesmarque.com/bin/2023/12/12/whatsapp_canales_001.jpg"
  }'
```
