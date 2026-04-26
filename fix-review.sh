#!/bin/bash
# Remove temporary files
rm -f fix-mobile.sh fix-css.sh fix-css-mobile.sh fix-waapp-animations.sh fix-back-btn.sh fix-ux.sh fix-auto-select.sh fix-auto-select2.sh update-isMobileLayout.sh fix-chats-ref.sh fix-chats-cache.sh plan.md plan-check.sh test.js test-mobile.sh
rm -f frontend/src/App.jsx.patch frontend/src/App.jsx.patch2 frontend/src/App.jsx.patch3 frontend/src/App.jsx.rej frontend/src/App.jsx.orig frontend/src/App.css.patch
rm -f start-frontend.sh frontend/frontend.log frontend/frontend.pid

# Fix window.__chatsCache to use chatsRef in frontend/src/App.jsx
cat << 'PATCH' > fix-window-cache.patch
--- frontend/src/App.jsx
+++ frontend/src/App.jsx
@@ -540,9 +540,9 @@
     const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
     const handleChange = (event) => {
       setIsMobileLayout(event.matches);
-      if (!event.matches && !selectedChatIdRef.current && window.__chatsCache?.length > 0) {
-        setSelectedChatId(window.__chatsCache[0].id);
-        selectedChatIdRef.current = window.__chatsCache[0].id;
+      if (!event.matches && !selectedChatIdRef.current && chatsRef.current?.length > 0) {
+        setSelectedChatId(chatsRef.current[0].id);
+        selectedChatIdRef.current = chatsRef.current[0].id;
       }
     };
     setIsMobileLayout(mediaQuery.matches);
@@ -825,7 +825,6 @@
         const sortedCached = [...cachedChats].sort(
           (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)
         );
-        window.__chatsCache = sortedCached;
         setChats(sortedCached);

         // PWA Hydration: Auto-select chat from cache immediately to prevent UI jumps
@@ -868,7 +867,6 @@
       const safeChats = items.sort(
         (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)
       );
-      window.__chatsCache = safeChats;
       setChats(safeChats);

       if (safeChats.length === 0) {
PATCH
patch frontend/src/App.jsx < fix-window-cache.patch
rm fix-window-cache.patch
