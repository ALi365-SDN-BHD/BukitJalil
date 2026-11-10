/** Whether a key press belongs to a text field, where it types text instead of running a shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Whether a dialog is open; page shortcuts wait until it closes. */
export function dialogOpen(): boolean {
  return document.querySelector("[role=dialog]") !== null;
}
