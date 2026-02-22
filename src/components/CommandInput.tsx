import type { FormEvent, KeyboardEvent, RefObject } from "react";
import type { ConnectionState } from "../lib/ws-client";

type CommandInputProps = {
  value: string;
  connectionState: ConnectionState;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputRef: RefObject<HTMLInputElement | null>;
};

export function CommandInput({
  value,
  connectionState,
  onChange,
  onSubmit,
  onKeyDown,
  inputRef,
}: CommandInputProps) {
  return (
    <section className="command-strip">
      <form className="query-form" onSubmit={onSubmit}>
        <input
          ref={inputRef}
          className="query-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask MacClaw..."
          aria-label="MacClaw prompt input"
        />
        <span className={`state-dot state-dot--${connectionState}`} />
      </form>
    </section>
  );
}
