import { expect, test, type Page } from "@playwright/test";

const viewportLabel =
  "Feature slides. Use left and right arrow keys to explore.";
const visibleSlide = (page: Page) => page.locator(".fd-slide:not([inert])");

test("discovery opens each available workspace and keeps both shortcuts in reach", async ({
  page,
}) => {
  await page.goto("./#discover");
  const shortcuts = page.getByRole("group", { name: "Open an available tool" });
  await expect(
    shortcuts.getByRole("link", { name: "pH Sense" }),
  ).toHaveAttribute("href", "#ph");
  await expect(
    shortcuts.getByRole("link", { name: "Color Sense" }),
  ).toHaveAttribute("href", "#color");
  await expect(visibleSlide(page)).toContainText("Available now");
  await visibleSlide(page).getByRole("link", { name: "Open pH Sense" }).click();
  await expect(
    page.getByRole("heading", { name: /^pH Sense/i }).first(),
  ).toBeVisible();
  await page.goBack();
  await page.getByRole("button", { name: "Next feature" }).click();
  await visibleSlide(page)
    .getByRole("link", { name: "Open Color Sense" })
    .click();
  await expect(
    page.getByRole("heading", { name: /^Color Sense/i }).first(),
  ).toBeVisible();
});

test("concept slides, keyboard navigation and feedback links identify real destinations", async ({
  page,
}) => {
  await page.goto("./#discover");
  const viewport = page.getByRole("group", { name: viewportLabel });
  await viewport.focus();
  await page.keyboard.press("End");
  await expect(visibleSlide(page).getByRole("heading")).toHaveText(
    "Research Pad Reader",
  );
  await expect(
    page.getByRole("button", { name: "Next feature" }),
  ).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(visibleSlide(page).getByRole("heading")).toHaveText(
    "Wall Color Finder",
  );
  await page.getByRole("button", { name: "Previous feature" }).click();
  await expect(visibleSlide(page)).toContainText("Color Calibration");
  for (const title of [
    "Color Calibration",
    "Wall Color Finder",
    "Research Pad Reader",
  ]) {
    await page.getByRole("button", { name: `Show ${title}` }).click();
    await expect(visibleSlide(page).getByRole("heading")).toHaveText(title);
    await expect(visibleSlide(page)).toContainText("Exploratory concept");
    await expect(visibleSlide(page).getByRole("link")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: `Show ${title}` }),
    ).toHaveAttribute("aria-current", "true");
  }
  await viewport.focus();
  await page.keyboard.press("Home");
  await expect(visibleSlide(page).getByRole("heading")).toHaveText("pH Sense");
  await page.keyboard.press("ArrowRight");
  await expect(visibleSlide(page).getByRole("heading")).toHaveText(
    "Color Sense",
  );
  await page
    .getByRole("link", { name: "Share your ideas", exact: true })
    .click();
  await expect(page).toHaveURL(/#feedback$/);
});

test("reduced motion disables carousel animation and layouts fit the screen", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("./#discover");
    const viewport = page.getByRole("group", { name: viewportLabel });
    await expect(viewport).toHaveCSS("scroll-behavior", "auto");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Show Wall Color Finder" }).click();
    await expect(visibleSlide(page).getByRole("heading")).toHaveText(
      "Wall Color Finder",
    );
    await expect(
      page.getByRole("group", { name: "Open an available tool" }),
    ).toBeVisible();
  }
});

test("touch swipes advance and return on a phone-sized viewport", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto("./#discover");
    const viewport = page.getByRole("group", { name: viewportLabel });
    await viewport.scrollIntoViewIfNeeded();
    const box = await viewport.boundingBox();
    if (!box) throw new Error("Missing carousel viewport");
    const session = await context.newCDPSession(page);
    async function swipe(from: number, to: number) {
      const y = box!.y + box!.height * 0.55;
      const send = (type: "touchStart" | "touchMove", fraction: number) =>
        session.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: [{ x: box!.x + box!.width * fraction, y }],
        });
      await send("touchStart", from);
      for (let step = 1; step <= 9; step++)
        await send("touchMove", from + ((to - from) * step) / 9);
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    }
    await swipe(0.87, 0.13);
    await expect(visibleSlide(page).getByRole("heading")).toHaveText(
      "Color Sense",
    );
    await expect
      .poll(() =>
        viewport.evaluate((el) => Math.abs(el.scrollLeft - el.clientWidth)),
      )
      .toBeLessThan(2);
    await swipe(0.13, 0.87);
    await expect(visibleSlide(page).getByRole("heading")).toHaveText(
      "pH Sense",
    );
  } finally {
    await context.close();
  }
});
