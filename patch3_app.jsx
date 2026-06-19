<<<<<<< SEARCH
  function handleDraftKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!sending && !correcting && !correctingAndSending && (draft.trim() || correctedDraft)) {
        if (event.ctrlKey || event.metaKey) {
          // Force send original
          sendMessage(draft, "original");
        } else {
          if (correctedDraft) {
            sendMessage(correctedDraft, "corrected");
          } else if (draft.trim()) {
            correctAndSend();
          }
        }
      }
    }
  }
=======
  function handleDraftKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      // Remove correcting from condition to allow Enter to abort background suggestions
      if (!sending && !correctingAndSending && (draft.trim() || correctedDraft)) {
        if (event.ctrlKey || event.metaKey) {
          // Force send original
          sendMessage(draft, "original");
        } else {
          if (correctedDraft) {
            sendMessage(correctedDraft, "corrected");
          } else if (draft.trim()) {
            correctAndSend();
          }
        }
      }
    }
  }
>>>>>>> REPLACE
