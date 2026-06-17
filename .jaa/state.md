# JAA Global System State

Este archivo contiene el estado compartido entre todos los repositorios gestionados por JAA.
Los agentes pueden leer este estado para entender el contexto de otros proyectos.

## 🚀 ACTIVE MILESTONES
- [JAA] Implementación de Jerarquía de Contexto (.jaa.md global) - **COMPLETADO**
- [JAA] Sistema de Estado Global (system-state.md) - **EN PROCESO**
- [GENERAL] Estandarización de agentes para todos los repositorios.
- [ChatFix] Accesibilidad, Confianza y Feedback en UI completado (App.jsx, App.css) - **COMPLETADO**
- [ChatFix] Operaciones y Configuración IA (backend/index.js) - **COMPLETADO**

## 📝 AGENT NOTES
- **Vision Agent**: Reportando progreso en el diseño premium del dashboard.
- **ErrorGuardian**: Monitoreando logs de error en producción.
- **ChatFix-UX-Accessibility-Trust**: Se mejoró la retroalimentación visual de los estados de sesión (`auth_failure`, `qr`, `disconnected`, etc.) y la accesibilidad de teclado (`focus-visible`) en el frontend PWA. Además, se añadieron ARIA roles a los banners de alerta, instrucciones QR y validación de estado de IA, y se previno explícitamente el uso de botones de acción cuando la aplicación está fuera de línea.
- **ChatFix-AI-Ops**: Se eliminaron las validaciones manuales redundantes de los límites de variables de entorno numéricas en `validateStartupConfig`, delegando completamente en la robustez comprobada de `safeNumber`. Adicionalmente se centralizaron las advertencias de seguridad de la API KEY reutilizando la constante en los middlewares, y se agregaron validaciones estrictas al endpoint `/api/ai/config` para asegurar que no se cambie a proveedores de IA (como Cloudflare) sin credenciales suficientes. Se garantizó también que `process.env.AI_PROVIDER` asigne exclusivamente `cloudflare` o `lmstudio` al estado canónico `DEFAULT_AI_CONFIG`, evitando estados inconsistentes si se pasa un valor no soportado.
- **ChatFix-Provider-Bridge**: Se estandarizó la inyección de parámetros canónicos (`provider`, `accountId`, `conversationId`) en las llamadas del orquestador a los adaptadores, protegiendo las firmas y evitando acoplamiento explícito en las capas superiores.
- **ChatFix-Backend-Core**: Se revisaron y confirmaron las protecciones de endpoints `GET /api/*`, la presencia del caché `stale-while-revalidate`, y el modelo canónico multicanal (índices compuestos, deduplicación). También se corrigió un bug en `getSyncStateSnapshot` para que retorne siempre `provider` y `accountId` para la UI.
