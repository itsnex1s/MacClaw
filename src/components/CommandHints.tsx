import type { CommandDefinition } from "../lib/commands";

type CommandHintsProps = {
  commands: CommandDefinition[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (command: CommandDefinition) => void;
};

export function CommandHints({
  commands,
  activeIndex,
  onHover,
  onSelect,
}: CommandHintsProps) {
  if (commands.length === 0) {
    return null;
  }

  return (
    <section className="dropdown-panel">
      <ul className="hint-list">
        {commands.map((cmd, i) => (
          <li
            key={cmd.name}
            className={`hint-item${i === activeIndex ? " hint-item--active" : ""}`}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(cmd);
            }}
          >
            <span className="hint-name">{cmd.name}</span>
            <span className="hint-desc">{cmd.description}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
