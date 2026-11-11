import { useState } from "react";
import { Plus, Trash2, X, Crosshair } from "lucide-react";
import { type Profile, type Patch, validateProfile } from "../lib/ph";
import { type RGB, hex } from "../lib/color";
export function ProfileEditor({
  initial,
  sample,
  onSave,
  onClose,
}: {
  initial: Profile | null;
  sample: RGB | null;
  onSave: (p: Profile) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? ""),
    [basis, setBasis] = useState<Profile["basis"]>(
      initial?.basis ?? "same-image",
    ),
    [patches, setPatches] = useState<Patch[]>(
      initial?.patches ?? [
        { ph: 4, hex: "#D98669" },
        { ph: 7, hex: "#94B889" },
      ],
    ),
    [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  function change(i: number, patch: Partial<Patch>) {
    setPatches(patches.map((p, j) => (i === j ? { ...p, ...patch } : p)));
  }
  return (
    <section className="panel profile-editor">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">REFERENCE BUILDER</span>
          <h3>Build your pH reference</h3>
        </div>
        <button
          className="icon-button"
          aria-label="Close profile editor"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="panel-body">
        <p className="muted">
          Record the strip brand, batch and read time. Select a chart patch in
          the photo, then use the target button to fill its row.
        </p>
        <div className="form-grid">
          <label>
            Profile name
            <input
              placeholder="For example: brand / batch / read time"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Color source
            <select
              value={basis}
              onChange={(e) => setBasis(e.target.value as Profile["basis"])}
            >
              <option value="same-image">Sampled from the same photo</option>
              <option value="standard">Known reference RGB / HEX</option>
            </select>
          </label>
        </div>
        <div className="patch-header">
          <span>pH label</span>
          <span>HEX color</span>
          <span>Sample / remove</span>
        </div>
        {patches.map((p, i) => (
          <div className="patch-row" key={i}>
            <input
              type="number"
              min="0"
              max="14"
              step="0.1"
              aria-label={`Patch ${i + 1} pH`}
              value={Number.isFinite(p.ph) ? p.ph : ""}
              onChange={(e) =>
                change(i, { ph: e.target.value === "" ? NaN : +e.target.value })
              }
            />
            <div className="hex-input">
              <input
                aria-label={`Patch ${i + 1} Color`}
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(p.hex) ? p.hex : "#000000"}
                onChange={(e) => change(i, { hex: e.target.value })}
              />
              <input
                aria-label={`Patch ${i + 1} HEX`}
                value={p.hex}
                maxLength={7}
                onChange={(e) => change(i, { hex: e.target.value })}
              />
            </div>
            <div>
              <button
                className="icon-button"
                disabled={!sample}
                title="Use the current original sample color"
                aria-label={`Use current sample ${i + 1}`}
                onClick={() => change(i, { hex: hex(sample!) })}
              >
                <Crosshair size={17} />
              </button>
              <button
                className="icon-button"
                aria-label={`Remove patch ${i + 1}`}
                onClick={() => setPatches(patches.filter((_, j) => j !== i))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
        <button
          className="text-button"
          disabled={patches.length >= 30}
          onClick={() =>
            setPatches([
              ...patches,
              {
                ph: Math.min(14, (patches.at(-1)?.ph ?? 0) + 1),
                hex: "#808080",
              },
            ])
          }
        >
          <Plus size={16} />
          Add reference patch
        </button>
        <label className="check-label">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I replaced the example colors with my own reference patches and pH
          labels.
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary"
          disabled={!confirmed}
          onClick={() => {
            try {
              onSave(
                validateProfile({
                  id: initial?.synthetic ? undefined : initial?.id,
                  name,
                  basis,
                  patches,
                  synthetic: initial?.synthetic ?? false,
                }),
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Save profile locally
        </button>
        <small className="block muted">
          Same-photo references apply to those capture conditions. Resample or
          verify matching conditions when changing photos.
        </small>
      </div>
    </section>
  );
}
