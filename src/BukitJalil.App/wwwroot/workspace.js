window.bukitWorkspace = {
  focusPrompt(promptId) {
    const element = document.getElementById(promptId);
    if (element instanceof HTMLTextAreaElement) {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    }
  },

  scrollTranscriptToBottom(transcriptId) {
    const element = document.getElementById(transcriptId);
    if (element instanceof HTMLElement) {
      element.scrollTop = element.scrollHeight;
    }
  }
};
