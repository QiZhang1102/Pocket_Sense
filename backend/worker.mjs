// The public API accepts only these explicit survey fields. Analysis data has no API.
const categories = ["feature", "bug", "general", "ux", "accuracy", "other"];
const features = ["ph", "color", "calibration", "skin", "paint", "assay", "platform", "other"];
const statuses = ["new", "reviewing", "planned", "completed", "declined"];
const fields = ["category", "feature", "message", "email", "rating", "website"];
const maxBytes = 24 * 1024;
const pageSize = 100;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(request, allowedFields) {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ApiError(415, "Send feedback as JSON.");
  }
  if (Number(request.headers.get("Content-Length")) > maxBytes) {
    throw new ApiError(413, "The submission is too large.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "A request body is required.");
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      void reader.cancel().catch(() => {});
      throw new ApiError(413, "The submission is too large.");
    }
    text += decoder.decode(value, { stream: true });
  }
  let data;
  try {
    data = JSON.parse(text + decoder.decode());
  } catch {
    throw new ApiError(400, "Invalid JSON.");
  }
  if (!data || Array.isArray(data) || typeof data !== "object" ||
      Object.keys(data).some((key) => !allowedFields.includes(key))) {
    throw new ApiError(400, "Unexpected submission fields.");
  }
  return data;
}

function validateFeedback(data) {
  if (!categories.includes(data.category)) throw new ApiError(400, "Choose a feedback category.");
  if (data.feature !== undefined && !features.includes(data.feature)) throw new ApiError(400, "Choose a listed feature.");
  if (typeof data.message !== "string" || !data.message.trim() || data.message.length > 4000) {
    throw new ApiError(400, "Enter feedback of up to 4,000 characters.");
  }
  if (data.email !== undefined && (typeof data.email !== "string" || data.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))) {
    throw new ApiError(400, "Check the email address.");
  }
  if (data.rating !== undefined && (!Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5)) {
    throw new ApiError(400, "Choose a rating from 1 to 5.");
  }
  if (data.website !== undefined && data.website !== "") throw new ApiError(400, "Unable to accept this submission.");
}

async function authorize(request, secret) {
  const candidate = request.headers.get("Authorization")?.match(/^Bearer ([^\s]{32,256})$/)?.[1];
  if (!candidate) throw new ApiError(401, "Owner access required.");
  // HMAC verification uses the runtime's cryptographic comparison rather than a password loop.
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(secret));
  if (!(await crypto.subtle.verify("HMAC", key, signature, encoder.encode(candidate)))) {
    throw new ApiError(401, "Owner access required.");
  }
}

async function submit(request, env) {
  // This key is shared by all senders. It contains no browser or network identifier.
  if (env.SUBMISSIONS && !(await env.SUBMISSIONS.limit({ key: "feedback" })).success) {
    throw new ApiError(429, "The feedback inbox is busy. Please try again later.");
  }
  const data = await readJson(request, fields);
  validateFeedback(data);
  // A random key belongs to one draft and survives an explicit retry after a lost reply.
  const retryKey = request.headers.get("Idempotency-Key");
  if (retryKey !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(retryKey)) {
    throw new ApiError(400, "Invalid submission key.");
  }
  const id = retryKey?.toLowerCase() ?? crypto.randomUUID();
  const values = [data.category, data.feature ?? null, data.message.trim(), data.email ?? null, data.rating ?? null];
  const now = Date.now();
  // One atomic write in D1 enforces the global cap across concurrent Worker locations.
  const result = await env.DB.prepare(`
    INSERT INTO feedback (id, createdAt, category, feature, message, email, rating)
    SELECT ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM feedback WHERE createdAt >= ?) < 12
      AND (SELECT COUNT(*) FROM feedback WHERE createdAt >= ?) < 240
    ON CONFLICT(id) DO NOTHING
  `).bind(id, new Date(now).toISOString(), ...values,
    new Date(now - 60000).toISOString(), new Date(now - 86400000).toISOString()).run();
  if (result.meta.changes === 1) return { id };
  if (retryKey) {
    // Check only the claimed receipt, including after a quota fills or a status changes.
    // Never return or overwrite the first submission's private fields.
    const { results } = await env.DB.prepare(`
      SELECT (category = ? AND feature IS ? AND message = ? AND email IS ? AND rating IS ?) AS matches
      FROM feedback WHERE id = ?
    `).bind(...values, id).all();
    if (results[0]?.matches) return { id };
    if (results.length) throw new ApiError(409, "This submission key already belongs to different feedback.");
  }
  throw new ApiError(429, "The feedback inbox is busy. Please try again later.");
}

async function list(db, params) {
  const conditions = [];
  const values = [];
  for (const [name, allowed] of [["category", categories], ["feature", features], ["status", statuses]]) {
    const value = params.get(name);
    if (!value) continue;
    if (!allowed.includes(value)) throw new ApiError(400, "Invalid filter.");
    conditions.push(name + " = ?");
    values.push(value);
  }
  const sort = params.get("sort") || "newest";
  if (!["oldest", "newest"].includes(sort)) throw new ApiError(400, "Invalid date order.");
  const direction = sort === "oldest" ? "ASC" : "DESC";
  const rawOffset = params.get("offset") ?? "0";
  if (!/^\d{1,9}$/.test(rawOffset)) throw new ApiError(400, "Invalid page offset.");
  const offset = Number(rawOffset);
  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
  const { results } = await db.prepare(
    "SELECT id,createdAt,category,feature,message,email,rating,status FROM feedback" +
    where + " ORDER BY createdAt " + direction + ", id " + direction + " LIMIT ? OFFSET ?"
  ).bind(...values, pageSize + 1, offset).all();
  return { items: results.slice(0, pageSize), nextOffset: results.length > pageSize ? offset + pageSize : null };
}

async function route(request, env, headers) {
  const url = new URL(request.url);
  const { pathname } = url;
  const record = pathname.match(/^\/admin\/feedback\/([0-9a-f-]{36})$/);
  const publicWrite = pathname === "/feedback";
  const privateList = pathname === "/admin/feedback";
  if (!publicWrite && !privateList && !record) throw new ApiError(404, "Not found.");
  const allowedMethod = publicWrite ? "POST" : privateList ? "GET" : "PATCH";
  if (request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Methods", allowedMethod);
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== allowedMethod) throw new ApiError(405, "Method unavailable.");
  if (!env.DB || !env.OWNER_TOKEN || !/^[^\s]{32,256}$/.test(env.OWNER_TOKEN)) {
    throw new ApiError(503, "Feedback is temporarily unavailable.");
  }
  let result;
  if (publicWrite) {
    result = await submit(request, env);
  } else {
    await authorize(request, env.OWNER_TOKEN);
    if (privateList) {
      result = await list(env.DB, url.searchParams);
    } else {
      const { status } = await readJson(request, ["status"]);
      if (!statuses.includes(status)) throw new ApiError(400, "Choose a valid status.");
      const updated = await env.DB.prepare("UPDATE feedback SET status = ? WHERE id = ?").bind(status, record[1]).run();
      if (!updated.meta.changes) throw new ApiError(404, "Submission unavailable.");
      result = { id: record[1], status };
    }
  }
  return Response.json(result, { status: publicWrite ? 201 : 200, headers });
}

export default {
  async fetch(request, env) {
    const headers = new Headers({ "Cache-Control": "no-store", "Vary": "Origin", "X-Content-Type-Options": "nosniff" });
    const origin = request.headers.get("Origin");
    try {
      if (origin !== null) {
        if (!env.ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).includes(origin)) {
          throw new ApiError(403, "Origin unavailable.");
        }
        headers.set("Access-Control-Allow-Origin", origin);
      }
      return await route(request, env, headers);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 503;
      if (status === 429) headers.set("Retry-After", "60");
      const error = err instanceof ApiError ? err.message : "Feedback is temporarily unavailable.";
      return Response.json({ error }, { status, headers });
    }
  },
};
