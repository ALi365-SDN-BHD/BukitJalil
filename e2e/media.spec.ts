import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { importSite, putSettings, removeImportedSites, startConversationButton } from "./site-helpers.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function jpegWithLocation(): Buffer {
  const tiff = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const length = exif.length + 2;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff]),
    exif,
    Buffer.from([0xff, 0xd9]),
  ]);
}

async function openSite(
  page: Page,
  server: { loginUrl(): Promise<string> },
  title: string,
  edit?: (dir: string) => void,
) {
  await page.goto(await server.loginUrl());
  await putSettings(page, { locale: "en", model: { provider: "bukitjalil-fake", id: "fake-1" } });
  const id = await importSite(page, title, "en-US", edit);
  await page.goto(`/sites/${id}`);
  // The import starts the first main build; uploads would meet its site lock as site.busy.
  await expect(page.getByTestId("build-status").first()).toHaveText("Succeeded", { timeout: 30_000 });
  return id;
}

function input(page: Page) {
  return page.getByTestId("media-upload-area").locator('input[type="file"]');
}

/** The preview toolbar's upload button hands over to the changes panel, which opens its picker. */
async function openUploader(page: Page) {
  await page.getByTestId("preview-upload").click();
  await expect(page.getByTestId("tab-changes")).toHaveAttribute("aria-selected", "true");
}

async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await input(page).setInputFiles(file);
  await expect(page.getByTestId("media-queue")).toContainText(file.name);
}

test.afterAll(() => removeImportedSites());

test.describe.configure({ timeout: 90_000 });

test("uploads a file, replaces a duplicate and previews the image", async ({ page, server }) => {
  await openSite(page, server, "Media replace");
  await openUploader(page);
  await upload(page, { name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("media-queue")).toContainText("Uploaded");
  await upload(page, { name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByTestId("tab-changes").click();
  const file = page
    .getByTestId("changes-panel")
    .getByTestId("changed-files")
    .getByText("themes/starter/static/uploads/logo.png", { exact: true });
  await file.click();
  await expect(page.getByTestId("media-preview")).toBeVisible();
});

test("rejects SVG", async ({ page, server }) => {
  await openSite(page, server, "Media SVG");
  await openUploader(page);
  await input(page).setInputFiles({ name: "vector.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(page.getByTestId("media-queue")).toContainText("Only PNG, JPEG, GIF, WebP and PDF");
});

test("warns about a JPEG location", async ({ page, server }) => {
  await openSite(page, server, "Media location");
  await openUploader(page);
  await upload(page, { name: "photo.jpg", mimeType: "image/jpeg", buffer: jpegWithLocation() });
  await expect(page.getByTestId("media-queue")).toContainText("contains a location");
});

test("a subpath site gets the baseUrl in the reference and fake model uses it", async ({ page, server }) => {
  await openSite(page, server, "Media subpath", (dir) => {
    const file = path.join(dir, "site.yaml");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("baseUrl: /", "baseUrl: /blog/"));
  });
  await openUploader(page);
  await upload(page, { name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("media-queue")).toContainText("/blog/uploads/logo.png");
  await startConversationButton(page);
  await expect(page.getByTestId("chat-view")).toBeVisible();
  await page.getByTestId("composer-input").fill("#media Add the uploaded image to the About page");
  await page.getByTestId("composer-input").press("Enter");
  await expect(page.getByTestId("message-assistant").last()).toContainText("You asked", { timeout: 30_000 });
  await page.getByTestId("tab-changes").click();
  await page
    .getByTestId("changes-panel")
    .getByTestId("changed-files")
    .getByText("themes/starter/layouts/partials/header.html", { exact: true })
    .click();
  await expect(page.getByTestId("diff-patch")).toContainText("/blog/uploads/logo.png");
});

test("uploads are disabled while a conversation is running", async ({ page, server }) => {
  await openSite(page, server, "Media busy");
  await startConversationButton(page);
  await expect(page.getByTestId("chat-view")).toBeVisible();
  await page.getByTestId("composer-input").fill("#fail-network Hold the run open");
  await page.getByTestId("composer-input").press("Enter");
  await expect(page.getByTestId("chat-view").getByTestId("media-upload")).toBeDisabled();
});

test("a site lock error pauses the queue and one retry finishes it", async ({ page, server }) => {
  await openSite(page, server, "Media queue");
  let fail = true;
  await page.route("**/api/sites/*/media", async (route) => {
    if (!fail) return route.continue();
    fail = false;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ code: "site.busy", params: { operation: "build" } }),
    });
  });
  await openUploader(page);
  await input(page).setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: PNG },
    { name: "two.png", mimeType: "image/png", buffer: PNG },
  ]);
  const queue = page.getByTestId("media-queue");
  await expect(queue).toContainText("The site is busy");
  await expect(queue).toContainText("Waiting");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(queue.getByText("Uploaded")).toHaveCount(2);
});
