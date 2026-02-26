import type { FormEvent, KeyboardEvent, RefObject } from "react";
import type { ConnectionState } from "../lib/ws-client";

type CommandInputProps = {
  value: string;
  placeholder: string;
  selectionBadge?: string;
  connectionState: ConnectionState;
  onChange: (value: string) => void;
  onClearSelectionBadge?: () => void;
  onSubmit: (event: FormEvent) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputRef: RefObject<HTMLInputElement | null>;
};

export function CommandInput({
  value,
  placeholder,
  selectionBadge,
  connectionState,
  onChange,
  onClearSelectionBadge,
  onSubmit,
  onKeyDown,
  inputRef,
}: CommandInputProps) {
  return (
    <section className="command-strip">
      <form className="query-form" onSubmit={onSubmit}>
        <div className="query-input-wrap">
          {selectionBadge ? (
            <button
              type="button"
              className="selection-chip"
              onClick={onClearSelectionBadge}
              title="Remove selected text context"
            >
              [{selectionBadge}]
            </button>
          ) : null}
          <input
            ref={inputRef}
            className="query-input"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label="MacClaw prompt input"
          />
        </div>
        <span className={`state-dot state-dot--${connectionState}`} />
      </form>
    </section>
  );
}
