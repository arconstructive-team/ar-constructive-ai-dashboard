import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export interface MenuItem {
  key: string;
  label: ReactNode;
  hint?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  current?: boolean;
}

interface MenuProps {
  /** What the button shows. */
  trigger: ReactNode;
  /** The button's accessible name. */
  label: string;
  buttonClassName: string;
  items: MenuItem[];
  /** Shown instead of items, e.g. while they load. */
  status?: ReactNode;
  align?: "left" | "right";
  disabled?: boolean;
  title?: string;
  onOpen?: () => void;
}

/** A button that opens a list of actions. Arrow keys move, Escape closes. */
export function Menu(props: MenuProps) {
  const { items, align = "left" } = props;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open, items.length]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const list = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (!list.length) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (index + 1) % list.length : (index - 1 + list.length) % list.length;
    list[next].focus();
  }

  return (
    <div ref={root} className="relative min-w-0" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={props.label}
        title={props.title}
        disabled={props.disabled}
        onClick={() => {
          if (!open) props.onOpen?.();
          setOpen(!open);
        }}
        className={`${props.buttonClassName} ${focusRing}`}
      >
        {props.trigger}
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={props.label}
          className={`absolute top-full z-30 mt-1 max-h-[60vh] w-max min-w-56 max-w-[min(360px,calc(100vw-32px))] overflow-y-auto rounded-sheet border border-border bg-bg py-1 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {props.status && <p className="px-3 py-3 text-sm text-muted">{props.status}</p>}
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              aria-current={item.current || undefined}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="grid min-h-11 w-full gap-0.5 px-3 py-2 text-left text-sm text-ink hover:bg-surface focus-visible:bg-surface focus-visible:outline-none disabled:opacity-40"
            >
              <span className={item.current ? "font-semibold" : undefined}>{item.label}</span>
              {item.hint && <span className="text-xs text-muted">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
