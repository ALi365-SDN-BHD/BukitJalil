import {
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGES,
  type ModelsResponse,
  REFERENCE_IMAGE_MIMES,
  type ReferenceImageMime,
} from "@bukitjalil/shared";
import { fileToBase64 } from "@/lib/files";

/** An image attached to the message being written (theme development design 4.2). */
export interface Attachment {
  id: number;
  name: string;
  mimeType: ReferenceImageMime;
  /** base64 */
  data: string;
}

/** Why some files were not attached. */
export type AttachProblem = "unsupported_type" | "too_large" | "too_many";

export const ATTACH_ACCEPT = REFERENCE_IMAGE_MIMES.join(",");

const isReferenceMime = (type: string): type is ReferenceImageMime =>
  (REFERENCE_IMAGE_MIMES as readonly string[]).includes(type);

/** Whether a file is an image that can be attached. The server checks the bytes again. */
export const isReferenceImage = (file: File): boolean => isReferenceMime(file.type);

let nextId = 1;

/**
 * Read the files that can be attached next to `current` attachments: PNG, JPEG or WebP, each at most
 * 5 MiB, at most 5 in all. Others are left out and the first reason is reported.
 */
export async function readAttachments(
  files: readonly File[],
  current: number,
): Promise<{ added: Attachment[]; problem: AttachProblem | null }> {
  const added: Attachment[] = [];
  let problem: AttachProblem | null = null;
  for (const file of files) {
    if (!isReferenceMime(file.type)) problem ??= "unsupported_type";
    else if (file.size > MAX_REFERENCE_IMAGE_BYTES) problem ??= "too_large";
    else if (current + added.length >= MAX_REFERENCE_IMAGES) problem ??= "too_many";
    else added.push({ id: nextId++, name: file.name, mimeType: file.type, data: await fileToBase64(file) });
  }
  return { added, problem };
}

/** Whether the selected model reads images; undefined while unknown (no model, or not loaded yet). */
export function selectedModelReadsImages(models: ModelsResponse | undefined): boolean | undefined {
  const selected = models?.selected;
  if (!selected) return undefined;
  const provider = models.providers.find((p) => p.id === selected.provider);
  return provider?.models.find((x) => x.id === selected.id)?.images;
}

/** A data: URL for an image of an allowed type; null for anything else, so no other kind is rendered. */
export function imageUrl(image: { mimeType: string; data: string }): string | null {
  return isReferenceMime(image.mimeType) && /^[A-Za-z0-9+/]*={0,2}$/.test(image.data)
    ? `data:${image.mimeType};base64,${image.data}`
    : null;
}
