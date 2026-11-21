import { mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { connect, createServer } from "node:net";
import { dirname } from "node:path";

/**
 * The one module allowed to import `node:net` (ADR-0038). A line protocol
 * over a local socket: one request line, one reply line, then the
 * connection closes. Nothing here throws to its caller: a failure is
 * `null` on the client side and `undefined` on the serving side.
 */

/** A request line longer than this is dropped rather than buffered. */
const MAX_LINE_BYTES = 8 * 1024 * 1024;

/** Numbers each listen path this process uses, so two servers in one process never share one. */
let listenCount = 0;

export interface LineServer {
  /** Stops listening and removes the socket file, unless another server has replaced it. */
  close(): Promise<void>;
  /** Whether the socket file is still this server's, rather than gone or replaced by another server's. */
  owned(): boolean;
}

/** Sends `line` and resolves with the first reply line, or `null` on any failure or after `timeoutMs`. */
export function requestLine(socketPath: string, line: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let buffer = "";
    let settled = false;
    const socket = connect(socketPath);
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${line}\n`));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end !== -1) finish(buffer.slice(0, end));
    });
    socket.on("end", () => finish(buffer === "" ? null : buffer));
    socket.on("error", () => finish(null));
  });
}

/** Whether a server is accepting connections on `socketPath` right now. */
function isLive(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

/**
 * Answers each request line with `handle`'s reply. Resolves `undefined`,
 * leaving the socket alone, when another server is already live on it, or
 * when listening fails. A socket file with no server behind it is replaced.
 * The server listens on a private path, then renames it into place: Node
 * unlinks a socket's listen path when the server closes, and that path must
 * never be one another server has since taken over.
 * The directory is created owner-only. The listener never keeps the
 * process alive, and the socket file is removed on close or process exit
 * while it is still this server's.
 */
export async function serveLines(socketPath: string, handle: (line: string) => Promise<string>): Promise<LineServer | undefined> {
  const listenPath = `${socketPath}.${process.pid}-${listenCount++}`;
  try {
    mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
    if (await isLive(socketPath)) return undefined;
    rmSync(listenPath, { force: true });
  } catch {
    return undefined;
  }

  const server = createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE_BYTES) return socket.destroy();
      const end = buffer.indexOf("\n");
      if (end === -1) return;
      socket.pause();
      handle(buffer.slice(0, end)).then(
        (reply) => socket.end(`${reply}\n`),
        () => socket.destroy(),
      );
    });
  });

  const listening = await new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(listenPath, () => resolve(true));
  });
  if (!listening) return undefined;
  server.unref();
  // Two servers that start together can both find no live socket; the later one's file wins.
  let ino: number;
  try {
    renameSync(listenPath, socketPath);
    ino = statSync(socketPath).ino;
  } catch {
    server.close();
    return undefined;
  }
  const owned = () => {
    try {
      return statSync(socketPath).ino === ino;
    } catch {
      return false;
    }
  };
  const removeSocket = () => {
    if (owned()) rmSync(socketPath, { force: true });
  };
  process.once("exit", removeSocket);

  return {
    owned,
    close: () =>
      new Promise<void>((resolve) => {
        process.off("exit", removeSocket);
        server.close(() => resolve());
        removeSocket();
      }),
  };
}
