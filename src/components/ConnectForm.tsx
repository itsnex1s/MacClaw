import type { FormEvent } from "react";

type ConnectFormProps = {
  gatewayUrl: string;
  token: string;
  onGatewayUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
};

export function ConnectForm({
  gatewayUrl,
  token,
  onGatewayUrlChange,
  onTokenChange,
  onSubmit,
}: ConnectFormProps) {
  return (
    <section className="dropdown-panel">
      <form className="connect-form" onSubmit={onSubmit}>
        <div className="connect-field">
          <label className="connect-label">Gateway URL</label>
          <input
            className="connect-input"
            value={gatewayUrl}
            onChange={(event) => onGatewayUrlChange(event.target.value)}
            placeholder="ws://127.0.0.1:19819"
            autoFocus
          />
        </div>
        <div className="connect-field">
          <label className="connect-label">Token</label>
          <input
            className="connect-input"
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="connect-actions">
          <button type="submit" className="connect-button">
            Connect
          </button>
        </div>
      </form>
    </section>
  );
}
