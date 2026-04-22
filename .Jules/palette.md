## 2025-05-14 - Interactive Chat Bubbles Accessibility
**Learning:** Interactive elements that are not standard controls (like chat bubbles with grammar errors) must be explicitly made focusable and keyboard-triggerable. Additionally, micro-copy should use inclusive verbs like "Presionar" instead of device-specific ones like "Tocar".
**Action:** When adding interactivity to non-standard elements, always include `tabIndex={0}`, `role="button"`, and an `onKeyDown` handler for Enter/Space, and review instructional text for inclusivity.

## Chat Resources & Persistence (v1.1)

- **Revoked Messages Styling**: Use 'revokedRow' and 'isRevoked' classes to dim and strike through content, providing a clear visual cue that the message was deleted by the sender without losing the data.
- **Media Support**: Native <video> and <audio> players should always include 'controls' and use the '/media-archive' static route for local persistence.
- **Resource Hub**: Access contact-specific data (links, media, statuses) via the '📂 Recursos' panel, using a grid layout for visual assets and a list for text-based resources like links.
