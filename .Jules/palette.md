## 2025-05-14 - Interactive Chat Bubbles Accessibility
**Learning:** Interactive elements that are not standard controls (like chat bubbles with grammar errors) must be explicitly made focusable and keyboard-triggerable. Additionally, micro-copy should use inclusive verbs like "Presionar" instead of device-specific ones like "Tocar".
**Action:** When adding interactivity to non-standard elements, always include `tabIndex={0}`, `role="button"`, and an `onKeyDown` handler for Enter/Space, and review instructional text for inclusivity.
