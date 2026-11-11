import {
  ArrowUpRight,
  ArrowRight,
  ShieldCheck,
  WifiOff,
  ScanLine,
  FlaskConical,
  Palette,
  Sun,
  Aperture,
} from "lucide-react";
export type Page = "home" | "ph" | "color" | "light" | "history" | "about";
export function Home({
  go,
  demo,
}: {
  go: (p: Page) => void;
  demo: (p: "ph" | "color") => void;
}) {
  return (
    <>
      <div className="home-kicker">
        <span className="live-dot" /> YOUR POCKET-SIZED LAB{" "}
        <span>NO. 001 / COLOR INTELLIGENCE</span>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <div className="pill">
            <Aperture size={14} /> See more with your everyday camera
          </div>
          <h1>
            Your camera.
            <br />
            Your color sensor.
            <br />
            <em>Your data.</em>
          </h1>
          <p>
            Turn a photograph into your pocket laboratory.
            <br />
            From test strips to sunsets, discover the data behind every shade.
          </p>
          <div className="actions">
            <button className="button primary" onClick={() => go("ph")}>
              Start sensing <ArrowUpRight size={18} />
            </button>
            <button className="button secondary" onClick={() => demo("ph")}>
              Try the demo <ArrowRight size={17} />
            </button>
          </div>
          <div className="hero-note">
            <ShieldCheck size={15} /> On-device analysis · No account · Offline
            capable
          </div>
        </div>
        <div
          className="hero-lab"
          aria-label="Synthetic pH analysis illustration"
        >
          <div className="lab-grid" />
          <div className="visual-caption">
            <span className="live-dot" /> LOCAL ANALYSIS
            <span>DEMO / SYNTHETIC</span>
          </div>
          <div className="reference-paper">
            <span>REFERENCE / pH</span>
            <div className="mini-chart">
              {[
                "#D98669",
                "#E5B76B",
                "#C9CB7C",
                "#94B889",
                "#70A79C",
                "#688FAD",
                "#827EAC",
              ].map((color, i) => (
                <div key={color}>
                  <i style={{ background: color }} />
                  <b>{i + 4}</b>
                </div>
              ))}
            </div>
          </div>
          <div className="strip-paper">
            <div className="sensitive-pad" />
            <span>PocketSense</span>
          </div>
          <div className="scan-frame">
            <i />
            <i />
            <i />
            <i />
            <span>REGION SELECTED</span>
          </div>
          <div className="floating-reading">
            <div>
              <span>REFERENCE MATCH</span>
              <b>
                7<span>pH</span>
              </b>
              <small>Synthetic chart · Not a real measurement</small>
            </div>
            <div className="reading-color" />
            <div className="reading-bottom">
              <span>RGB 148 · 184 · 137</span>
              <strong>#94B889</strong>
            </div>
          </div>
          <div className="visual-bottom">
            <span>CAPTURE → SAMPLE → DISCOVER</span>
            <ScanLine size={20} />
          </div>
        </div>
      </section>
      <div className="feature-strip">
        <span>
          <ShieldCheck />
          100% local processing
        </span>
        <span>
          <WifiOff />
          Offline capable
        </span>
        <span>
          <ScanLine />
          No extra electronics
        </span>
        <span>
          <FlaskConical />
          Traceable color data
        </span>
      </div>
      <section className="tools-section">
        <div className="section-title">
          <div>
            <span className="eyebrow">ONE CAMERA. THREE PERSPECTIVES.</span>
            <h2>Choose your perspective</h2>
          </div>
          <span className="muted">From the lab to everyday life.</span>
        </div>
        <div className="tool-cards">
          <button className="tool-card ph-card" onClick={() => go("ph")}>
            <div className="tool-top">
              <span className="module-icon">
                <FlaskConical />
              </span>
              <span>
                01 <ArrowUpRight size={18} />
              </span>
            </div>
            <h3>pH Sense</h3>
            <h4>Read the chemistry in color</h4>
            <p>
              Select a colored pad and match your own chart. Record estimates
              and validate them against a pH meter.
            </p>
            <div className="card-foot">
              COLORIMETRIC SENSING <ArrowRight size={18} />
            </div>
          </button>
          <button className="tool-card color-card" onClick={() => go("color")}>
            <div className="tool-top">
              <span className="module-icon">
                <Palette />
              </span>
              <span>
                02 <ArrowUpRight size={18} />
              </span>
            </div>
            <h3>Color Sense</h3>
            <h4>Keep the colors that inspire you</h4>
            <p>
              A research figure, your favorite drink, a sunset. Extract RGB, HEX
              and palettes to copy or export.
            </p>
            <div className="card-foot">
              EVERYDAY COLOR DISCOVERY <ArrowRight size={18} />
            </div>
          </button>
          <button className="tool-card light-card" onClick={() => go("light")}>
            <div className="tool-top">
              <span className="module-icon">
                <Sun />
              </span>
              <span>
                03 <ArrowUpRight size={18} />
              </span>
            </div>
            <h3>Light Sense</h3>
            <h4>See the influence of light</h4>
            <p>
              Inspect exposure, glare and color variation. Use a neutral
              reference to help correct color cast.
            </p>
            <div className="card-foot">
              REFERENCE-ASSISTED CORRECTION <ArrowRight size={18} />
            </div>
          </button>
        </div>
      </section>
      <div className="home-footer">
        <span>PocketSense / Small tool. More possibilities.</span>
        <button onClick={() => go("about")}>
          Explore the science and limits <ArrowUpRight size={15} />
        </button>
      </div>
    </>
  );
}
