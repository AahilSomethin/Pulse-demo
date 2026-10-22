/**
 * Development only. Serves the local month summary. The file is gitignored.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not available.", { status: 404 });
  }
  try {
    const text = await readFile(path.join(process.cwd(), "data", "derived", "connectivity-august-2025.json"), "utf8");
    return new Response(text, { headers: { "content-type": "application/json; charset=utf-8" } });
  } catch {
    return new Response("The month summary has not been built.", { status: 404 });
  }
}
