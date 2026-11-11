import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
const fixture = path.resolve("e2e/fixtures/green.png");
async function nav(page: Page, label: string) {
  await page
    .locator("nav button")
    .filter({ hasText: label })
    .filter({ visible: true })
    .click();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}
async function region(page: Page, x: number, y: number, w: number, h: number) {
  const editor = page.locator(".region-editor");
  if ((await editor.getAttribute("open")) === null)
    await editor.locator("summary").click();
  for (const [name, v] of Object.entries({ x, y, w, h }))
    await page
      .getByRole("spinbutton", { name: "Region " + name, exact: true })
      .fill(String(v));
}
test("home, synthetic pH, sampling and export", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("Your camera.", { exact: false })).toBeVisible();
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("home.png"), fullPage: true });
  await page.getByRole("button", { name: /Try the demo/ }).click();
  await expect(page.getByTestId("ph-value")).toHaveText("7");
  await expect(page.locator(".color-readout strong")).toHaveText("#94B889");
  await page.getByRole("button", { name: "Point", exact: true }).click();
  const c = page.locator("canvas");
  const b = (await c.boundingBox())!;
  await c.click({ position: { x: b.width * 0.5, y: b.height * 0.6 } });
  await expect(page.locator(".quality-footer b")).toHaveText("1 px");
  await page.getByRole("button", { name: "Region", exact: true }).click();
  await region(page, 440, 365, 120, 115);
  await expect(page.getByTestId("ph-value")).toHaveText("7");
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("ph.png"), fullPage: true });
  const d = page.waitForEvent("download");
  await page
    .locator(".export-actions")
    .getByRole("button", { name: "JSON", exact: true })
    .click();
  const downloaded = await d;
  expect(downloaded.suggestedFilename()).toMatch(/pocketsense-.*\.json/);
  expect(errors).toEqual([]);
});
test("upload, create actual reference, meter validation and local history", async ({
  page,
}) => {
  await page.goto("/");
  await nav(page, "pH Sense");
  await page.getByLabel("Upload photo", { exact: true }).setInputFiles(fixture);
  await expect(page.locator(".color-readout strong")).toHaveText("#94B889");
  await expect(page.getByTestId("ph-value")).toHaveText("—");
  await page.getByRole("button", { name: "New profile", exact: true }).click();
  await page
    .getByPlaceholder("For example: brand / batch / read time")
    .fill("UI test reference");
  await page
    .getByRole("spinbutton", { name: "Patch 1 pH", exact: true })
    .fill("6.5");
  await page
    .getByRole("textbox", { name: "Patch 1 HEX", exact: true })
    .fill("#94B889");
  await page
    .getByRole("spinbutton", { name: "Patch 2 pH", exact: true })
    .fill("8");
  await page
    .getByRole("textbox", { name: "Patch 2 HEX", exact: true })
    .fill("#688FAD");
  await page.getByRole("checkbox", { name: /I replaced/ }).check();
  await page
    .getByRole("button", { name: "Save profile locally", exact: true })
    .click();
  await expect(page.getByTestId("ph-value")).toHaveText("6.5");
  await page
    .getByPlaceholder("Enter the meter reading for this sample")
    .fill("6.7");
  await page.getByRole("button", { name: "Add record", exact: true }).click();
  await nav(page, "Notebook");
  await expect(page.getByText("0.200", { exact: true })).toHaveCount(2);
  await expect(page.locator(".history-table tbody tr")).toHaveCount(1);
  await page.getByRole("checkbox", { name: /Keep records/ }).check();
  await page.reload();
  await nav(page, "Notebook");
  await expect(page.locator(".history-table tbody tr")).toHaveCount(1);
  await noOverflow(page);
});
test("light reference correction, palette and invalid image", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Try the demo/ }).click();
  await nav(page, "Light Sense");
  await page
    .getByRole("button", { name: "Select neutral reference", exact: true })
    .click();
  const canvas = page.locator("canvas");
  const b = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: b.width * 0.84, y: b.height * 0.69 } });
  await region(page, 795, 440, 80, 80);
  await page
    .getByRole("button", { name: "Finish reference selection", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: /Apply reference correction/ })
    .check();
  await expect(
    page.getByText("Neutral-reference correction is on", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".image-tag")).toContainText("CORRECTED");
  await nav(page, "Color Sense");
  await expect(page.locator(".palette-grid button")).toHaveCount(5);
  await page.getByRole("button", { name: "8 colors", exact: true }).click();
  await expect(page.locator(".palette-grid button")).toHaveCount(8);
  await noOverflow(page);
  await page
    .getByLabel("Upload photo", { exact: true })
    .setInputFiles({
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("not a png"),
    });
  await expect(page.getByRole("alert")).toContainText("could not be decoded");
});
test("cached production app reloads offline and does real processing without requests", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText("Working offline", { exact: true }),
  ).toBeVisible();
  await nav(page, "Color Sense");
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.method() + " " + r.url()));
  await page.getByLabel("Upload photo", { exact: true }).setInputFiles(fixture);
  await expect(page.locator(".color-readout strong")).toHaveText("#94B889");
  await expect(page.locator(".palette-grid button")).toHaveCount(1);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.locator(".zoom-controls")).toContainText("150%");
  expect(requests.filter((r) => !r.includes("blob:"))).toEqual([]);
  await context.setOffline(false);
});
