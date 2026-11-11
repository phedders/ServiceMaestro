import type { Server } from "socket.io";

export const HEARTBEAT_EVENT = "heartbeat";
export const HEARTBEAT_INTERVAL_MS = 15_000;

export function startHeartbeat(io: Server): () => void {
  const send = () => io.emit(HEARTBEAT_EVENT, { at: Date.now() });
  io.on("connection", (socket) => socket.emit(HEARTBEAT_EVENT, { at: Date.now() }));
  const timer = setInterval(send, HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
