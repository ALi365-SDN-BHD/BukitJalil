import type { ModelsResponse } from "@bukitjalil/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { imageUrl, readAttachments, selectedModelReadsImages } from "./attachments";
import { chatItems } from "./model";

/** FileReader is a browser API; this one reads a File the same way, as a data: URL. */
class TestFileReader {
  result: string | null = null;
  error: Error | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(file: File) {
    void file.arrayBuffer().then((bytes) => {
      this.result = `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`;
      this.onload?.();
    });
  }
}

afterEach(() => vi.unstubAllGlobals());

const file = (name: string, type: string, size = 3) => new File([new Uint8Array(size).fill(65)], name, { type });

describe("reference image attachments (theme development design 4.2)", () => {
  it("attaches PNG, JPEG and WebP up to five, and says why others were left out", async () => {
    vi.stubGlobal("FileReader", TestFileReader);
    const one = await readAttachments([file("a.png", "image/png"), file("b.gif", "image/gif")], 0);
    expect(one.added.map((a) => [a.name, a.mimeType, a.data])).toEqual([["a.png", "image/png", "QUFB"]]);
    expect(one.problem).toBe("unsupported_type");
    const big = await readAttachments([file("big.jpg", "image/jpeg", 5 * 1024 * 1024 + 1)], 0);
    expect(big).toEqual({ added: [], problem: "too_large" });
    const many = await readAttachments([file("c.webp", "image/webp"), file("d.webp", "image/webp")], 4);
    expect(many.added.map((a) => a.name)).toEqual(["c.webp"]);
    expect(many.problem).toBe("too_many");
    expect(new Set([...one.added, ...many.added].map((a) => a.id)).size).toBe(2);
  });

  it("knows whether the selected model reads images", () => {
    const models = (images: boolean, selected = { provider: "p", id: "m" }) =>
      ({
        providers: [{ id: "p", models: [{ id: "m", images }] }],
        selected,
      }) as unknown as ModelsResponse;
    expect(selectedModelReadsImages(models(true))).toBe(true);
    expect(selectedModelReadsImages(models(false))).toBe(false);
    expect(selectedModelReadsImages(models(true, { provider: "p", id: "gone" }))).toBeUndefined();
    expect(selectedModelReadsImages(undefined)).toBeUndefined();
  });

  it("renders only allowed image types as data: URLs", () => {
    expect(imageUrl({ mimeType: "image/png", data: "QUFB" })).toBe("data:image/png;base64,QUFB");
    expect(imageUrl({ mimeType: "image/svg+xml", data: "QUFB" })).toBeNull();
    expect(imageUrl({ mimeType: "image/png", data: 'QUFB"><script>' })).toBeNull();
  });

  it("keeps a user message's images for thumbnails", () => {
    const items = chatItems(
      [
        {
          entryId: "e1",
          message: {
            role: "user",
            content: [
              { type: "text", text: "Like this" },
              { type: "image", mimeType: "image/png", data: "QUFB" },
            ],
            timestamp: 1,
          },
        },
      ],
      { tools: {}, running: false },
    );
    expect(items[0]).toMatchObject({
      kind: "user",
      text: "Like this",
      images: [{ mimeType: "image/png", data: "QUFB" }],
    });
  });
});
