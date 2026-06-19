cat << 'INNER_EOF' > /tmp/update_state.py
import re
with open('.jaa/state.md', 'r') as f:
    content = f.read()

new_note = "- **ChatFix-AI-Ops**: Validated and clamped AI operation environment variables directly into process.env.\n"
if "## 📝 AGENT NOTES" in content:
    content = content.replace("## 📝 AGENT NOTES\n", "## 📝 AGENT NOTES\n" + new_note)
else:
    content += "\n## 📝 AGENT NOTES\n" + new_note

with open('.jaa/state.md', 'w') as f:
    f.write(content)
INNER_EOF
python3 /tmp/update_state.py
