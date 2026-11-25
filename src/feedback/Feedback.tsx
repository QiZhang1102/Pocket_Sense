import { useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CheckCircle2,
  LockKeyhole,
  MessageSquare,
  WifiOff,
} from "lucide-react";
import {
  api,
  apiBase,
  categories,
  errorText,
  features,
  type Category,
  type Feature,
} from "./api";
import "./feedback.css";

const draftKey = "pocketsense.feedback.draft.v1";
const blank = {
  category: "general" as Category,
  feature: "" as Feature | "",
  message: "",
  email: "",
  rating: "",
  submissionKey: "",
};
function readDraft(): typeof blank {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey) || "null");
    if (!d || typeof d !== "object") return blank;
    return {
      category: Object.hasOwn(categories, d.category) ? d.category : "general",
      feature: Object.hasOwn(features, d.feature) ? d.feature : "",
      message: typeof d.message === "string" ? d.message.slice(0, 4000) : "",
      submissionKey:
        typeof d.submissionKey === "string" &&
        /^[a-f0-9-]{36}$/i.test(d.submissionKey)
          ? d.submissionKey
          : "",
      email: typeof d.email === "string" ? d.email.slice(0, 254) : "",
      rating: /^[1-5]$/.test(d.rating) ? String(d.rating) : "",
    };
  } catch {
    return blank;
  }
}
export function Feedback({ connected }: { connected: boolean }) {
  const [draft, setDraft] = useState(readDraft);
  const [saveFailed, setSaveFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [received, setReceived] = useState(false);
  const [error, setError] = useState("");
  const message = useRef<HTMLTextAreaElement>(null);
  const website = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  function remember(next: typeof blank) {
    setDraft(next);
    try {
      if (
        Object.keys(blank).some(
          (k) =>
            next[k as keyof typeof blank] !== blank[k as keyof typeof blank],
        )
      ) {
        localStorage.setItem(draftKey, JSON.stringify(next));
      } else {
        localStorage.removeItem(draftKey);
      }
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  }
  const update = (key: keyof typeof draft, value: string) => {
    remember({ ...draft, [key]: value, submissionKey: "" });
    setError("");
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !connected || !navigator.onLine || !apiBase) return;
    if (!draft.message.trim()) {
      setError("Please describe your feedback.");
      message.current?.focus();
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const submitted = {
        ...draft,
        submissionKey: draft.submissionKey || crypto.randomUUID(),
      };
      remember(submitted);
      const response = await api("/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": submitted.submissionKey,
        },
        body: JSON.stringify({
          category: draft.category,
          ...(draft.feature && { feature: draft.feature }),
          message: draft.message.trim(),
          ...(draft.email.trim() && { email: draft.email.trim() }),
          ...(draft.rating && { rating: Number(draft.rating) }),
          ...(website.current?.value && { website: website.current.value }),
        }),
      });
      const receipt = await response.json();
      if (
        response.status !== 201 ||
        typeof receipt?.id !== "string" ||
        !receipt.id
      )
        throw new Error(
          "The service did not confirm receipt. Your draft is still available.",
        );
      // Clear even if the user navigated to another tool while the request was in flight.
      try {
        if (localStorage.getItem(draftKey) === JSON.stringify(submitted))
          localStorage.removeItem(draftKey);
      } catch {
        /* storage may be disabled */
      }
      setDraft(blank);
      setReceived(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="fb-page section-enter">
      <header className="fb-intro">
        <span className="fb-icon">
          <MessageSquare aria-hidden="true" />
        </span>
        <h1>Share your feedback</h1>
        <p>
          What worked, what got in the way, or what would you like to measure
          next?
        </p>
      </header>
      {received ? (
        <div className="fb-panel fb-receipt" role="status">
          <CheckCircle2 size={32} />
          <h2>Feedback received</h2>
          <p>Thank you for helping shape PocketSense.</p>
          <button
            className="button secondary"
            onClick={() => {
              setDraft(readDraft());
              setReceived(false);
            }}
          >
            Write another message
          </button>
        </div>
      ) : (
        <div className="fb-layout">
          <form className="fb-panel" onSubmit={submit}>
            <fieldset disabled={busy} className="fb-fields">
              <div className="fb-pair">
                <label>
                  Feedback type
                  <select
                    value={draft.category}
                    onChange={(e) => update("category", e.target.value)}
                  >
                    {Object.entries(categories).map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Related feature <small>(optional)</small>
                  <select
                    value={draft.feature}
                    onChange={(e) => update("feature", e.target.value)}
                  >
                    <option value="">Choose a feature</option>
                    {Object.entries(features).map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Your feedback
                <textarea
                  ref={message}
                  required
                  maxLength={4000}
                  rows={6}
                  value={draft.message}
                  onChange={(e) => update("message", e.target.value)}
                  placeholder="Describe your idea or the steps that led to a problem."
                />
              </label>
              <div className="fb-pair">
                <label>
                  Email for follow-up <small>(optional)</small>
                  <input
                    type="email"
                    pattern={String.raw`[^\s@]+@[^\s@]+\.[^\s@]+`}
                    title="Use an address such as name@example.com"
                    maxLength={254}
                    autoComplete="email"
                    value={draft.email}
                    onChange={(e) => update("email", e.target.value)}
                  />
                </label>
                <label>
                  Ease of use <small>(optional)</small>
                  <select
                    value={draft.rating}
                    onChange={(e) => update("rating", e.target.value)}
                  >
                    <option value="">Choose a rating</option>
                    {[
                      "1 · Very difficult",
                      "2 · Difficult",
                      "3 · Neutral",
                      "4 · Easy",
                      "5 · Very easy",
                    ].map((t, i) => (
                      <option key={t} value={i + 1}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="fb-trap" aria-hidden="true">
                <input
                  ref={website}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-label="Leave empty"
                />
              </div>
              {!connected ? (
                <p role="status" className="fb-note">
                  <WifiOff size={16} /> You’re offline. Reconnect to submit your
                  draft.
                </p>
              ) : (
                !apiBase && (
                  <p role="status" className="fb-note">
                    Online feedback is not connected on this site yet. You can
                    keep a draft here.
                  </p>
                )
              )}
              {error && (
                <p role="alert" className="fb-error">
                  {error}
                </p>
              )}
              <div className="fb-actions">
                <button
                  className="button primary"
                  disabled={!apiBase || !connected || busy}
                >
                  {busy ? "Sending…" : "Submit feedback"}
                  <ArrowRight size={16} />
                </button>
                <button
                  className="fb-text"
                  type="button"
                  onClick={() => {
                    remember(blank);
                    setError("");
                    message.current?.focus();
                  }}
                >
                  Clear draft
                </button>
              </div>
            </fieldset>
          </form>
          <aside className="fb-aside">
            <LockKeyhole size={24} />
            <h2>Your feedback is private</h2>
            <p>
              Only the project owners can read your submission. Include only
              details you want to share. Please leave out personal health
              information.
            </p>
            <p>
              {saveFailed
                ? "Browser storage is unavailable. Keep this page open to retain your text."
                : "Your draft, including any email you enter, stays in this browser until you submit or clear it."}
            </p>
            <a href="#about">
              Privacy information <ArrowRight size={14} />
            </a>
          </aside>
        </div>
      )}
    </section>
  );
}
