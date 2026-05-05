1. **Separar estados de envío e IA:** En `App.jsx`, modificar la función `correctAndSend` para que desactive `correctingAndSending` ANTES de llamar a `sendMessage`. Esto permite que el texto del badge cambie de "✨ Mejorando y preparando envío..." a "✨ Enviando versión IA...", reflejando correctamente el estado `sending`.
2. **Centralizar acciones de IA:** Modificar el renderizado de la zona `.composerActions` en `App.jsx` cuando `correctedDraft` es verdadero. Eliminar el botón "✏️ Usar y editar" de `.correctedHeaderActions` y agregarlo al grupo de `.composerActions` (junto a "✨ Enviar versión IA" y "📤 Ignorar IA y enviar original") para centralizar las decisiones del usuario.
3. **Pre-commit:** Completar las instrucciones pre commit.
4. **Submit:** Enviar el código.
