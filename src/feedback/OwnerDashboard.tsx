import { useEffect, useState } from "react";
import { Inbox, KeyRound, Download } from "lucide-react";
import {
  api,
  apiBase,
  ApiError,
  categories,
  features,
  statuses,
  errorText,
  type FeedbackItem,
  type Status,
} from "./api";
import { toCsv } from "../lib/export";
import "./feedback.css";

function exportPage(rows: FeedbackItem[]) {
  const url = URL.createObjectURL(
    new Blob([toCsv(rows.map((r) => ({ ...r })))], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "pocketsense-feedback-page.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function OwnerSession() {
  const [key, setKey] = useState(""),
    [entry, setEntry] = useState(""),
    [verified, setVerified] = useState(false);
  const [rows, setRows] = useState<FeedbackItem[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState({
    category: "",
    feature: "",
    status: "",
    sort: "newest",
  });
  const [offset, setOffset] = useState(0),
    [next, setNext] = useState<number | null>(null),
    [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false),
    [notice, setNotice] = useState("");
  function lock() {
    setBusy(false);
    setKey("");
    setVerified(false);
    setEntry("");
    setRows([]);
    setNext(null);
    setOffset(0);
    setNotice("");
  }
  useEffect(() => {
    if (!key) return;
    let current = true;
    async function load() {
      setBusy(true);
      setError("");
      setRows([]);
      setNext(null);
      const params = new URLSearchParams({
        sort: query.sort,
        offset: String(offset),
      });
      for (const field of ["feature", "category", "status"] as const)
        if (query[field]) params.set(field, query[field]);
      try {
        const data = await (
          await api("/admin/feedback?" + params, {
            headers: { Authorization: "Bearer " + key },
          })
        ).json();
        if (!Array.isArray(data.items))
          throw new Error("Could not load the inbox.");
        if (current) {
          setVerified(true);
          setRows(data.items);
          setNext(data.nextOffset);
        }
      } catch (err) {
        if (current) {
          if (err instanceof ApiError && [401, 403].includes(err.status))
            lock();
          setError(errorText(err));
        }
      } finally {
        if (current) setBusy(false);
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [key, query, offset, revision]);
  async function changeStatus(id: string, status: Status) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await (
        await api("/admin/feedback/" + encodeURIComponent(id), {
          method: "PATCH",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status }),
        })
      ).json();
      if (result.status !== status || result.id !== id)
        throw new Error("The update was not confirmed.");
      setNotice("Status saved.");
      setOffset(0);
      setRevision((v) => v + 1);
    } catch (err) {
      if (err instanceof ApiError && [401, 403].includes(err.status)) lock();
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }
  if (!verified)
    return (
      <form
        className="fb-panel fb-login"
        onSubmit={(e) => {
          e.preventDefault();
          setKey(entry.trim());
          setEntry("");
          setRevision((v) => v + 1);
        }}
      >
        <KeyRound />
        <h2>Owner access</h2>
        <p>Enter the private owner key to review submissions.</p>
        <label>
          Owner key
          <input
            type="password"
            autoComplete="off"
            required
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
          />
        </label>
        {error && (
          <p className="fb-error" role="alert">
            {error}
          </p>
        )}
        <button disabled={busy || !entry.trim()} className="button primary">
          {busy ? "Opening…" : "Open inbox"}
        </button>
      </form>
    );
  function filter(field: keyof typeof query, value: string) {
    setQuery({ ...query, [field]: value });
    setOffset(0);
    setNotice("");
  }
  return (
    <div className="fb-inbox">
      <div className="fb-toolbar">
        <div>
          <button
            className="button secondary"
            disabled={!rows.length || busy}
            onClick={() => exportPage(rows)}
          >
            <Download size={16} />
            Export this page
          </button>
          <button
            className="fb-text"
            disabled={saving}
            onClick={() => {
              lock();
              setError("");
            }}
          >
            Lock inbox
          </button>
        </div>
      </div>
      <fieldset className="fb-filters" disabled={saving}>
        <legend>Filter submissions</legend>
        {(
          [
            ["category", "Category", categories],
            ["feature", "Related feature", features],
            ["status", "Status", statuses],
          ] as const
        ).map(([field, label, options]) => (
          <label key={field}>
            {label}
            <select
              value={query[field]}
              onChange={(e) => filter(field, e.target.value)}
            >
              <option value="">All</option>
              {Object.entries(options).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          Sort by date
          <select
            value={query.sort}
            onChange={(e) => filter("sort", e.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </fieldset>
      {error && (
        <p className="fb-error" role="alert">
          {error}{" "}
          <button className="fb-text" onClick={() => setRevision((r) => r + 1)}>
            Refresh
          </button>
        </p>
      )}
      <p role="status" className="fb-counter">
        {busy
          ? "Loading submissions…"
          : notice ||
            (rows.length
              ? "Showing " + (offset + 1) + "–" + (offset + rows.length)
              : error
                ? ""
                : "No submissions match these filters.")}
      </p>
      {rows.map((r) => (
        <article className="fb-panel fb-record" key={r.id}>
          <header>
            <h2>{categories[r.category]}</h2>
            <time dateTime={r.createdAt}>
              {new Date(r.createdAt).toLocaleString()}
            </time>
          </header>
          <div className="fb-meta">
            {r.feature && <span>{features[r.feature]}</span>}
            {r.rating != null && <span>Ease of use {r.rating}/5</span>}
          </div>
          <p className="fb-message">{r.message}</p>
          <details className="fb-details">
            <summary>Submission details</summary>
            <p>
              Receipt <code>{r.id}</code>
            </p>
          </details>
          <div className="fb-record-foot">
            {r.email && <span>{r.email}</span>}
            <label>
              Status for this submission
              <select
                disabled={saving}
                value={r.status}
                onChange={(e) =>
                  void changeStatus(r.id, e.target.value as Status)
                }
              >
                {Object.entries(statuses).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </article>
      ))}
      {(offset > 0 || next !== null) && (
        <div className="fb-actions">
          <button
            className="button secondary"
            disabled={offset === 0 || busy || saving}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >
            Previous page
          </button>
          <button
            className="button secondary"
            disabled={next === null || busy || saving}
            onClick={() => next !== null && setOffset(next)}
          >
            Next page
          </button>
        </div>
      )}
    </div>
  );
}
export function OwnerDashboard({ connected }: { connected: boolean }) {
  return (
    <section className="fb-page section-enter">
      <header className="fb-intro">
        <span className="fb-icon">
          <Inbox />
        </span>
        <h1>Feedback inbox</h1>
        <p>Review suggestions and manage their status.</p>
      </header>
      {!connected || !apiBase ? (
        <p className="fb-panel" role="status">
          {!connected
            ? "Reconnect to access the private inbox."
            : "Connect the feedback service to enable owner access."}
        </p>
      ) : (
        <OwnerSession />
      )}
    </section>
  );
}
