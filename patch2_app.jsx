<<<<<<< SEARCH
  async function sendMessage(textToSend, type = "original") {
    if (!String(textToSend || "").trim()) return;
    if (!navigator.onLine) {
       showNotice("No puedes enviar mensajes sin conexión a internet.", "error");
       return;
    }
=======
  async function sendMessage(textToSend, type = "original") {
    if (!String(textToSend || "").trim()) return;
    if (!navigator.onLine) {
       showNotice("No puedes enviar mensajes sin conexión a internet.", "error");
       return;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
>>>>>>> REPLACE
