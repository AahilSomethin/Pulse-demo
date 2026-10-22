import { driver, type DriveStep, type Driver } from "driver.js";

import type { GuideStep } from "@/tour/steps";
import { waitForTarget } from "@/tour/wait";

export interface GuideController {
  prepare: (step: GuideStep) => void;
  /** `route` is false when the browser Back button already changed the URL. */
  restore: (reason: { route: boolean }) => void;
  reducedMotion: boolean;
}

/** Starts a Driver.js walkthrough. `destroy` is safe to call more than once. */
export function startTeamGuide(steps: readonly GuideStep[], controller: GuideController): { destroy: () => void } {
  const tourAbort = new AbortController();
  const resolved = new Map<string, HTMLElement | null>();
  const fallback = new Set<string>();
  let generation = 0;
  let closed = false;
  let popped = false;
  let guide: Driver | null = null;

  const driveSteps: DriveStep[] = steps.map((step) => ({
    // Driver.js treats a missing return as a centred popover. Its type still says Element.
    element: (() => {
      const cached = resolved.get(step.id);
      if (cached?.isConnected) return cached;
      if (!step.target || fallback.has(step.id)) return undefined;
      const live = document.querySelector(`[data-tour="${step.target}"]`);
      return live instanceof HTMLElement ? live : undefined;
    }) as () => Element,
    disableActiveInteraction: step.disableMap,
    popover: {
      title: step.title,
      description: step.description,
      side: "bottom",
      align: "start",
    },
  }));

  function cleanup() {
    if (closed) return;
    closed = true;
    generation += 1;
    tourAbort.abort();
    window.removeEventListener("popstate", onPopState);
    controller.restore({ route: !popped });
  }

  function onPopState() {
    popped = true;
    guide?.destroy();
  }

  async function show(index: number) {
    const ticket = ++generation;
    const step = steps[index];
    if (!step || closed) return;
    controller.prepare(step);
    const local = new AbortController();
    const onTourAbort = () => local.abort();
    tourAbort.signal.addEventListener("abort", onTourAbort, { once: true });
    if (step.target) {
      const found = await waitForTarget(`[data-tour="${step.target}"]`, { signal: local.signal, timeoutMs: 4000 });
      tourAbort.signal.removeEventListener("abort", onTourAbort);
      if (ticket !== generation || closed) return;
      resolved.set(step.id, found);
      if (found) fallback.delete(step.id);
      else fallback.add(step.id);
    } else {
      resolved.set(step.id, null);
      fallback.delete(step.id);
    }
    if (ticket !== generation || closed || !guide) return;
    if (!guide.isActive()) guide.drive(index);
    else guide.moveTo(index);
  }

  guide = driver({
    steps: driveSteps,
    animate: !controller.reducedMotion,
    smoothScroll: !controller.reducedMotion,
    overlayOpacity: 0.55,
    showProgress: true,
    progressText: "{{current}} of {{total}}",
    nextBtnText: "Next",
    prevBtnText: "Previous",
    doneBtnText: "Finish",
    allowClose: true,
    allowKeyboardControl: true,
    popoverClass: "seapulse-tour",
    stageRadius: 8,
    onPopoverRender: (popover, opts) => {
      const index = opts.driver.getActiveIndex() ?? 0;
      const step = steps[index];
      if (!step) return;
      popover.title.textContent = step.title;
      popover.description.textContent = fallback.has(step.id) ? step.fallbackDescription : step.description;
    },
    onNextClick: (_element, _step, opts) => {
      const index = opts.driver.getActiveIndex() ?? 0;
      if (index >= steps.length - 1) opts.driver.destroy();
      else void show(index + 1);
    },
    onPrevClick: (_element, _step, opts) => {
      const index = opts.driver.getActiveIndex() ?? 0;
      if (index > 0) void show(index - 1);
    },
    onDestroyed: () => cleanup(),
  });

  window.addEventListener("popstate", onPopState);
  void show(0);

  return {
    destroy: () => {
      guide?.destroy();
      cleanup();
    },
  };
}
