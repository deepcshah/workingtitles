"use client";

import { useEffect, useRef, useState } from "react";

export type SelectOption<T extends string> = { value: T; label: string };

/**
 * A small accessible listbox — styled to match the paper-and-ink look, with no
 * dependency. Keyboard: Enter/Space/↓ open; ↑/↓/Home/End move; Enter selects;
 * Esc closes; click-outside closes. ARIA: button + role="listbox"/"option".
 */
export default function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value) ?? options[0];

  // when opening: sync the active row to the selection and focus the list
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    listRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = (i: number) => {
    onChange(options[i].value);
    setOpen(false);
    btnRef.current?.focus();
  };

  return (
    <div className="select" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className="select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{selected.label}</span>
        <svg className="select-caret" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          className="select-list"
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-activedescendant={`select-opt-${active}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              btnRef.current?.focus();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Home") {
              e.preventDefault();
              setActive(0);
            } else if (e.key === "End") {
              e.preventDefault();
              setActive(options.length - 1);
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              commit(active);
            } else if (e.key === "Tab") {
              setOpen(false);
            }
          }}
        >
          {options.map((o, i) => (
            <li
              id={`select-opt-${i}`}
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`select-opt${i === active ? " active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => commit(i)}
            >
              <span>{o.label}</span>
              {o.value === value && <span className="select-check" aria-hidden="true">✓</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
