export interface WaitOptions {
  signal: AbortSignal;
  timeoutMs: number;
}

function visible(selector: string): HTMLElement | null {
  const node = document.querySelector(selector);
  if (!(node instanceof HTMLElement)) return null;
  const rect = node.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const style = getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return null;
  return node;
}

/** Resolves when `selector` is in the document and has a box, or null on timeout or abort. */
export function waitForTarget(selector: string, options: WaitOptions): Promise<HTMLElement | null> {
  const found = visible(selector);
  if (found) return Promise.resolve(found);
  if (options.signal.aborted) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: HTMLElement | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(null);
    const observer = new MutationObserver(() => {
      const next = visible(selector);
      if (next) finish(next);
    });
    const timer = window.setTimeout(() => finish(null), options.timeoutMs);
    options.signal.addEventListener("abort", onAbort, { once: true });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
  });
}
