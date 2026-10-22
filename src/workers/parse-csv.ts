import { prepareColumns } from "@/lib/parsing/csv";
import { buildDatasetFromPrepared, toMessage } from "@/lib/vessels/dataset";

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ text?: string; file?: File; sourceLabel: string }>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

scope.onmessage = async (event: MessageEvent<{ text?: string; file?: File; sourceLabel: string }>) => {
  try {
    const text = event.data.text ?? (event.data.file ? await event.data.file.text() : "");
    const dataset = buildDatasetFromPrepared(prepareColumns(text), event.data.sourceLabel);
    const message = toMessage(dataset);
    scope.postMessage({ ok: true, dataset: message }, [
      message.timeMs.buffer,
      message.savedMs.buffer,
      message.lat.buffer,
      message.lon.buffer,
      message.speed.buffer,
      message.heading.buffer,
      message.network.buffer,
      message.gsm.buffer,
      message.deviceIndex.buffer,
    ]);
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : "Could not read that CSV." });
  }
};
