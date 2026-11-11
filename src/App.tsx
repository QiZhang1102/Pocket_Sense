import { useMemo, useRef, useState, useEffect } from "react";
import {
  Aperture,
  House,
  FlaskConical,
  Palette,
  Sun,
  BookOpen,
  Info,
  ArrowUpRight,
  ArrowRight,
  ShieldCheck,
  WifiOff,
  Check,
  Copy,
  Download,
  Plus,
  SlidersHorizontal,
  Trash2,
  CheckCircle2,
  TriangleAlert,
  X,
  RotateCcw,
  Upload,
} from "lucide-react";
import { Home, type Page } from "./components/Home";
import { ImageWorkspace } from "./components/ImageWorkspace";
import { ProfileEditor } from "./components/ProfileEditor";
import { hex, lab, cylindrical } from "./lib/color";
import {
  type Photo,
  type Rect,
  readPhoto,
  statistics,
  quality,
  calibrate,
  corrected,
  palette,
} from "./lib/image";
import {
  type Profile,
  demoProfile,
  validateProfile,
  matchPH,
  validationMetrics,
} from "./lib/ph";
import { demoPhoto } from "./lib/demo";
import {
  type Measurement,
  measurement,
  download,
  csv,
  loadLocal,
} from "./lib/data";
const nav = [
  { id: "home", label: "Explore", en: "Overview", icon: House },
  { id: "ph", label: "pH Sense", en: "Strip analysis", icon: FlaskConical },
  { id: "color", label: "Color Sense", en: "Color & palettes", icon: Palette },
  { id: "light", label: "Light Sense", en: "Exposure & correction", icon: Sun },
  { id: "history", label: "Notebook", en: "Measurements", icon: BookOpen },
];
function readProfiles(): Profile[] {
  const stored = loadLocal<unknown>("ps.profiles", []);
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((p) => {
    try {
      return [validateProfile(p)];
    } catch {
      return [];
    }
  });
}
function Stat({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>
        {value}
        <small>{suffix}</small>
      </strong>
    </div>
  );
}
function Notes({ notes }: { notes: string[] }) {
  return (
    <div className="qc-list">
      {notes.length ? (
        notes.map((n, i) => (
          <p key={i}>
            <TriangleAlert size={15} />
            {n}
          </p>
        ))
      ) : (
        <p className="ok">
          <CheckCircle2 size={16} />
          No exposure or uniformity thresholds triggered. Reference calibration
          and validation are still required.
        </p>
      )}
    </div>
  );
}
export default function App() {
  const [page, setPage] = useState<Page>("home"),
    [photo, setPhoto] = useState<Photo | null>(null),
    [roi, setRoi] = useState<Rect | null>(null),
    [refRegion, setRefRegion] = useState<Rect | null>(null),
    [target, setTarget] = useState<"sample" | "reference">("sample");
  const [correction, setCorrection] = useState(false),
    [profiles, setProfiles] = useState<Profile[]>(readProfiles),
    [selectedId, setSelectedId] = useState(""),
    [editor, setEditor] = useState(false),
    [editing, setEditing] = useState<Profile | null>(null),
    [interpolate, setInterpolate] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [paletteCount, setPaletteCount] = useState(5),
    [referencePH, setReferencePH] = useState(""),
    [sampleName, setSampleName] = useState("");
  const [persist, setPersist] = useState(
      () => loadLocal<boolean>("ps.persist", false) === true,
    ),
    [history, setHistory] = useState<Measurement[]>(() => {
      const h = loadLocal<Measurement[]>("ps.history", []);
      return Array.isArray(h)
        ? h.filter(
            (r) =>
              r.schema === "pocketsense.measurement.v1" &&
              Array.isArray(r.rgb) &&
              typeof r.id === "string",
          )
        : [];
    });
  const [online, setOnline] = useState(navigator.onLine),
    [offlineReady, setOfflineReady] = useState(false),
    [cacheError, setCacheError] = useState(false),
    [install, setInstall] = useState<
      (Event & { prompt: () => Promise<void> }) | null
    >(null),
    [clearConfirm, setClearConfirm] = useState(false);
  const fileToken = useRef(0);
  useEffect(() => {
    const o = () => setOnline(navigator.onLine),
      ready = () => setOfflineReady(true),
      failed = () => setCacheError(true),
      installHandler = (e: Event) => {
        e.preventDefault();
        setInstall(e as Event & { prompt: () => Promise<void> });
      };
    window.addEventListener("online", o);
    window.addEventListener("offline", o);
    window.addEventListener("pocketsense-ready", ready);
    window.addEventListener("pocketsense-cache-error", failed);
    window.addEventListener("beforeinstallprompt", installHandler);
    return () => {
      window.removeEventListener("online", o);
      window.removeEventListener("offline", o);
      window.removeEventListener("pocketsense-ready", ready);
      window.removeEventListener("pocketsense-cache-error", failed);
      window.removeEventListener("beforeinstallprompt", installHandler);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  function go(p: Page) {
    setPage(p);
    setTarget("sample");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function resetImage(p: Photo | null) {
    setPhoto(p);
    setRoi(
      p
        ? {
            x: Math.floor(p.pixels.width * 0.4),
            y: Math.floor(p.pixels.height * 0.4),
            w: Math.max(1, Math.floor(p.pixels.width * 0.2)),
            h: Math.max(1, Math.floor(p.pixels.height * 0.2)),
          }
        : null,
    );
    setRefRegion(null);
    setCorrection(false);
    setTarget("sample");
    setReferencePH("");
    setSampleName("");
    setError("");
    setSelectedId("");
    setInterpolate(false);
  }
  async function upload(file: File) {
    const token = ++fileToken.current;
    setBusy(true);
    setError("");
    try {
      const p = await readPhoto(file);
      if (fileToken.current === token) resetImage(p);
    } catch (e) {
      if (fileToken.current === token) setError((e as Error).message);
    } finally {
      if (fileToken.current === token) setBusy(false);
    }
  }
  function demo(kind: "ph" | "color") {
    fileToken.current++;
    setBusy(false);
    resetImage(demoPhoto(kind));
    setPage(kind);
    if (kind === "ph") {
      setRoi({ x: 440, y: 365, w: 120, h: 115 });
      setSelectedId("demo-v1");
    } else setRoi({ x: 620, y: 220, w: 75, h: 75 });
  }
  const rawStats = useMemo(
    () => (photo && roi ? statistics(photo.pixels, roi) : null),
    [photo, roi],
  );
  const refStats = useMemo(
    () => (photo && refRegion ? statistics(photo.pixels, refRegion) : null),
    [photo, refRegion],
  );
  const calibration = useMemo(
    () => (refStats ? calibrate(refStats) : null),
    [refStats],
  );
  const gains = correction ? (calibration?.gains ?? null) : null;
  const pixels = useMemo(
    () =>
      photo ? (gains ? corrected(photo.pixels, gains) : photo.pixels) : null,
    [photo, gains],
  );
  const stats = useMemo(
    () => (pixels && roi ? statistics(pixels, roi) : null),
    [pixels, roi],
  );
  const wholeStats = useMemo(
    () => (photo ? statistics(photo.pixels) : null),
    [photo],
  );
  const paletteColors = useMemo(
    () => (pixels ? palette(pixels, paletteCount) : []),
    [pixels, paletteCount],
  );
  const profile =
    selectedId === "demo-v1"
      ? demoProfile
      : (profiles.find((p) => p.id === selectedId) ?? null);
  const result = useMemo(
    () =>
      stats && profile
        ? matchPH(stats.robust, profile, interpolate, gains ?? undefined)
        : null,
    [stats, profile, interpolate, gains],
  );
  const qc = useMemo(
    () =>
      stats
        ? [
            ...quality(stats, true),
            ...(rawStats && gains
              ? quality(rawStats, true).filter(
                  (x) => !quality(stats, true).includes(x),
                )
              : []),
          ]
        : [],
    [stats, rawStats, gains],
  );
  const labValue = stats ? lab(stats.robust) : null,
    cyl = stats ? cylindrical(stats.robust) : null;
  const validMeter =
    referencePH.trim() !== "" &&
    Number.isFinite(+referencePH) &&
    +referencePH >= 0 &&
    +referencePH <= 14;
  const validPairs = history
    .filter(
      (r) =>
        r.imageKind === "photo" &&
        !r.profile?.synthetic &&
        r.estimate !== null &&
        r.referencePH !== null &&
        Number.isFinite(r.estimate) &&
        Number.isFinite(r.referencePH),
    )
    .map((r) => ({ estimate: r.estimate!, reference: r.referencePH! }));
  const metrics = validationMetrics(validPairs);
  async function copy(s: string) {
    try {
      await navigator.clipboard.writeText(s);
      setNotice("Copied " + s);
    } catch {
      setNotice(
        "Clipboard access is unavailable. Select and copy the text manually.",
      );
    }
  }
  function saveProfile(p: Profile) {
    const next = [...profiles.filter((x) => x.id !== p.id), p];
    try {
      localStorage.setItem("ps.profiles", JSON.stringify(next));
      setProfiles(next);
      setSelectedId(p.id);
      setEditor(false);
      setNotice("Reference profile saved on this device");
    } catch {
      setError(
        "Local storage is unavailable. Export the profile as JSON to keep a copy.",
      );
      download("pocketsense-profile.json", JSON.stringify(p, null, 2));
    }
  }
  async function importProfile(file: File) {
    try {
      if (file.size > 100000)
        throw new Error("The reference profile file is too large.");
      saveProfile(validateProfile(JSON.parse(await file.text())));
    } catch (e) {
      setError("Import failed: " + (e as Error).message);
    }
  }
  function currentRecord(): Measurement | null {
    if (!photo || !stats || !rawStats || !roi) return null;
    return measurement({
      name: sampleName.trim() || photo.name,
      demo: photo.demo,
      rgb: stats.robust,
      raw: rawStats.robust,
      roi,
      size: [photo.pixels.width, photo.pixels.height],
      match: page === "ph" ? result : null,
      profile: page === "ph" ? profile : null,
      gains,
      referenceRegion: refRegion,
      referencePH: page === "ph" && validMeter ? +referencePH : null,
      qc: [
        ...qc,
        ...(page === "ph"
          ? (result?.warnings ?? ["No pH profile selected; color data only."])
          : []),
      ],
    });
  }
  function exportCurrent(format: "json" | "csv") {
    const record = currentRecord();
    if (record)
      download(
        `pocketsense-${Date.now()}.${format}`,
        format === "json" ? JSON.stringify(record, null, 2) : csv([record]),
        format === "json" ? "application/json" : "text/csv;charset=utf-8",
      );
  }
  function saveMeasurement() {
    const record = currentRecord();
    if (!record) return;
    const next = [record, ...history].slice(0, 500);
    setHistory(next);
    if (persist) {
      try {
        localStorage.setItem("ps.history", JSON.stringify(next));
      } catch {
        setError(
          "Local storage is full or unavailable. Records remain in this session only; please export them.",
        );
      }
    }
    setNotice(
      "Measurement added" +
        (persist ? " and saved on this device" : " · This session only"),
    );
  }
  function togglePersist(checked: boolean) {
    setPersist(checked);
    try {
      localStorage.setItem("ps.persist", JSON.stringify(checked));
      if (checked) localStorage.setItem("ps.history", JSON.stringify(history));
      else localStorage.removeItem("ps.history");
    } catch {
      setPersist(false);
      setError("Persistent storage is unavailable. Please export your data.");
    }
  }
  const colorReadout = (
    <>
      <div
        className="color-readout"
        style={{ background: stats ? hex(stats.robust) : "#e3e7dc" }}
      >
        <span>REPRESENTATIVE COLOR</span>
        <strong>{stats ? hex(stats.robust) : "—"}</strong>
        {stats && (
          <button aria-label="Copy HEX" onClick={() => copy(hex(stats.robust))}>
            <Copy size={17} />
          </button>
        )}
      </div>
      <div className="color-values">
        <button
          onClick={() =>
            stats && copy(`rgb(${stats.robust.map(Math.round).join(", ")})`)
          }
          disabled={!stats}
        >
          <span>
            RGB <Copy size={12} />
          </span>
          <b>{stats ? stats.robust.map(Math.round).join(" / ") : "—"}</b>
        </button>
        <div>
          <span>CIELAB · D65</span>
          <b>{labValue?.map((v) => v.toFixed(1)).join(" / ") ?? "—"}</b>
        </div>
        <div>
          <span>HSL</span>
          <b>
            {cyl
              ? `${cyl.hsl[0].toFixed(0)}° / ${cyl.hsl[1].toFixed(0)}% / ${cyl.hsl[2].toFixed(0)}%`
              : "—"}
          </b>
        </div>
        <div>
          <span>HSV</span>
          <b>
            {cyl
              ? `${cyl.hsv[0].toFixed(0)}° / ${cyl.hsv[1].toFixed(0)}% / ${cyl.hsv[2].toFixed(0)}%`
              : "—"}
          </b>
        </div>
      </div>
    </>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => go("home")}>
          <span className="brand-mark">
            <Aperture size={25} />
          </span>
          <span>
            PocketSense<small>YOUR EVERYDAY LAB</small>
          </span>
        </button>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => go(n.id as Page)}
            >
              <n.icon size={20} />
              <span>
                {n.label}
                <small>{n.en}</small>
              </span>
              {page === n.id && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <ShieldCheck size={22} />
            <strong>Your data stays yours.</strong>
            <p>
              Your photos stay private.
              <br />
              All analysis runs on your device.
            </p>
            <span>
              <i className="live-dot" /> LOCAL-FIRST ENGINE
            </span>
          </div>
          <button
            className={
              page === "about" ? "about-button active" : "about-button"
            }
            onClick={() => go("about")}
          >
            <Info size={17} /> About & privacy <ArrowUpRight size={15} />
          </button>
          <div className="version">
            POCKETSENSE <span>v1.1 / EXPERIMENTAL</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            WORKSPACE <span>/</span>{" "}
            {nav.find((n) => n.id === page)?.en ?? "About & Privacy"}
          </span>
          <div className="status-row">
            <span className={"status-pill " + (offlineReady ? "ready" : "")}>
              {online ? <ShieldCheck size={14} /> : <WifiOff size={14} />}
              <span>
                {!online
                  ? "Working offline"
                  : offlineReady
                    ? "Offline ready"
                    : cacheError
                      ? "Offline cache unavailable"
                      : "On-device processing"}
              </span>
            </span>
            <button className="help-button" onClick={() => go("about")}>
              User guide <Info size={16} />
            </button>
          </div>
        </header>
        <main>
          {page === "home" && <Home go={go} demo={demo} />}
          {["ph", "color", "light"].includes(page) && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    POCKETSENSE /{" "}
                    {page === "ph"
                      ? "COLORIMETRIC SENSING"
                      : page === "color"
                        ? "COLOR DISCOVERY"
                        : "LIGHTING & CALIBRATION"}
                  </span>
                  <h1>
                    {page === "ph"
                      ? "pH Sense"
                      : page === "color"
                        ? "Color Sense"
                        : "Light Sense"}
                    <span>
                      {page === "ph"
                        ? "Read the color. Explore the chemistry."
                        : page === "color"
                          ? "Find the numbers behind every color."
                          : "Give your colors a neutral reference."}
                    </span>
                  </h1>
                  <p>
                    {page === "ph"
                      ? "Sample a photo. Match your reference chart. Validate the estimate with real measurements."
                      : page === "color"
                        ? "Tap a point or select a region to reveal color values and a palette worth keeping."
                        : "Inspect exposure and use a known neutral patch to help reduce color cast."}
                  </p>
                </div>
                <button
                  className="button secondary small"
                  onClick={() => {
                    demo(page === "color" ? "color" : "ph");
                    if (page === "light") setPage("light");
                  }}
                >
                  Load demo <ArrowRight size={15} />
                </button>
              </div>
              {photo?.demo && (
                <div className="demo-banner">
                  <FlaskConical size={17} />
                  <span>
                    Demo mode: synthetic images and references, processed by
                    real algorithms. These are not experimental validation
                    results.
                  </span>
                </div>
              )}
              <div className="workbench">
                <div className="workbench-main">
                  <ImageWorkspace
                    photo={photo}
                    pixels={pixels}
                    roi={roi}
                    reference={refRegion}
                    target={target}
                    onSelect={(r) =>
                      target === "reference" ? setRefRegion(r) : setRoi(r)
                    }
                    onFile={upload}
                    onDemo={() => {
                      demo(page === "color" ? "color" : "ph");
                      if (page === "light") setPage("light");
                    }}
                    onRemove={() => {
                      fileToken.current++;
                      setBusy(false);
                      resetImage(null);
                    }}
                    busy={busy}
                    corrected={!!gains}
                  />
                  {error && (
                    <div className="error" role="alert">
                      {error}
                      <button
                        aria-label="Dismiss error"
                        onClick={() => setError("")}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  )}
                  {photo && (
                    <div className="calibration-strip">
                      <span>
                        <SlidersHorizontal size={17} />
                        {gains
                          ? "Neutral-reference correction is on"
                          : "Using original colors"}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => go("light")}
                      >
                        {gains ? "View correction" : "Set up correction"}{" "}
                        <ArrowUpRight size={15} />
                      </button>
                    </div>
                  )}
                  {page === "ph" && (
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">
                            02 / REFERENCE PROFILE
                          </span>
                          <h3>Choose a chart for your test strip</h3>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => {
                            setEditing(null);
                            setEditor(!editor);
                          }}
                        >
                          <Plus size={16} />
                          New profile
                        </button>
                      </div>
                      <div className="panel-body">
                        <label className="sr-only" htmlFor="profile">
                          Reference profile
                        </label>
                        <select
                          id="profile"
                          value={selectedId}
                          onChange={(e) => setSelectedId(e.target.value)}
                        >
                          <option value="">
                            Select a profile for your strip brand / batch
                          </option>
                          <option value="demo-v1">
                            Synthetic demo chart · Not for real measurements
                          </option>
                          {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        {profile ? (
                          <>
                            <div className="reference-swatches">
                              {profile.patches.map((p) => (
                                <div key={p.ph}>
                                  <i style={{ background: p.hex }} />
                                  <span>{p.ph}</span>
                                </div>
                              ))}
                            </div>
                            <p className="muted small-text">
                              {profile.basis === "same-image"
                                ? "Same-photo reference: correction applies to both the sample and chart. Confirm that these patches come from the current photo."
                                : "Known RGB reference: correction applies only to the sample. Reference colors must match your strip and reading conditions."}
                            </p>
                            <div className="actions">
                              <button
                                className="text-button"
                                onClick={() => {
                                  setEditing(profile);
                                  setEditor(true);
                                }}
                              >
                                Edit profile
                              </button>
                              <button
                                className="text-button"
                                onClick={() =>
                                  download(
                                    "pocketsense-profile.json",
                                    JSON.stringify(profile, null, 2),
                                  )
                                }
                              >
                                <Download size={14} />
                                Export profile
                              </button>
                              {!profile.synthetic && (
                                <button
                                  className="text-button"
                                  onClick={() => {
                                    const next = profiles.filter(
                                      (p) => p.id !== profile.id,
                                    );
                                    try {
                                      localStorage.setItem(
                                        "ps.profiles",
                                        JSON.stringify(next),
                                      );
                                      setProfiles(next);
                                      setSelectedId("");
                                    } catch {
                                      setError(
                                        "Could not update local storage.",
                                      );
                                    }
                                  }}
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </>
                        ) : (
                          <p className="muted small-text">
                            Different strips use different dye systems. Create
                            or import a matching reference profile before
                            estimating pH.
                          </p>
                        )}
                        <label className="text-button import-link">
                          <Upload size={14} />
                          Import profile JSON
                          <input
                            type="file"
                            accept="application/json,.json"
                            hidden
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void importProfile(f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={interpolate}
                            onChange={(e) => setInterpolate(e.target.checked)}
                          />
                          Interpolate between adjacent references (experimental)
                        </label>
                      </div>
                    </section>
                  )}
                  {editor && page === "ph" && (
                    <ProfileEditor
                      key={editing?.id ?? "new"}
                      initial={editing}
                      sample={rawStats?.robust ?? null}
                      onClose={() => setEditor(false)}
                      onSave={saveProfile}
                    />
                  )}
                  {page === "color" && (
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">02 / IMAGE PALETTE</span>
                          <h3>A palette to take with you</h3>
                        </div>
                        <div className="segmented">
                          {[5, 8].map((n) => (
                            <button
                              key={n}
                              className={paletteCount === n ? "active" : ""}
                              onClick={() => setPaletteCount(n)}
                            >
                              {n} colors
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="panel-body">
                        {paletteColors.length ? (
                          <>
                            <div className="palette-grid">
                              {paletteColors.map((p, i) => (
                                <button
                                  key={i}
                                  onClick={() => copy(hex(p.rgb))}
                                  title={"RGB " + p.rgb.join(", ")}
                                >
                                  <i style={{ background: hex(p.rgb) }} />
                                  <strong>{hex(p.rgb)}</strong>
                                  <span>
                                    {(p.share * 100).toFixed(1)}% · RGB{" "}
                                    {p.rgb.join(" / ")}
                                  </span>
                                </button>
                              ))}
                            </div>
                            <div className="actions">
                              <button
                                className="text-button"
                                onClick={() =>
                                  download(
                                    "pocketsense-palette.json",
                                    JSON.stringify(
                                      {
                                        space: "sRGB",
                                        algorithm: "Lab k-means",
                                        synthetic: photo?.demo,
                                        colors: paletteColors.map((p) => ({
                                          ...p,
                                          hex: hex(p.rgb),
                                        })),
                                      },
                                      null,
                                      2,
                                    ),
                                  )
                                }
                              >
                                <Download size={14} />
                                JSON
                              </button>
                              <button
                                className="text-button"
                                onClick={() =>
                                  download(
                                    "pocketsense-palette.csv",
                                    csv(
                                      paletteColors.map((p) => ({
                                        hex: hex(p.rgb),
                                        red: p.rgb[0],
                                        green: p.rgb[1],
                                        blue: p.rgb[2],
                                        share: p.share,
                                      })),
                                    ),
                                    "text/csv;charset=utf-8",
                                  )
                                }
                              >
                                <Download size={14} />
                                CSV
                              </button>
                            </div>
                            <small className="muted">
                              Lab clustering across the full image. Tap a swatch
                              to copy HEX. Transparent pixels are excluded.
                            </small>
                          </>
                        ) : (
                          <p className="empty-small">
                            Load a photo to extract its representative colors.
                          </p>
                        )}
                      </div>
                    </section>
                  )}
                  {page === "light" && (
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">
                            02 / NEUTRAL REFERENCE
                          </span>
                          <h3>Balance color with a neutral reference</h3>
                        </div>
                        <Sun size={21} />
                      </div>
                      <div className="panel-body">
                        <p className="muted">
                          Select a known neutral gray or white patch in the
                          photo. Ordinary paper can contain optical brighteners
                          and is not a certified reference.
                        </p>
                        <div className="actions">
                          <button
                            className={
                              "button " +
                              (target === "reference" ? "primary" : "secondary")
                            }
                            disabled={!photo}
                            onClick={() =>
                              setTarget(
                                target === "reference" ? "sample" : "reference",
                              )
                            }
                          >
                            {target === "reference"
                              ? "Finish reference selection"
                              : "Select neutral reference"}
                          </button>
                          <button
                            className="text-button"
                            disabled={!refRegion}
                            onClick={() => {
                              setRefRegion(null);
                              setCorrection(false);
                              setTarget("sample");
                            }}
                          >
                            <RotateCcw size={14} />
                            Reset
                          </button>
                        </div>
                        {calibration && (
                          <p
                            className={
                              calibration.gains
                                ? "success-text"
                                : "warning-text"
                            }
                          >
                            {calibration.reason}
                          </p>
                        )}
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={correction && !!calibration?.gains}
                            disabled={!calibration?.gains}
                            onChange={(e) => setCorrection(e.target.checked)}
                          />
                          Apply reference correction to the image and all
                          sensing modules
                        </label>
                        {rawStats && stats && (
                          <div className="comparison">
                            <div>
                              <i style={{ background: hex(rawStats.robust) }} />
                              <span>Original sample</span>
                              <b>
                                {rawStats.robust.map(Math.round).join(" / ")}
                              </b>
                            </div>
                            <ArrowRight size={20} />
                            <div>
                              <i style={{ background: hex(stats.robust) }} />
                              <span>
                                {gains
                                  ? "Corrected sample"
                                  : "Correction is off"}
                              </span>
                              <b>{stats.robust.map(Math.round).join(" / ")}</b>
                            </div>
                          </div>
                        )}
                        {calibration?.gains && (
                          <small className="muted">
                            Linear RGB gains:{" "}
                            {calibration.gains
                              .map((g) => g.toFixed(3))
                              .join(" / ")}
                            . This is not absolute colorimetric calibration.
                          </small>
                        )}
                      </div>
                    </section>
                  )}
                  {photo && stats && (
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">DATA / EXPORT</span>
                          <h3>Keep this discovery</h3>
                        </div>
                        <Download size={18} />
                      </div>
                      <div className="panel-body">
                        <label>
                          Sample name
                          <input
                            value={sampleName}
                            placeholder={photo.name}
                            maxLength={120}
                            onChange={(e) => setSampleName(e.target.value)}
                          />
                        </label>
                        <div className="actions export-actions">
                          <button
                            className="button primary"
                            onClick={saveMeasurement}
                          >
                            <Plus size={16} />
                            Add record
                          </button>
                          <button
                            className="button secondary"
                            onClick={() => exportCurrent("json")}
                          >
                            JSON
                          </button>
                          <button
                            className="button secondary"
                            onClick={() => exportCurrent("csv")}
                          >
                            CSV
                          </button>
                        </div>
                        <small className="muted">
                          Export colors, selection, reference profile,
                          correction settings and quality flags. Photos are not
                          stored with records.
                        </small>
                      </div>
                    </section>
                  )}
                </div>
                <aside className="results-column">
                  <section className="panel results-panel">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow">LIVE READOUT</span>
                        <h3>
                          {page === "ph"
                            ? "Your reading"
                            : page === "color"
                              ? "Selected color"
                              : "Lighting overview"}
                        </h3>
                      </div>
                      <span className="live-dot" />
                    </div>
                    {page === "ph" ? (
                      <>
                        <div className="ph-result">
                          <span>
                            {profile?.synthetic ? "Synthetic demo · " : ""}
                            {result?.method === "interpolated"
                              ? "Local interpolation estimate"
                              : "Nearest reference category"}
                          </span>
                          <div>
                            <strong data-testid="ph-value">
                              {result?.estimate != null
                                ? result.method === "interpolated"
                                  ? result.estimate.toFixed(1)
                                  : String(result.estimate)
                                : "—"}
                            </strong>
                            <b>pH</b>
                          </div>
                          <p>
                            {!photo
                              ? "Load a photo to start sensing"
                              : !profile
                                ? "A matching reference profile is required"
                                : !stats
                                  ? "Select a region with opaque pixels"
                                  : result?.estimate === null
                                    ? "Color mismatch is too large for an estimate"
                                    : `Reference label span ${result!.interval[0]}–${result!.interval[1]}`}
                          </p>
                          <small>
                            This label span is not a confidence interval or
                            validated error bound.
                          </small>
                        </div>
                        <div className="ph-spectrum">
                          {[
                            "#C57566",
                            "#D49A64",
                            "#C9B96C",
                            "#A8B781",
                            "#7CA796",
                            "#7189A0",
                            "#8E7FA1",
                          ].map((c) => (
                            <i style={{ background: c }} key={c} />
                          ))}
                        </div>
                        {result && stats && (
                          <div className="match-details">
                            <div className="comparison">
                              <div>
                                <i style={{ background: hex(stats.robust) }} />
                                <span>Sample</span>
                              </div>
                              <ArrowRight size={17} />
                              <div>
                                <i
                                  style={{
                                    background: hex(result.referenceRGB),
                                  }}
                                />
                                <span>Reference pH {result.nearest.ph}</span>
                              </div>
                            </div>
                            <div className="mini-stats">
                              <Stat
                                label="Color difference ΔE00"
                                value={result.delta.toFixed(2)}
                              />
                              <Stat
                                label="Reference points"
                                value={String(profile!.patches.length)}
                              />
                            </div>
                          </div>
                        )}
                        <div className="panel-body">{colorReadout}</div>
                      </>
                    ) : page === "color" ? (
                      <div className="panel-body">{colorReadout}</div>
                    ) : (
                      <div className="panel-body">
                        {wholeStats ? (
                          <>
                            <div className="light-score">
                              <Sun size={34} />
                              <strong>
                                {(wholeStats.brightness * 100).toFixed(1)}
                                <small>%</small>
                              </strong>
                              <span>
                                Mean relative luminance · Original image
                              </span>
                            </div>
                            <div
                              className="histogram"
                              aria-label="Original image linear relative luminance histogram"
                            >
                              {wholeStats.histogram.map((v, i) => (
                                <i
                                  key={i}
                                  style={{
                                    height: `${Math.max(1, (v / Math.max(...wholeStats.histogram)) * 100)}%`,
                                  }}
                                />
                              ))}
                            </div>
                            <div className="histogram-label">
                              <span>Dark</span>
                              <span>Bright</span>
                            </div>
                            <div className="mini-stats">
                              <Stat
                                label="Clipped highlights"
                                value={(wholeStats.highlights * 100).toFixed(1)}
                                suffix="%"
                              />
                              <Stat
                                label="Near-black pixels"
                                value={(wholeStats.dark * 100).toFixed(1)}
                                suffix="%"
                              />
                              <Stat
                                label="Any-channel clipping"
                                value={(wholeStats.channelClip * 100).toFixed(
                                  1,
                                )}
                                suffix="%"
                              />
                              <Stat
                                label="Luminance SD"
                                value={wholeStats.contrast.toFixed(3)}
                              />
                            </div>
                          </>
                        ) : (
                          <p className="empty-small">
                            Load a photo to see its luminance histogram and
                            exposure indicators.
                          </p>
                        )}
                        <div className="science-note">
                          Pixel values depend on exposure, white balance and
                          camera processing. These are relative luminance
                          measurements, not illuminance in lux.
                        </div>
                      </div>
                    )}
                  </section>
                  {stats && (
                    <section className="panel">
                      <div className="panel-heading">
                        <h3>Quality checks</h3>
                        <ShieldCheck size={18} />
                      </div>
                      <div className="panel-body">
                        <Notes
                          notes={
                            page === "light" && wholeStats
                              ? quality(wholeStats)
                              : qc
                          }
                        />
                        {page === "ph" && result && (
                          <Notes notes={result.warnings} />
                        )}
                        <div className="quality-footer">
                          <span>Sampled pixels</span>
                          <b>{stats.count.toLocaleString("en-US")} px</b>
                        </div>
                        <details className="statistics">
                          <summary>Region statistics and method</summary>
                          <p>
                            The representative color uses a 10% trimmed mean per
                            channel. Large regions use a regular grid of up to
                            about 40,000 pixels.
                          </p>
                          <dl>
                            <dt>Mean RGB</dt>
                            <dd>
                              {stats.mean.map((v) => v.toFixed(1)).join(" / ")}
                            </dd>
                            <dt>Median RGB</dt>
                            <dd>
                              {stats.median
                                .map((v) => v.toFixed(1))
                                .join(" / ")}
                            </dd>
                            <dt>RGB standard deviation</dt>
                            <dd>
                              {stats.std.map((v) => v.toFixed(1)).join(" / ")}
                            </dd>
                          </dl>
                        </details>
                      </div>
                    </section>
                  )}
                  {page === "ph" && (
                    <section className="panel">
                      <div className="panel-heading">
                        <h3>Compare with a pH meter</h3>
                        <FlaskConical size={18} />
                      </div>
                      <div className="panel-body">
                        <label>
                          Meter pH
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="14"
                            placeholder="Enter the meter reading for this sample"
                            value={referencePH}
                            onChange={(e) => setReferencePH(e.target.value)}
                          />
                        </label>
                        {referencePH && !validMeter && (
                          <p className="error">
                            Enter a valid number between 0 and 14.
                          </p>
                        )}
                        {result?.estimate != null && validMeter && (
                          <div className="mini-stats">
                            <Stat
                              label="Estimate − meter"
                              value={(result.estimate - +referencePH).toFixed(
                                2,
                              )}
                            />
                            <Stat
                              label="Absolute error"
                              value={Math.abs(
                                result.estimate - +referencePH,
                              ).toFixed(2)}
                            />
                          </div>
                        )}
                        <p className="muted small-text">
                          Save records to see MAE and RMSE in your notebook.
                          Synthetic demo data are excluded from validation
                          statistics.
                        </p>
                      </div>
                    </section>
                  )}
                  <div className="research-note">
                    <FlaskConical size={18} />
                    <p>
                      Experimental color analysis. Validate your strip, sampling
                      method and read time. Not for medical diagnosis.
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}
          {page === "history" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">YOUR EXPERIMENT NOTEBOOK</span>
                  <h1>Notebook</h1>
                  <p>Build better evidence, one real measurement at a time.</p>
                </div>
                <button
                  className="button secondary"
                  disabled={!history.length}
                  onClick={() =>
                    download(
                      "pocketsense-history.json",
                      JSON.stringify(history, null, 2),
                    )
                  }
                >
                  <Download size={16} />
                  JSON
                </button>
                <button
                  className="button secondary"
                  disabled={!history.length}
                  onClick={() =>
                    download(
                      "pocketsense-history.csv",
                      csv(history),
                      "text/csv;charset=utf-8",
                    )
                  }
                >
                  CSV
                </button>
              </div>
              <div className="panel panel-body">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={persist}
                    onChange={(e) => togglePersist(e.target.checked)}
                  />
                  Keep records on this device (up to 500; no photos)
                </label>
                <p className="muted">
                  {persist
                    ? "Records stay in this browser. Clearing site data will remove them, so export regularly."
                    : "Records are kept for this session only and will be lost on refresh or close."}
                </p>
              </div>
              {metrics ? (
                <section className="validation-section">
                  <div className="metric-grid">
                    <Stat label="Validation pairs" value={String(metrics.n)} />
                    <Stat
                      label="Mean absolute error · MAE"
                      value={metrics.mae.toFixed(3)}
                    />
                    <Stat
                      label="Mean signed error · Bias"
                      value={metrics.bias.toFixed(3)}
                    />
                    <Stat
                      label="Root mean square error · RMSE"
                      value={metrics.rmse.toFixed(3)}
                    />
                  </div>
                  <div className="panel scatter-panel">
                    <h3>Meter vs. estimate</h3>
                    <svg
                      viewBox="0 0 460 290"
                      aria-label="pH meter versus PocketSense scatter plot"
                    >
                      <path d="M55 20V240H430" fill="none" stroke="#a2ada2" />
                      <path
                        d="M55 240L430 20"
                        stroke="#bec5b9"
                        strokeDasharray="5 5"
                      />
                      <text x="180" y="280">
                        pH meter reading
                      </text>
                      <text x="16" y="185" transform="rotate(-90 16 185)">
                        PocketSense estimate
                      </text>
                      {[0, 2, 4, 6, 8, 10, 12, 14].map((n) => (
                        <g key={n}>
                          <text
                            x={55 + (n / 14) * 375}
                            y="257"
                            textAnchor="middle"
                          >
                            {n}
                          </text>
                          <text
                            x="43"
                            y={245 - (n / 14) * 220}
                            textAnchor="end"
                          >
                            {n}
                          </text>
                        </g>
                      ))}
                      {validPairs.map((p, i) => (
                        <circle
                          key={i}
                          cx={55 + (p.reference / 14) * 375}
                          cy={240 - (p.estimate / 14) * 220}
                          r="5"
                          fill="#607c59"
                          opacity=".75"
                        >
                          <title>
                            {p.reference} → {p.estimate}
                          </title>
                        </circle>
                      ))}
                    </svg>
                    <small className="muted">
                      Includes uploaded photos with non-demo profiles and
                      entered meter readings. Duplicate records affect these
                      metrics.
                    </small>
                  </div>
                </section>
              ) : (
                <div className="empty-state">
                  <FlaskConical size={30} />
                  <h3>Your first validation pair starts here</h3>
                  <p>
                    Use a real photo and your own chart, enter a pH meter
                    reading, then save the record.
                    <br />
                    No experimental validation data are fabricated here.
                  </p>
                  <button className="text-button" onClick={() => go("ph")}>
                    Start pH sensing <ArrowRight size={16} />
                  </button>
                </div>
              )}
              {history.length > 0 && (
                <div className="panel history-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Sample / time</th>
                        <th>Color</th>
                        <th>pH estimate</th>
                        <th>Meter</th>
                        <th>Source</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <b>{r.sampleName}</b>
                            <small>
                              {new Date(r.timestamp).toLocaleString("en-US")}
                            </small>
                          </td>
                          <td>
                            <span
                              className="inline-swatch"
                              style={{ background: r.hex }}
                            />
                            {r.hex}
                          </td>
                          <td>{r.estimate ?? "—"}</td>
                          <td>{r.referencePH ?? "—"}</td>
                          <td>
                            {r.imageKind === "synthetic" || r.profile?.synthetic
                              ? "Synthetic demo"
                              : "Uploaded photo"}
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              aria-label={"Delete record " + r.sampleName}
                              onClick={() => {
                                const next = history.filter(
                                  (x) => x.id !== r.id,
                                );
                                setHistory(next);
                                if (persist)
                                  try {
                                    localStorage.setItem(
                                      "ps.history",
                                      JSON.stringify(next),
                                    );
                                  } catch {
                                    setError("Could not update local storage.");
                                  }
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {page === "about" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    BUILT FOR CURIOSITY. GROUNDED IN SCIENCE.
                  </span>
                  <h1>Small pocket. Big possibilities.</h1>
                  <p>
                    How to use PocketSense, how it works, and where its
                    scientific limits lie.
                  </p>
                </div>
              </div>
              <div className="about-grid">
                <section className="panel panel-body">
                  <ShieldCheck size={28} />
                  <h2>Your photos stay on your device.</h2>
                  <p>
                    Your photographs are processed locally on your device.
                    PocketSense does not upload images for analysis.
                  </p>
                  <p>
                    No account, analysis API, tracking scripts or remote fonts.
                    The app downloads on your first visit; decoding, color
                    statistics and matching all run in your browser.
                  </p>
                  <h3>Use it offline</h3>
                  <ol>
                    <li>
                      Open the site online and wait for the Offline ready badge
                      in the top-right corner.
                    </li>
                    <li>
                      Install from your browser menu, or choose Add to Home
                      Screen from the Safari share menu. Open the installed app
                      once while online.
                    </li>
                    <li>
                      Switch to airplane mode, reopen the app, and capture or
                      import a photo to continue.
                    </li>
                  </ol>
                  <p className="muted">
                    Browser cleanup, private browsing or low storage can remove
                    the offline cache. Installation requires HTTPS or localhost.
                  </p>
                  {install && (
                    <button
                      className="button primary"
                      onClick={() => {
                        void install.prompt();
                        setInstall(null);
                      }}
                    >
                      Install PocketSense <Download size={17} />
                    </button>
                  )}
                  <p className="status-line">
                    Cache status:{" "}
                    {offlineReady
                      ? "Ready"
                      : cacheError
                        ? "Cache failed. Check browser permissions and available storage."
                        : "Not yet confirmed"}
                  </p>
                </section>
                <section className="panel panel-body">
                  <FlaskConical size={28} />
                  <h2>Make your measurements comparable.</h2>
                  <ol>
                    <li>
                      Use the same strip brand and batch. Follow the
                      manufacturer instructions and specified read time.
                    </li>
                    <li>
                      Place the strip, chart and neutral reference in the same
                      plane under uniform lighting.
                    </li>
                    <li>
                      Avoid fingers, swabs, shadows, glare and automatic beauty
                      filters in the sample region.
                    </li>
                    <li>
                      Select the uniform center of the colored pad, choose its
                      chart, and review quality flags.
                    </li>
                    <li>
                      Repeat measurements against pH meter readings of the same
                      sample before reporting accuracy.
                    </li>
                  </ol>
                  <p>
                    Swab transfer depends on sample quantity, surface residues,
                    strip wetting and buffering capacity. Validate your
                    swab-to-strip workflow directly; color similarity alone does
                    not establish accuracy.
                  </p>
                  <p className="science-note">
                    This release supports one colored pad. Multi-pad strips,
                    automatic strip detection, cross-object normalized plot
                    estimation and multi-reference matrix calibration remain
                    future work.
                  </p>
                </section>
                <section className="panel panel-body">
                  <Palette size={28} />
                  <h2>An explainable color engine</h2>
                  <p>
                    Photos are decoded to sRGB and proportionally resized to a
                    maximum 1600-pixel long edge. Regions use a 10% trimmed
                    mean, with mean, median and standard deviation also shown.
                    Transparent pixels are excluded.
                  </p>
                  <p>
                    Inverse sRGB gamma yields linear RGB, then XYZ and D65
                    CIELAB. pH matching uses CIEDE2000 ΔE00; charts for
                    different strip brands are not interchangeable. Palettes use
                    deterministic k-means in Lab space.
                  </p>
                  <p>
                    Optional interpolation searches a local Lab segment between
                    adjacent references no more than 2 pH apart, with a residual
                    limit and no extrapolation. Color-difference and quality
                    thresholds are engineering heuristics that need experimental
                    calibration.
                  </p>
                  <p>
                    <a
                      href="https://www.w3.org/Graphics/Color/sRGB"
                      target="_blank"
                      rel="noreferrer"
                    >
                      sRGB specification ↗
                    </a>{" "}
                    ·{" "}
                    <a
                      href="https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      CIEDE2000 and test data ↗
                    </a>
                  </p>
                </section>
                <section className="panel panel-body">
                  <Sun size={28} />
                  <h2>Understand what correction can do.</h2>
                  <p>
                    For neutral-reference linear RGB cᵢ, the target m is the
                    mean of its three channels. Gains gᵢ = m / cᵢ are applied in
                    linear space before re-encoding to sRGB. Poor references or
                    gains outside 0.5–2 are rejected.
                  </p>
                  <p>
                    This does not infer lux, restore clipped highlights, or
                    fully remove errors from camera processing, spectral
                    differences or mixed lighting. Luminance variation can also
                    come from different objects and is not proof of uneven
                    illumination.
                  </p>
                  <p>
                    White paper is not a certified calibration standard.
                    Displayed Lab values are not spectrophotometer measurements.
                    Scientific use requires known standards, controlled capture
                    conditions and independent validation.
                  </p>
                </section>
              </div>
              <section className="panel panel-body data-controls">
                <h3>On-device data</h3>
                <p className="muted">
                  Remove saved profiles, records and preferences, and release
                  the current photo. The offline app cache is retained.
                </p>
                {!clearConfirm ? (
                  <button
                    className="button secondary"
                    onClick={() => setClearConfirm(true)}
                  >
                    <Trash2 size={16} />
                    Clear PocketSense local data
                  </button>
                ) : (
                  <div className="actions">
                    <button
                      className="button danger"
                      onClick={() => {
                        try {
                          ["ps.history", "ps.profiles", "ps.persist"].forEach(
                            (k) => localStorage.removeItem(k),
                          );
                          setProfiles([]);
                          setHistory([]);
                          setPersist(false);
                          resetImage(null);
                          setClearConfirm(false);
                          setNotice("Local data cleared");
                        } catch {
                          setError(
                            "Storage cleanup was blocked. Clear this site data from your browser settings.",
                          );
                        }
                      }}
                    >
                      Confirm clear
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => setClearConfirm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
          {error && !["ph", "color", "light"].includes(page) && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </main>
        <footer className="app-footer">
          <span>
            <Aperture size={14} /> PocketSense
          </span>
          <span>DEVICE-LOCAL · EXPERIMENTAL v1.1</span>
          <span>Stay curious.</span>
        </footer>
      </div>
      <nav className="mobile-nav">
        {nav.map((n) => (
          <button
            key={n.id}
            className={page === n.id ? "active" : ""}
            onClick={() => go(n.id as Page)}
          >
            <n.icon size={20} />
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
    </div>
  );
}
