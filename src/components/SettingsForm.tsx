import type { FormEvent, KeyboardEvent } from "react";
import { keyEventToShortcut } from "../lib/shortcut-utils";

type SettingsFormProps = {
  shortcuts: [string, string, string];
  onShortcutChange: (index: number, value: string) => void;
  onSubmit: (event: FormEvent) => void;
};

const LABELS = ["Shortcut 1", "Shortcut 2", "Shortcut 3"] as const;

function handleKeyDown(
  e: KeyboardEvent<HTMLInputElement>,
  index: number,
  onChange: (index: number, value: string) => void,
) {
  e.preventDefault();
  const shortcut = keyEventToShortcut(e.nativeEvent);
  if (shortcut) {
    onChange(index, shortcut);
  }
}

export function SettingsForm({
  shortcuts,
  onShortcutChange,
  onSubmit,
}: SettingsFormProps) {
  return (
    <section className="dropdown-panel">
      <form className="connect-form" onSubmit={onSubmit}>
        <p className="settings-description">
          Press a key combination in each field to record a new hotkey.
        </p>
        {LABELS.map((label, i) => (
          <div className="connect-field" key={label}>
            <label className="connect-label">{label}</label>
            <input
              className="connect-input"
              value={shortcuts[i]}
              readOnly
              onKeyDown={(e) => handleKeyDown(e, i, onShortcutChange)}
              autoFocus={i === 0}
            />
          </div>
        ))}
        <div className="connect-actions">
          <button type="submit" className="connect-button">
            Save
          </button>
        </div>
      </form>
    </section>
  );
}
