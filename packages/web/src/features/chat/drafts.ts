/** Text waiting to fill a new conversation's input, taken once when its input first shows. */
const drafts = new Map<string, string>();

export function setComposerDraft(sessionId: string, text: string): void {
  drafts.set(sessionId, text);
}

export function takeComposerDraft(sessionId: string): string | undefined {
  const text = drafts.get(sessionId);
  drafts.delete(sessionId);
  return text;
}
