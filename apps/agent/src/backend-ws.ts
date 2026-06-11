import type { Logger } from 'pino';
import WebSocket from 'ws';
import type { DeviceToServerMessage, HeartbeatInput, ServerToDeviceMessage } from '@signage/shared';

export interface BackendHandlers {
  onCommand: (command: { id: string; type: string; payload: Record<string, unknown> }) => void;
  onSyncRequired: (reason: string) => void;
  onConnected: () => void;
  onDisconnected: () => void;
}

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

/**
 * Persistent outbound websocket to the backend. Reconnects forever with
 * exponential backoff; the agent works fine without it (polling fallback),
 * the socket just makes commands and sync notifications instant.
 */
export class BackendConnection {
  private socket: WebSocket | null = null;
  private backoffMs = MIN_BACKOFF_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private connected = false;

  constructor(
    private wsUrl: string,
    private token: string,
    private appVersion: string,
    private getManifestVersion: () => string | null,
    private handlers: BackendHandlers,
    private log: Logger,
  ) {}

  start(): void {
    this.connect();
  }

  isConnected(): boolean {
    return this.connected && this.socket?.readyState === WebSocket.OPEN;
  }

  send(message: DeviceToServerMessage): boolean {
    if (!this.isConnected() || !this.socket) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  sendHeartbeat(payload: HeartbeatInput): boolean {
    return this.send({ type: 'heartbeat', payload: payload as unknown as Record<string, unknown> });
  }

  sendStatus(status: {
    currentPlaylistId: string | null;
    currentMediaId: string | null;
    manifestVersion: string | null;
  }): boolean {
    return this.send({ type: 'status', ...status });
  }

  sendCommandAck(commandId: string): boolean {
    return this.send({ type: 'command_ack', commandId });
  }

  sendCommandResult(
    commandId: string,
    status: 'completed' | 'failed',
    result?: Record<string, unknown>,
  ): boolean {
    return this.send({ type: 'command_result', commandId, status, result });
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.removeAllListeners();
    this.socket?.close();
    this.socket = null;
    this.connected = false;
  }

  private connect(): void {
    if (this.closed) return;
    const socket = new WebSocket(this.wsUrl, {
      headers: { authorization: `Bearer ${this.token}` },
      handshakeTimeout: 15_000,
    });
    this.socket = socket;

    socket.on('open', () => {
      this.connected = true;
      this.backoffMs = MIN_BACKOFF_MS;
      this.log.info('backend websocket connected');
      this.send({
        type: 'hello',
        appVersion: this.appVersion,
        manifestVersion: this.getManifestVersion(),
      });
      this.handlers.onConnected();
    });

    socket.on('message', (raw) => {
      let message: ServerToDeviceMessage;
      try {
        message = JSON.parse(String(raw)) as ServerToDeviceMessage;
      } catch {
        return;
      }
      switch (message.type) {
        case 'command':
          this.handlers.onCommand(message.command);
          break;
        case 'sync_required':
          this.handlers.onSyncRequired(message.reason);
          break;
        case 'hello_ack':
        case 'pong':
          break;
      }
    });

    const onGone = (reason: string) => {
      if (this.socket !== socket) return;
      const wasConnected = this.connected;
      this.connected = false;
      this.socket = null;
      socket.removeAllListeners();
      if (wasConnected) {
        this.log.warn({ reason }, 'backend websocket disconnected');
        this.handlers.onDisconnected();
      }
      this.scheduleReconnect();
    };

    socket.on('close', (code) => onGone(`close ${code}`));
    socket.on('error', (err) => onGone(err.message));
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = this.backoffMs + Math.floor(Math.random() * 500);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.log.debug({ delay }, 'backend websocket reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
