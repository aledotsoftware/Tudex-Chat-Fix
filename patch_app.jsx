<<<<<<< SEARCH
  async function correctAndSend() {
    if (!selectedChatId) {
      showNotice("Seleccioná un chat para enviar.", "error");
      return;
    }
    if (!draft.trim()) return;

    setCorrectingAndSending(true);
    try {
=======
  async function correctAndSend() {
    if (!selectedChatId) {
      showNotice("Seleccioná un chat para enviar.", "error");
      return;
    }
    if (!draft.trim()) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setCorrectingAndSending(true);
    try {
>>>>>>> REPLACE
