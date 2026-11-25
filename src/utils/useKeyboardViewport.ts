import { useEffect, useState } from 'react';

/**
 * The area of the screen a phone's software keyboard leaves free. A sheet fixed to the whole window is covered by the keyboard;
 * giving the sheet's backdrop this top and height keeps the sheet above the keyboard, and the field being typed in in view.
 */
export function useKeyboardViewport() {
  const [area, setArea] = useState<{ top: number; height: number }>();
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setArea({ top: viewport.offsetTop, height: viewport.height });
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => { viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); };
  }, []);
  return area;
}

/** Bring a field into view once the keyboard has finished opening. */
export function showWhenKeyboardOpens(element: HTMLElement) {
  window.setTimeout(() => { try { element.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* No layout outside a browser. */ } }, 280);
}
