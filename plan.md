1. **Mejorar jerarquía visual y precisión de los estados en App.jsx**
   - Actualizar el renderizado del componente `.activityStateBadge` para diferenciar claramente si la acción está en fase de "preparación/corrección" (`.processing`, color morado) o en fase de "envío a red" (`.sending`, color verde).
   - Refinar el texto dinámico del badge para que explique exactamente qué está ocurriendo (ej. "✨ Mejorando y preparando envío..." vs "✨ Enviando versión IA..." vs "📤 Enviando mensaje original...").

2. **Añadir atajo de teclado para enviar mensaje original y actualizar UX**
   - Modificar `handleDraftKeyDown` para permitir enviar el mensaje original de forma directa usando `Ctrl+Enter` o `Cmd+Enter`, saltándose la IA.
   - Actualizar el placeholder del textarea principal para comunicar este nuevo atajo ("Ctrl+Enter: enviar original").

3. **Refinar la animación de envío en App.css**
   - Agregar la animación `pulseIcon` a la clase `.activityStateBadge.sending` para asegurar que el feedback de red tenga la misma consistencia animada que la fase de corrección.

4. **Completar pasos pre-commit y submit**
   - Llamar a la herramienta de pre-commit para asegurar testing, linting y reflectividad del estado.
   - Enviar y guardar los cambios.
