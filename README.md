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

## 🛠️ Tecnologías Utilizadas

- **Backend:** Node.js + Express.
- **Conexión WhatsApp:** `whatsapp-web.js` (con sesión persistente por QR).
- **IA Local:** LM Studio con modelos ligeros (por ejemplo, Llama 3.1 8B o Mistral) en `http://localhost:1234`.
- **Librerías auxiliares:** `axios`, `socket.io`, `mongoose`, `cors`, `dotenv`.
- **Infraestructura:** Docker + Docker Compose + MongoDB.

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

- `chatfix-backend` en `http://localhost:3001`
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

- `PORT=3001`
- `MONGODB_URI=mongodb://mongo:27017/chatfix`
- `LM_STUDIO_URL=http://host.docker.internal:1234`
- `MODEL_NAME=llama-3.1-8b-instruct`
- `CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome-stable`

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
