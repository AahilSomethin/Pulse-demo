import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/** Local development only. Streams one August file from data/ and does not ship it in the client bundle. */
export async function GET(_request: Request, context: { params: Promise<{ day: string }> }) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not available.", { status: 404 });
  }
  const day = Number((await context.params).day);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return new Response("Choose a day from 1 to 31.", { status: 400 });
  }
  const filePath = path.join(process.cwd(), "data", "FollowMe", "FollowMe_august_2025", `${day}.csv`);
  try {
    await stat(filePath);
  } catch {
    return new Response("That day is not in the local data folder.", { status: 404 });
  }
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new Response(stream, {
    headers: { "content-type": "text/csv; charset=utf-8" },
  });
}
