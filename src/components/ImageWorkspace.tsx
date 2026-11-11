import { useEffect, useRef, useState } from "react";
import {
  Crosshair,
  Scan,
  Hand,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ImagePlus,
  Camera,
  Trash2,
  Upload,
} from "lucide-react";
import { type Pixels, type Rect, type Photo, bounds } from "../lib/image";
type Props = {
  photo: Photo | null;
  pixels: Pixels | null;
  roi: Rect | null;
  reference: Rect | null;
  target: "sample" | "reference";
  onSelect: (r: Rect) => void;
  onFile: (f: File) => void;
  onDemo: () => void;
  onRemove: () => void;
  busy: boolean;
  corrected: boolean;
};
export function ImageWorkspace(p: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    viewport = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"region" | "point" | "pan">("region"),
    [zoom, setZoom] = useState(1),
    [drag, setDrag] = useState(false);
  const activeRect = p.target === "reference" ? p.reference : p.roi;
  const start = useRef<{
    x: number;
    y: number;
    sx: number;
    sy: number;
    left: number;
    top: number;
  } | null>(null);
  useEffect(() => {
    setZoom(1);
  }, [p.photo]);
  useEffect(() => {
    if (!canvas.current || !p.pixels) return;
    const c = canvas.current;
    c.width = p.pixels.width;
    c.height = p.pixels.height;
    c.getContext("2d")!.putImageData(
      new ImageData(
        new Uint8ClampedArray(p.pixels.data),
        p.pixels.width,
        p.pixels.height,
      ),
      0,
      0,
    );
  }, [p.pixels]);
  function pos(e: React.PointerEvent) {
    const r = canvas.current!.getBoundingClientRect();
    return {
      x: Math.floor(((e.clientX - r.left) / r.width) * p.pixels!.width),
      y: Math.floor(((e.clientY - r.top) / r.height) * p.pixels!.height),
    };
  }
  function selection(e: React.PointerEvent) {
    if (!start.current || !p.pixels) return;
    const point = pos(e),
      s = start.current;
    if (mode === "pan") {
      viewport.current!.scrollLeft = s.left - (e.clientX - s.sx);
      viewport.current!.scrollTop = s.top - (e.clientY - s.sy);
      return;
    }
    p.onSelect(
      bounds(
        p.pixels,
        mode === "point"
          ? { x: point.x, y: point.y, w: 1, h: 1 }
          : {
              x: Math.min(s.x, point.x),
              y: Math.min(s.y, point.y),
              w: Math.abs(point.x - s.x) + 1,
              h: Math.abs(point.y - s.y) + 1,
            },
      ),
    );
  }
  const outline = (r: Rect | null, reference = false) =>
    r &&
    p.pixels && (
      <div
        className={"roi " + (reference ? "reference-roi" : "")}
        style={{
          left: `${(r.x / p.pixels.width) * 100}%`,
          top: `${(r.y / p.pixels.height) * 100}%`,
          width: `${(r.w / p.pixels.width) * 100}%`,
          height: `${(r.h / p.pixels.height) * 100}%`,
        }}
      >
        <span>{reference ? "NEUTRAL REF" : "SAMPLE"}</span>
        <i />
        <i />
        <i />
        <i />
      </div>
    );
  const input = (camera = false) => (
    <label className={"button " + (camera ? "secondary" : "primary")}>
      <span>{camera ? <Camera size={17} /> : <Upload size={17} />}</span>
      {camera ? "Take photo" : p.photo ? "Replace image" : "Choose photo"}
      <input
        aria-label={camera ? "Take photo" : "Upload photo"}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        capture={camera ? "environment" : undefined}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) p.onFile(f);
          e.target.value = "";
        }}
        hidden
        disabled={p.busy}
      />
    </label>
  );
  return (
    <section
      className={"image-panel panel " + (drag ? "drag-over" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) p.onFile(f);
      }}
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">01 / IMAGE INPUT</span>
          <h3>{p.photo ? p.photo.name : "Start with a photograph"}</h3>
        </div>
        {p.photo && (
          <button
            className="icon-button"
            aria-label="Remove image"
            onClick={p.onRemove}
          >
            <Trash2 size={17} />
          </button>
        )}
      </div>
      {!p.photo ? (
        <div className="dropzone">
          <div className="upload-symbol">
            <ImagePlus size={34} />
          </div>
          <h2>Turn color into data.</h2>
          <p>
            Drop a photo here or capture one on your phone.
            <br />
            Your photos stay on your device.
          </p>
          <div className="actions">
            {input()}
            {input(true)}
          </div>
          <small>JPG / PNG / WebP · Up to 30 MB</small>
          <button className="text-button" onClick={p.onDemo}>
            No photo yet? Try a synthetic demo →
          </button>
        </div>
      ) : (
        <>
          <div className="image-toolbar">
            <div className="segmented">
              {[
                { id: "region", label: "Region", icon: Scan },
                { id: "point", label: "Point", icon: Crosshair },
                { id: "pan", label: "Pan", icon: Hand },
              ].map((x) => (
                <button
                  key={x.id}
                  className={mode === x.id ? "active" : ""}
                  onClick={() => setMode(x.id as typeof mode)}
                >
                  <x.icon size={15} />
                  {x.label}
                </button>
              ))}
            </div>
            <div className="zoom-controls">
              <button
                aria-label="Zoom out"
                onClick={() => setZoom(Math.max(1, zoom - 0.5))}
              >
                <ZoomOut size={17} />
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                aria-label="Zoom in"
                onClick={() => setZoom(Math.min(4, zoom + 0.5))}
              >
                <ZoomIn size={17} />
              </button>
              <button aria-label="Reset zoom" onClick={() => setZoom(1)}>
                <RotateCcw size={15} />
              </button>
            </div>
          </div>
          <div className="target-banner">
            {p.target === "reference"
              ? "Selecting a neutral reference: drag over a known gray or white patch."
              : "Drag over a uniform sample region, or use Point mode for a single pixel."}
          </div>
          <div className="image-viewport" ref={viewport}>
            <div className="canvas-stage" style={{ width: `${zoom * 100}%` }}>
              <canvas
                ref={canvas}
                aria-label="Color sampling canvas"
                role="img"
                tabIndex={0}
                style={{ cursor: mode === "pan" ? "grab" : "crosshair" }}
                onKeyDown={(e) => {
                  if (
                    !activeRect ||
                    !p.pixels ||
                    ![
                      "ArrowUp",
                      "ArrowDown",
                      "ArrowLeft",
                      "ArrowRight",
                    ].includes(e.key)
                  )
                    return;
                  e.preventDefault();
                  const r = { ...activeRect },
                    n = e.shiftKey ? 10 : 1;
                  if (e.key === "ArrowUp") r.y -= n;
                  if (e.key === "ArrowDown") r.y += n;
                  if (e.key === "ArrowLeft") r.x -= n;
                  if (e.key === "ArrowRight") r.x += n;
                  p.onSelect(bounds(p.pixels, r));
                }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const point = pos(e);
                  start.current = {
                    ...point,
                    sx: e.clientX,
                    sy: e.clientY,
                    left: viewport.current!.scrollLeft,
                    top: viewport.current!.scrollTop,
                  };
                  selection(e);
                }}
                onPointerMove={(e) => {
                  if (start.current) selection(e);
                }}
                onPointerUp={(e) => {
                  selection(e);
                  start.current = null;
                }}
                onPointerCancel={() => {
                  start.current = null;
                }}
              />
              {outline(p.roi)}
              {outline(p.reference, true)}
              <div className="image-tag">
                {p.photo.demo ? "SYNTHETIC DEMO" : "LOCAL IMAGE"}
                {p.corrected ? " · CORRECTED" : ""}
              </div>
            </div>
          </div>
          <div className="image-footer">
            <span>
              {p.pixels!.width} × {p.pixels!.height} px · sRGB
              {p.photo.originalWidth > p.pixels!.width
                ? " · Resized proportionally"
                : ""}
            </span>
            <div>
              {input()}
              {input(true)}
            </div>
          </div>
          {activeRect && (
            <details className="region-editor">
              <summary>
                Fine-tune selection · {activeRect.w} × {activeRect.h} px
              </summary>
              <div className="coordinate-fields">
                {(["x", "y", "w", "h"] as const).map((key) => (
                  <label key={key}>
                    {{ x: "X", y: "Y", w: "Width", h: "Height" }[key]}
                    <input
                      type="number"
                      aria-label={"Region " + key}
                      value={activeRect[key]}
                      min={key === "w" || key === "h" ? 1 : 0}
                      onChange={(e) => {
                        if (
                          e.target.value !== "" &&
                          Number.isFinite(+e.target.value)
                        )
                          p.onSelect(
                            bounds(p.pixels!, {
                              ...activeRect,
                              [key]: +e.target.value,
                            }),
                          );
                      }}
                    />
                  </label>
                ))}
              </div>
              <small>
                Focus the canvas and use arrow keys to move. Shift + arrow moves
                10 pixels.
              </small>
            </details>
          )}
        </>
      )}
      {p.busy && (
        <div className="busy-overlay" role="status">
          Decoding the image on your device…
        </div>
      )}
    </section>
  );
}
