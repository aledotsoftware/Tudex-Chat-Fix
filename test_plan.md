1. **Mejorar UI/UX del área de redacción (`App.jsx`)**
   - Agrupar la "Sugerencia de IA" (`correctedDraft`) en un panel de preview más claro, que incluya botones para "✅ Enviar sugerencia", "✏️ Reemplazar borrador" o "❌ Descartar" integrados en ese mismo panel.
   - Refactorizar las acciones del compositor para no mostrar el botón "Enviar original" y "Enviar corregido" juntos si confunden. Mostrar las opciones de corrección ("✨ Corregir IA", "🚀 Corregir y enviar") sólo cuando el texto aún no esté corregido. Si hay un `correctedDraft`, dejar sólo la opción de "Enviar original" como secundaria, mientras la principal está en el panel de `correctedPreview`.
   - Modificar la forma de mostrar los estados (`activityState`) usando badges más amigables (`activityStateBadge`) con iconos animados en lugar de notificaciones genéricas `.notice`.

2. **Ajustes de estilos (`App.css`)**
   - Agregar clases CSS `correctedHeader`, `correctedActions`, `iconButton` para el layout mejorado de las sugerencias.
   - Agregar las clases de `activityStateBadge` para diferenciar claramente cuando se está "Procesando", "Enviando", o "Sincronizando".

3. **Verificación local**
   - Correr pnpm build en el frontend para validar que no haya errores de compilación.

4. **Pre-commit**
   - Seguir pre_commit_instructions para garantizar la calidad y correr todas las verificaciones en AGENTS.md y docs.

5. **Submit**
   - Commitear los cambios a una rama nueva y finalizar la tarea.
