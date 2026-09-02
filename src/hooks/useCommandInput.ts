import { useState, type KeyboardEvent } from "react";
import { matchingCommands, safeTrim, type CommandDefinition } from "../lib/commands";

type HintIndexUpdate = number | ((current: number) => number);

type UseCommandInputResult = {
  input: string;
  setInput: (v: string) => void;
  trimmedInput: string;
  commandHints: CommandDefinition[];
  showHints: boolean;
  hintIndex: number;
  setHintIndex: (v: HintIndexUpdate) => void;
  onInputKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
};

export function useCommandInput(
  showConnectForm: boolean,
  activeQuery: string,
): UseCommandInputResult {
  const [input, setInput] = useState("");
  // The selected hint belongs to the input it was chosen for; a different
  // input starts again at the top without needing an effect to reset it.
  const [hint, setHint] = useState({ input: "", index: 0 });

  const trimmedInput = safeTrim(input);
  const commandHints =
    !showConnectForm && !activeQuery ? matchingCommands(trimmedInput) : [];
  const showHints = commandHints.length > 0;
  const hintIndex = hint.input === trimmedInput ? hint.index : 0;

  const setHintIndex = (update: HintIndexUpdate) => {
    setHint((previous) => {
      const current = previous.input === trimmedInput ? previous.index : 0;
      const index = typeof update === "function" ? update(current) : update;
      return { input: trimmedInput, index };
    });
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!showHints) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHintIndex((i) => Math.min(i + 1, commandHints.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHintIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Tab") {
      e.preventDefault();
      const selected = commandHints[hintIndex];
      if (selected) {
        setInput(selected.name);
      }
    }
  };

  return {
    input,
    setInput,
    trimmedInput,
    commandHints,
    showHints,
    hintIndex,
    setHintIndex,
    onInputKeyDown,
  };
}
