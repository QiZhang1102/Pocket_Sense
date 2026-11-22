import { useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  FlaskConical,
  MessageSquare,
  Palette,
  Telescope,
} from "lucide-react";
import "./feature-discovery.css";

type Feature = {
  id: "ph" | "color" | "calibration" | "wall" | "pads";
  title: string;
  description: string;
  caption: string;
  href?: string;
};

const features: Feature[] = [
  {
    id: "ph",
    title: "pH Sense",
    href: "#ph",
    description:
      "Sample a photographed test strip and compare its color with your own labeled reference chart. Save the chart on this device for your next measurement.",
    caption: "Test strip alongside a reference scale",
  },
  {
    id: "color",
    title: "Color Sense",
    href: "#color",
    description:
      "Pick a pixel or draw a region to read its RGB, HEX and CIELAB values. Extract a representative palette and export the colors from your device.",
    caption: "Selected tones from an example palette",
  },
  {
    id: "calibration",
    title: "Color Calibration",
    description:
      "Could a reference card in the frame make readings more consistent across phones and lighting? We would compare corrected colors against independently measured patches.",
    caption: "Known color patches and a neutral scale",
  },
  {
    id: "wall",
    title: "Wall Color Finder",
    description:
      "Build a shortlist of paint swatches from a wall photo. A reference card could narrow the choices, while real samples would show how gloss and room lighting affect the match.",
    caption: "A surface color and three candidate swatches",
  },
  {
    id: "pads",
    title: "Research Pad Reader",
    description:
      "Explore a research worksheet that samples several pads on one paper device. Each layout would need its own timing, blank controls and validation against a reference method.",
    caption: "One sample feeds three sensing regions",
  },
];

const scale = [
  "#b8563b",
  "#df985b",
  "#dbca76",
  "#9bb779",
  "#72a899",
  "#59898c",
  "#567194",
];
const tones = ["#365844", "#718972", "#b9c9a7", "#e3ce99", "#cc9e70"];
const patches = [
  "#845e49",
  "#caac89",
  "#778d9a",
  "#69805a",
  "#918ca6",
  "#85b1a4",
  "#dd9958",
  "#697fa3",
  "#b97068",
  "#786779",
  "#b2bc72",
  "#d6bb69",
  "#f0ece0",
  "#c2c1b3",
  "#9a9c91",
  "#70756d",
  "#50574f",
  "#343b36",
];

function FeatureFigure({ feature }: { feature: Feature }) {
  return (
    <figure className={`fd-figure fd-figure-${feature.id}`}>
      <div className="fd-specimen" aria-hidden="true">
        {feature.id === "ph" && (
          <div className="fd-ph-sample">
            <div className="fd-test-strip">
              <i />
            </div>
            <div className="fd-ref-card">
              {scale.map((color, i) => (
                <span key={color}>
                  <i style={{ background: color }} />
                  <small>{i * 2 + 1}</small>
                </span>
              ))}
            </div>
          </div>
        )}
        {feature.id === "color" && (
          <div className="fd-fan">
            {tones.map((color, index) => (
              <span
                key={color}
                style={{
                  transform: `rotate(${(index - 2) * 13}deg)`,
                  background: color,
                }}
              >
                <i /> <small>{color.toUpperCase()}</small>
              </span>
            ))}
          </div>
        )}
        {feature.id === "calibration" && (
          <div className="fd-chart">
            {patches.map((color) => (
              <i key={color} style={{ background: color }} />
            ))}
          </div>
        )}
        {feature.id === "wall" && (
          <div className="fd-wall-sample">
            <div className="fd-wall-chip">
              <span />
            </div>
            <div className="fd-wall-choices">
              {["#8b9a85", "#a1ad91", "#a5ad9d"].map((color) => (
                <i key={color} style={{ background: color }} />
              ))}
            </div>
          </div>
        )}
        {feature.id === "pads" && (
          <div className="fd-chip">
            <div className="fd-inlet" />
            <div className="fd-channel" />
            <div className="fd-pad-row">
              {["#c99763", "#89ae9f", "#98a3b1"].map((color) => (
                <i key={color} style={{ background: color }} />
              ))}
            </div>
          </div>
        )}
      </div>
      <figcaption>{feature.caption}</figcaption>
    </figure>
  );
}

export function FeatureDiscovery() {
  const viewport = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  function show(index: number) {
    const el = viewport.current;
    if (!el) return;
    const slide = Math.max(0, Math.min(features.length - 1, index));
    el.scrollTo({ left: slide * el.clientWidth, behavior: "auto" });
  }
  function handleKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    const destination: Record<string, number> = {
      ArrowLeft: active - 1,
      ArrowRight: active + 1,
      Home: 0,
      End: features.length - 1,
    };
    if (!(event.key in destination)) return;
    event.preventDefault();
    if (viewport.current?.contains(document.activeElement))
      viewport.current.focus({ preventScroll: true });
    show(destination[event.key]);
  }

  return (
    <section className="fd-page">
      <header className="fd-intro">
        <div>
          <h1>
            Discover PocketSense<span>.</span>
          </h1>
          <p>
            Try the color tools available today and explore the ideas taking
            shape for future research.
          </p>
        </div>
        <div
          className="fd-shortcuts"
          role="group"
          aria-label="Open an available tool"
        >
          <a href="#ph">
            <FlaskConical aria-hidden="true" size={16} /> pH Sense{" "}
            <ArrowUpRight aria-hidden="true" size={14} />
          </a>
          <a href="#color">
            <Palette aria-hidden="true" size={16} /> Color Sense{" "}
            <ArrowUpRight aria-hidden="true" size={14} />
          </a>
        </div>
      </header>

      <section
        className="fd-carousel"
        role="region"
        aria-roledescription="carousel"
        aria-label="Feature explorer"
        onKeyDown={handleKeys}
      >
        <div className="fd-controls">
          <div className="fd-position" aria-live="polite" aria-atomic="true">
            <strong>{String(active + 1).padStart(2, "0")}</strong>
            <span aria-hidden="true">/</span>
            {String(features.length).padStart(2, "0")}
            <span className="fd-sr">
              . {features[active].title},{" "}
              {features[active].href ? "available now" : "exploratory concept"}.
            </span>
          </div>
          <div className="fd-dots" role="group" aria-label="Choose a feature">
            {features.map((feature, index) => (
              <button
                type="button"
                key={feature.id}
                aria-label={`Show ${feature.title}`}
                aria-current={index === active ? "true" : undefined}
                onClick={() => show(index)}
              >
                <i />
              </button>
            ))}
          </div>
          <div className="fd-arrows">
            <button
              type="button"
              aria-label="Previous feature"
              aria-disabled={active === 0}
              onClick={() => show(active - 1)}
            >
              <ArrowLeft aria-hidden="true" size={18} />
            </button>
            <button
              type="button"
              aria-label="Next feature"
              aria-disabled={active === features.length - 1}
              onClick={() => show(active + 1)}
            >
              <ArrowRight aria-hidden="true" size={18} />
            </button>
          </div>
        </div>
        <div
          className="fd-viewport"
          ref={viewport}
          tabIndex={0}
          role="group"
          aria-label="Feature slides. Use left and right arrow keys to explore."
          onScroll={(event) => {
            const el = event.currentTarget;
            if (el.clientWidth)
              setActive(
                Math.max(
                  0,
                  Math.min(
                    features.length - 1,
                    Math.round(el.scrollLeft / el.clientWidth),
                  ),
                ),
              );
          }}
        >
          {features.map((feature, index) => (
            <article
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} of ${features.length}: ${feature.title}`}
              key={feature.id}
              inert={active !== index}
              className={`fd-slide ${feature.href ? "fd-available" : "fd-exploratory"}`}
            >
              <div className="fd-copy">
                <span className="fd-status">
                  {feature.href ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <Telescope size={15} aria-hidden="true" />
                  )}
                  {feature.href ? "Available now" : "Exploratory concept"}
                </span>
                <h2>{feature.title}</h2>
                <p>{feature.description}</p>
                {feature.href && (
                  <a className="button primary fd-open" href={feature.href}>
                    Open {feature.title}{" "}
                    <ArrowRight aria-hidden="true" size={17} />
                  </a>
                )}
              </div>
              <FeatureFigure feature={feature} />
            </article>
          ))}
        </div>
      </section>

      <aside className="fd-feedback">
        <div>
          <h2>What would you measure?</h2>
          <p>Tell us about your workflow or suggest a feature to explore.</p>
        </div>
        <a href="#feedback">
          <MessageSquare size={17} aria-hidden="true" /> Share your ideas{" "}
          <ArrowRight aria-hidden="true" size={16} />
        </a>
      </aside>
    </section>
  );
}
