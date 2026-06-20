import re

try:
    with open('.jaa/state.md', 'r') as f:
        content = f.read()
except FileNotFoundError:
    content = "# JAA Global System State\n\n## 📝 AGENT NOTES\n"

new_note = "- **ChatFix-Orchestrator**: Refactored provider adapters (`BaseAdapter` and `WhatsAppAdapter`) to strictly enforce proper scoping in their method signatures. Removed the `conversationId` parameter from global, account-scoped methods (like `listChats`, `fetchStatusDescriptors`, `markStatusRead`, `getChatAvatarUrl`, etc.) and appropriately adjusted their invocations in the central orchestrator (`backend/index.js`), ensuring architectural purity and preventing unnecessary parameter bloat.\n"

if "## 📝 AGENT NOTES" in content:
    content = content.replace("## 📝 AGENT NOTES\n", "## 📝 AGENT NOTES\n" + new_note)
else:
    content += "\n## 📝 AGENT NOTES\n" + new_note

with open('.jaa/state.md', 'w') as f:
    f.write(content)
