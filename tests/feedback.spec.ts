import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const service = () => process.env.POCKETSENSE_E2E_API!;
const messageField = (page: Page) =>
  page.getByRole("textbox", { name: "Your feedback", exact: true });
const submitButton = (page: Page) =>
  page.getByRole("button", { name: "Submit feedback" });
const receipt = (page: Page) =>
  page.getByRole("heading", { name: "Feedback received" });

// The owner credential lives for this suite only. Keep entered keys, headers and mail
// out of Playwright's recorded artifacts even on a retry or test failure.
test.use({ trace: "off", screenshot: "off", video: "off" });

test("invalid forms cannot send, and server or network failure leaves a retryable draft", async ({
  page,
}) => {
  let requests = 0;
  const origin = "http://127.0.0.1:4195";
  await page.route(service() + "/feedback", async (route) => {
    requests++;
    if (requests === 2) return route.abort("failed");
    const status = requests === 1 ? 503 : 200;
    return route.fulfill({
      status,
      headers: { "Access-Control-Allow-Origin": origin },
      json: {},
    });
  });
  await page.goto("./#feedback");
  await submitButton(page).click();
  await expect(messageField(page)).toBeFocused();
  await messageField(page).fill("   ");
  await submitButton(page).click();
  await expect(page.getByRole("alert")).toContainText("describe your feedback");
  const content = "Preserve this typed message after an unsuccessful request.";
  await messageField(page).fill(content);
  const email = page.getByLabel("Email for follow-up", { exact: false });
  await email.fill("broken-address");
  await submitButton(page).click();
  await expect(email).toBeFocused();
  expect(requests).toBe(0);
  await email.fill("");
  for (const message of [
    /could not complete/i,
    /could not reach/i,
    /did not confirm/i,
  ]) {
    await submitButton(page).click();
    await expect(page.getByRole("alert")).toHaveText(message);
    await expect(receipt(page)).toHaveCount(0);
    await expect(messageField(page)).toHaveValue(content);
  }
  await page.reload();
  await expect(messageField(page)).toHaveValue(content);
});

test("offline drafts survive reopening and are sent only on a deliberate submit", async ({
  page,
  context,
}) => {
  const posts: string[] = [];
  context.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url() === service() + "/feedback"
    )
      posts.push(request.postData() || "");
  });
  await page.goto("./#feedback");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  const content = "I wrote this draft offline. " + randomUUID();
  await messageField(page).fill(content);
  await expect(submitButton(page)).toBeDisabled();
  await expect(page.getByText(/reconnect to submit your draft/i)).toBeVisible();
  const reopened = await context.newPage();
  await page.close();
  await reopened.goto("./#feedback");
  await expect(messageField(reopened)).toHaveValue(content);
  await expect(submitButton(reopened)).toBeDisabled();
  await context.setOffline(false);
  await expect(submitButton(reopened)).toBeEnabled();
  // Exercise navigation after reconnecting to catch submission on mount or reconnection.
  await reopened.reload();
  await expect(messageField(reopened)).toHaveValue(content);
  expect(posts).toEqual([]);
  const stored = reopened.waitForResponse(
    (r) =>
      r.url() === service() + "/feedback" && r.request().method() === "POST",
  );
  await submitButton(reopened).click();
  expect((await stored).status()).toBe(201);
  await expect(receipt(reopened)).toBeVisible();
  expect(posts).toHaveLength(1);
  await reopened.reload();
  await expect(messageField(reopened)).toHaveValue("");
});

test("scientific work stays on device and public feedback contains only the entered fields", async ({
  page,
  context,
  baseURL,
  request,
}) => {
  const crossingOrigin: { method: string; url: string; body: string | null }[] =
    [];
  const site = new URL(baseURL!).origin;
  context.on("request", (r) => {
    if (
      /^https?:/.test(r.url()) &&
      new URL(r.url()).origin !== site &&
      r.method() !== "OPTIONS"
    )
      crossingOrigin.push({
        method: r.method(),
        url: r.url(),
        body: r.postData(),
      });
  });
  await page.goto("./#color");
  await page
    .getByLabel("Upload image", { exact: true })
    .setInputFiles(
      fileURLToPath(new URL("./fixtures/neutral.png", import.meta.url)),
    );
  await expect(page.getByTestId("color-hex")).toHaveText("#3C78B4");
  await page.goto("./#ph");
  await page.getByRole("button", { name: /Load synthetic pH demo/ }).click();
  await page
    .getByLabel("Import reference profile", { exact: true })
    .setInputFiles({
      name: "private-chart.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          id: "local-chart",
          name: "Private chart fixture",
          synthetic: true,
          points: [
            { ph: 5, hex: "#353636" },
            { ph: 8, hex: "#95b975" },
          ],
        }),
      ),
    });
  await expect(page.getByTestId("ph-estimate")).toHaveText("8.00");
  await expect(
    page.getByRole("option", { name: "Private chart fixture", selected: true }),
  ).toBeAttached();
  expect(crossingOrigin).toEqual([]);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Feedback" })
    .click();
  const message = "Please add more keyboard shortcuts. " + randomUUID();
  await messageField(page).fill(message);
  await page.getByLabel("Feedback type").selectOption("ux");
  await page.getByLabel("Related feature").selectOption("color");
  await page.getByLabel("Ease of use").selectOption("4");
  const stored = page.waitForResponse(
    (r) =>
      r.url() === service() + "/feedback" && r.request().method() === "POST",
  );
  await submitButton(page).click();
  const response = await stored;
  expect(response.status()).toBe(201);
  const data = await response.json();
  expect(Object.keys(data)).toEqual(["id"]);
  await expect(receipt(page)).toBeVisible();
  expect(crossingOrigin).toHaveLength(1);
  const transfer = crossingOrigin[0];
  expect([transfer.method, transfer.url]).toEqual([
    "POST",
    service() + "/feedback",
  ]);
  expect(JSON.parse(transfer.body!)).toEqual({
    category: "ux",
    feature: "color",
    message,
    rating: 4,
  });
  const inbox = await request.get(
    service() + "/admin/feedback?category=ux&feature=color",
    {
      headers: { Authorization: "Bearer " + process.env.POCKETSENSE_E2E_OWNER },
    },
  );
  expect(inbox.status()).toBe(200);
  expect((await inbox.json()).items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: data.id, message, email: null }),
    ]),
  );
});

test("only the owner can read mail, sort and filter messages, save status and export the selected page", async ({
  page,
  request,
}) => {
  const run = randomUUID();
  const first = "First note " + run;
  const last = "=Second note " + run;
  const email = run + "@example.invalid";
  for (const message of [first, last]) {
    const posted = await request.post(service() + "/feedback", {
      data: { message, category: "accuracy", feature: "calibration", email },
    });
    expect(posted.status()).toBe(201);
    expect(Object.keys(await posted.json())).toEqual(["id"]);
  }
  for (const [path, status] of [
    ["/feedback", 405],
    ["/admin/feedback", 401],
  ] as const) {
    const response = await request.get(service() + path);
    expect(response.status()).toBe(status);
    expect(await response.text()).not.toContain(email);
  }
  await page.goto("./#admin");
  const key = page.getByLabel("Owner key", { exact: true });
  const open = page.getByRole("button", { name: "Open inbox" });
  await key.fill(randomUUID());
  await open.click();
  await expect(page.getByRole("alert")).toContainText("Access denied");
  await expect(page.getByText(email, { exact: true })).toHaveCount(0);
  await key.fill(process.env.POCKETSENSE_E2E_OWNER!);
  await open.click();
  const records = page.getByRole("article");
  await expect(records.filter({ hasText: last })).toContainText(email);
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("accuracy");
  await page
    .getByRole("combobox", { name: "Related feature", exact: true })
    .selectOption("paint");
  await expect(
    page.getByText("No submissions match these filters."),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Related feature", exact: true })
    .selectOption("calibration");
  const runRecords = records.filter({ hasText: run });
  await expect(runRecords).toHaveCount(2);
  await expect(runRecords.first()).toContainText(last);
  await page.getByLabel("Sort by date").selectOption("oldest");
  await expect(runRecords.first()).toContainText(first);
  await runRecords
    .filter({ hasText: last })
    .getByLabel("Status for this submission")
    .selectOption("reviewing");
  await expect(page.getByText("Status saved.")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("reviewing");
  await expect(runRecords).toHaveCount(1);
  await expect(runRecords).toContainText(last);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export this page" }).click();
  const file = await download;
  const csv = await readFile((await file.path())!, "utf8");
  expect(csv).toContain("'" + last);
  expect(csv).toContain(email);
  expect(csv).not.toContain(first);
  await page.getByRole("button", { name: "Lock inbox" }).click();
  await expect(key).toBeVisible();
  await expect(records).toHaveCount(0);
  await page.reload();
  await expect(key).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toHaveCount(0);
});

test("retry after losing a stored receipt reuses the ID and leaves another tab's newer draft intact", async ({
  page,
  context,
  request,
}) => {
  const url = service() + "/feedback";
  const message = "Durable submission " + randomUUID();
  const newerDraft = "Newer unsent draft " + randomUUID();
  let firstReceipt = "";
  let release: () => void = () => {};
  const acknowledge = new Promise<void>((resolve) => {
    release = resolve;
  });
  let responseReady: () => void = () => {};
  const storedRetry = new Promise<void>((resolve) => {
    responseReady = resolve;
  });
  let attempts = 0;
  await page.route(url, async (route) => {
    const stored = await route.fetch();
    expect(stored.status()).toBe(201);
    const { id } = await stored.json();
    attempts++;
    if (attempts === 1) {
      firstReceipt = id;
      return route.abort("failed"); // Simulate losing only the backend acknowledgement.
    }
    expect(id).toBe(firstReceipt);
    responseReady();
    await acknowledge;
    await route.fulfill({ response: stored });
  });
  await page.goto("./#feedback");
  await messageField(page).fill(message);
  await submitButton(page).click();
  await expect(page.getByRole("alert")).toContainText("Could not reach");
  await expect(receipt(page)).toHaveCount(0);
  await page.reload();
  await expect(messageField(page)).toHaveValue(message);
  await submitButton(page).click();
  await storedRetry;
  try {
    const other = await context.newPage();
    await other.goto("./#feedback");
    await messageField(other).fill(newerDraft);
  } finally {
    release();
  }
  await expect(receipt(page)).toBeVisible();
  await page.reload();
  await expect(messageField(page)).toHaveValue(newerDraft);
  const inbox = await request.get(service() + "/admin/feedback", {
    headers: {
      Authorization: "Bearer " + process.env.POCKETSENSE_E2E_OWNER,
    },
  });
  expect(inbox.status()).toBe(200);
  const { items } = (await inbox.json()) as {
    items: { message: string; id: string }[];
  };
  expect(
    items.filter((row) => row.message === message).map((row) => row.id),
  ).toEqual([firstReceipt]);
  expect(items.some((row) => row.message === newerDraft)).toBe(false);
});
