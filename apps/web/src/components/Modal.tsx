import { useLayoutEffect, useRef, type ReactNode } from 'react';

/**
 * Centered modal on a native <dialog>: Escape and a click on the dimmed backdrop both call
 * `onClose`. Leave `onClose` out while something is in flight to make it undismissable.
 * Mount it to open it; unmount it to close it.
 */
export function Modal({
  onClose,
  className,
  children,
}: {
  onClose?: () => void;
  /** The panel's classes. */
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      // The dialog itself is the full-screen dimmed layer, so a click that lands on it rather than
      // on the panel is a backdrop click.
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
      className="fade-in h-full max-h-none w-full max-w-none items-center justify-center bg-zinc-950/80 p-6 text-inherit backdrop-blur backdrop:bg-transparent open:flex"
    >
      <div className={className}>{children}</div>
    </dialog>
  );
}
