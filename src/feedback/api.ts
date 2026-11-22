export const categories = {
  feature: "Feature request",
  bug: "Bug report",
  general: "General feedback",
  ux: "User experience",
  accuracy: "Scientific accuracy / calibration",
  other: "Other",
} as const;
export const features = {
  ph: "pH Sense",
  color: "Color Sense",
  calibration: "Color calibration",
  skin: "Skin color tracking",
  paint: "Wall color finder",
  assay: "POCT / microfluidics",
  platform: "General platform",
  other: "Other",
} as const;
export const statuses = {
  new: "New",
  reviewing: "Under review",
  planned: "Planned",
  completed: "Completed",
  declined: "Declined",
} as const;
export type Category = keyof typeof categories;
export type Feature = keyof typeof features;
export type Status = keyof typeof statuses;
export interface FeedbackItem {
  id: string;
  category: Category;
  feature: Feature | null;
  message: string;
  email: string | null;
  rating: number | null;
  status: Status;
  createdAt: string;
}
const loopback = (name: string) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(name);
function endpoint(): string {
  const configured = import.meta.env.VITE_FEEDBACK_API_URL?.trim();
  if (!configured)
    return loopback(location.hostname) ? "http://127.0.0.1:8787" : "";
  try {
    const url = new URL(configured);
    if (url.username || url.password || url.search || url.hash) return "";
    if (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        loopback(url.hostname) &&
        loopback(location.hostname))
    )
      return url.href.replace(/\/$/, "");
  } catch {
    /* Display the unavailable state for invalid build settings. */
  }
  return "";
}
export const apiBase = endpoint();
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api(path: string, init: RequestInit = {}) {
  if (!apiBase) throw new Error("The feedback service is not connected.");
  let response: Response;
  try {
    response = await fetch(apiBase + path, {
      ...init,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(
      "Could not reach the feedback service. Check your connection and try again.",
    );
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new ApiError(
        response.status,
        "Access denied. Check your owner key and the allowed site address.",
      );
    if (response.status === 429)
      throw new ApiError(
        429,
        "The feedback service is receiving many requests. Please try again later.",
      );
    if (response.status === 400 || response.status === 422)
      throw new ApiError(
        response.status,
        "Please check the form fields and try again.",
      );
    throw new ApiError(
      response.status,
      "The feedback service could not complete this request. Please try again.",
    );
  }
  return response;
}
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Request could not be completed.";
