import type { Attachment } from "@/features/chat/attachments";

/**
 * A conversation's unsent input, text and images, kept while the app is open: a new project's prefilled
 * first message (theme development design 4) and whatever the user typed stay in the box when they leave the
 * conversation and come back, until the message is sent.
 */
const drafts = new Map<string, string>();
const images = new Map<string, Attachment[]>();

export function setComposerDraft(sessionId: string, text: string): void {
  drafts.set(sessionId, text);
}

/** Images prepared with a new conversation (a cloned site's home screenshot). */
export function setComposerImages(sessionId: string, attachments: Attachment[]): void {
  images.set(sessionId, attachments);
}

export function composerDraft(sessionId: string): string {
  return drafts.get(sessionId) ?? "";
}

export function composerImages(sessionId: string): Attachment[] {
  return images.get(sessionId) ?? [];
}

/** Keep what is in the box now; an empty box (after sending) forgets the conversation's draft. */
export function saveComposer(sessionId: string, text: string, attachments: Attachment[]): void {
  if (text === "") drafts.delete(sessionId);
  else drafts.set(sessionId, text);
  if (attachments.length === 0) images.delete(sessionId);
  else images.set(sessionId, attachments);
}
