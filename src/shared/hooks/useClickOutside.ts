import { useEffect, useRef, type RefObject } from 'react';

/**
 * Calls `onClose` when a mousedown event occurs outside `ref`.
 * Only triggers if the initial mousedown was also outside,
 * so drag-selecting inside and releasing outside won't close.
 * No-op when `enabled` is false.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onClose: () => void,
): void {
  const mousedownOutside = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const downHandler = (e: MouseEvent) => {
      mousedownOutside.current = ref.current
        ? !ref.current.contains(e.target as Node)
        : true;
    };

    const upHandler = (e: MouseEvent) => {
      if (
        mousedownOutside.current &&
        ref.current &&
        !ref.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', downHandler);
    document.addEventListener('mouseup', upHandler);
    return () => {
      document.removeEventListener('mousedown', downHandler);
      document.removeEventListener('mouseup', upHandler);
    };
  }, [ref, enabled, onClose]);
}
