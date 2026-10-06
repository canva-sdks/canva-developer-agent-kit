import { request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// Requests only the local Express test server; global fetch remains fully mocked.
export async function requestApp(
  server: Server,
  path: string,
  options: { method?: string; body?: unknown; cookie?: string; origin?: string } = {},
): Promise<{ status: number; headers: IncomingHttpHeaders; json: Record<string, unknown> | null; text: string }> {
  const data = options.body === undefined ? undefined : JSON.stringify(options.body);
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1", port, path, method: options.method ?? "GET",
      headers: {
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.origin ? { Origin: options.origin } : {}),
      },
    }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* Redirects contain HTML. */ }
        resolve({ status: res.statusCode!, headers: res.headers, json, text });
      });
    });
    req.on("error", reject);
    req.end(data);
  });
}
