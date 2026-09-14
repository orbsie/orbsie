"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import type { ModelQualityOption } from "../lib/model-quality-presets";

type CatalogStatus = "idle" | "loading" | "ready" | "error";

export default function ModelQualitySelector({
  providerLabel,
  leading,
  selected,
  options,
  status = "ready",
  disabled = false,
  onOpen,
  onRetry,
  onSelect,
}: {
  providerLabel: string;
  leading?: ReactNode;
  selected: string | null;
  options: readonly ModelQualityOption[];
  status?: CatalogStatus;
  disabled?: boolean;
  onOpen?: () => void;
  onRetry?: () => void;
  onSelect: (option: ModelQualityOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) queueMicrotask(() => trigger.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      }
      if (event.key === "Tab") {
        close();
        return;
      }
      if (!root.current?.contains(document.activeElement)) return;
      const choices = Array.from(
        root.current.querySelectorAll<HTMLButtonElement>(
          '[role="menuitemradio"]:not(:disabled)',
        ),
      );
      if (!choices.length) return;
      const index = choices.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next =
          index < 0
            ? event.key === "ArrowDown"
              ? 0
              : choices.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) %
              choices.length;
        choices[next]?.focus();
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        choices[event.key === "Home" ? 0 : choices.length - 1]?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    const first = root.current?.querySelector<HTMLButtonElement>(
      '[role="menuitemradio"]:not(:disabled)',
    );
    first?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open, status]);

  const toggle = () => {
    if (disabled) return;
    if (!open) onOpen?.();
    setOpen((current) => !current);
  };
  const selectedOption = options.find((option) => option.label === selected);
  const triggerText = selectedOption
    ? `${providerLabel} · ${selectedOption.label}`
    : `${providerLabel} · Choose quality`;

  return (
    <div className="quality-selector" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="mode-button quality-selector-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={toggle}
      >
        {leading}
        <span>{triggerText}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          className="quality-selector-menu"
          role="menu"
          aria-label="Creation quality"
        >
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              role="menuitemradio"
              aria-checked={selected === option.label}
              disabled={!option.available || status === "loading"}
              title={
                option.available
                  ? option.description
                  : `${option.label} is unavailable in this catalog`
              }
              onClick={() => {
                onSelect(option);
                close(true);
              }}
            >
              <strong>{option.label}</strong>
              <span>
                {option.available ? option.description : "Unavailable"}
              </span>
            </button>
          ))}
          {status === "loading" && (
            <p className="quality-selector-status" role="status">
              Loading available choices…
            </p>
          )}
          {status === "error" && (
            <div className="quality-selector-status" role="alert">
              <span>Choices unavailable.</span>
              {onRetry && (
                <button type="button" onClick={onRetry}>
                  Retry
                </button>
              )}
            </div>
          )}
          {status === "ready" &&
            options.every((option) => !option.available) && (
              <p className="quality-selector-status" role="status">
                No quality choices are available right now.
              </p>
            )}
        </div>
      )}
    </div>
  );
}
