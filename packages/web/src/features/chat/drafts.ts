import type { Attachment } from "@/features/chat/attachments";

/** Text waiting to fill a new conversation's input, taken once when its input first shows. */
const drafts = new Map<string, string>();
/** Images prepared with a new conversation (a cloned site's home screenshot), taken with the text. */
const images = new Map<string, Attachment[]>();

export function setComposerDraft(sessionId: string, text: string): void {
  drafts.set(sessionId, text);
}

export function takeComposerDraft(sessionId: string): string | undefined {
  const text = drafts.get(sessionId);
  drafts.delete(sessionId);
  return text;
}

export function setComposerImages(sessionId: string, attachments: Attachment[]): void {
  images.set(sessionId, attachments);
}

export function takeComposerImages(sessionId: string): Attachment[] {
  const list = images.get(sessionId) ?? [];
  images.delete(sessionId);
  return list;
}
