import { useEffect, useState, type KeyboardEvent } from "react";
import {
  matchingCommands,
  safeTrim,
  type CommandDefinition,
} from "../lib/commands";

type UseCommandInputResult = {
  input: string;
  setInput: (v: string) => void;
  trimmedInput: string;
  commandHints: CommandDefinition[];
  showHints: boolean;
  hintIndex: number;
  setHintIndex: (v: number) => void;
  onInputKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
};

export function useCommandInput(
  showConnectForm: boolean,
  activeQuery: string,
): UseCommandInputResult {
  const [input, setInput] = useState("");
  const [hintIndex, setHintIndex] = useState(0);

  const trimmedInput = safeTrim(input);
  const commandHints =
    !showConnectForm && !activeQuery ? matchingCommands(trimmedInput) : [];
  const showHints = commandHints.length > 0;

  // Reset hint index when filtered list changes.
  useEffect(() => {
    setHintIndex(0);
  }, [trimmedInput]);

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
