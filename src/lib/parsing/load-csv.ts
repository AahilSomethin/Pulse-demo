import { prepareColumns } from "@/lib/parsing/csv";
import { buildDatasetFromPrepared, fromMessage, toMessage, type DatasetMessage } from "@/lib/vessels/dataset";
import type { VesselDataset } from "@/types/maritime";

export function parseDataset(text: string, sourceLabel: string): VesselDataset {
  return buildDatasetFromPrepared(prepareColumns(text), sourceLabel);
}

function parseWithWorker(payload: { text?: string; file?: File; sourceLabel: string }): Promise<VesselDataset> {
  if (typeof Worker === "undefined") {
    if (payload.text) return Promise.resolve(parseDataset(payload.text, payload.sourceLabel));
    return payload.file ? payload.file.text().then((text) => parseDataset(text, payload.sourceLabel)) : Promise.reject(new Error("No CSV was provided."));
  }
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../../workers/parse-csv.ts", import.meta.url));
    } catch {
      if (payload.text) resolve(parseDataset(payload.text, payload.sourceLabel));
      else if (payload.file) payload.file.text().then((text) => resolve(parseDataset(text, payload.sourceLabel))).catch(reject);
      else reject(new Error("No CSV was provided."));
      return;
    }
    const fail = (error: unknown) => {
      worker.terminate();
      reject(error instanceof Error ? error : new Error("Could not read that CSV."));
    };
    worker.onmessage = (event: MessageEvent<{ ok: true; dataset: DatasetMessage } | { ok: false; error: string }>) => {
      worker.terminate();
      if (!event.data.ok) {
        reject(new Error(event.data.error));
        return;
      }
      resolve(fromMessage(event.data.dataset));
    };
    worker.onerror = () => {
      worker.terminate();
      const fallback = payload.text
        ? Promise.resolve(payload.text)
        : payload.file
          ? payload.file.text()
          : Promise.reject(new Error("No CSV was provided."));
      fallback.then((text) => resolve(parseDataset(text, payload.sourceLabel))).catch(fail);
    };
    worker.postMessage(payload);
  });
}

/** Parses off the UI thread. Falls back to the same function if the worker cannot start. */
export function parseDatasetAsync(text: string, sourceLabel: string): Promise<VesselDataset> {
  return parseWithWorker({ text, sourceLabel });
}

export function parseFileAsync(file: File): Promise<VesselDataset> {
  return parseWithWorker({ file, sourceLabel: file.name });
}

export { toMessage };
