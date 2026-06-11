import type { CommandType } from './enums';

// ============================================================
// Device <-> Backend WebSocket protocol (outbound from device)
// ============================================================

/** Sent by the device immediately after connecting. */
export interface DeviceHelloMessage {
  type: 'hello';
  appVersion: string;
  manifestVersion: string | null;
}

/** Periodic heartbeat over the socket (same shape as the REST heartbeat body). */
export interface DeviceWsHeartbeatMessage {
  type: 'heartbeat';
  payload: Record<string, unknown>;
}

export interface DeviceCommandAckMessage {
  type: 'command_ack';
  commandId: string;
}

export interface DeviceCommandResultMessage {
  type: 'command_result';
  commandId: string;
  status: 'completed' | 'failed';
  result?: Record<string, unknown>;
}

export interface DeviceStatusMessage {
  type: 'status';
  currentPlaylistId: string | null;
  currentMediaId: string | null;
  manifestVersion: string | null;
}

export type DeviceToServerMessage =
  | DeviceHelloMessage
  | DeviceWsHeartbeatMessage
  | DeviceCommandAckMessage
  | DeviceCommandResultMessage
  | DeviceStatusMessage;

/** Backend pushes a command to the device through the open socket. */
export interface ServerCommandMessage {
  type: 'command';
  command: {
    id: string;
    type: CommandType;
    payload: Record<string, unknown>;
  };
}

/** Backend tells the device its content changed; device should sync now. */
export interface ServerSyncRequiredMessage {
  type: 'sync_required';
  reason: string;
}

export interface ServerHelloAckMessage {
  type: 'hello_ack';
  serverTime: string;
  manifestVersion: string;
}

export interface ServerPongMessage {
  type: 'pong';
}

export type ServerToDeviceMessage =
  | ServerCommandMessage
  | ServerSyncRequiredMessage
  | ServerHelloAckMessage
  | ServerPongMessage;

// ============================================================
// Player UI <-> Device agent local protocol
// ============================================================

export interface PlayerStateItem {
  /** Playlist item id (or synthetic id for emergency single media). */
  id: string;
  mediaId: string;
  mediaType: 'image' | 'video';
  /** Local URL served by the agent, e.g. /media/<mediaId> */
  url: string;
  durationSeconds: number | null;
  fitMode: 'contain' | 'cover' | 'stretch' | 'original';
  width: number | null;
  height: number | null;
  name?: string;
}

export interface PlayerState {
  /** Increments whenever the playable content changes. */
  revision: number;
  deviceName: string;
  orientation: 'landscape' | 'portrait' | 'inverted_landscape' | 'inverted_portrait';
  source: 'emergency' | 'schedule' | 'default' | 'none';
  playlistId: string | null;
  playlistName: string | null;
  loop: boolean;
  items: PlayerStateItem[];
  /** Shown on the fallback screen when there is nothing to play. */
  statusMessage: string | null;
  paired: boolean;
  online: boolean;
  identify?: boolean;
}

export interface AgentToPlayerStateMessage {
  type: 'state';
  state: PlayerState;
}

export interface AgentToPlayerIdentifyMessage {
  type: 'identify';
  deviceName: string;
  durationSeconds: number;
}

export type AgentToPlayerMessage = AgentToPlayerStateMessage | AgentToPlayerIdentifyMessage;

export interface PlayerPlaybackEventMessage {
  type: 'playback_event';
  eventType: 'start' | 'end' | 'error' | 'skip';
  itemId: string;
  mediaId: string;
  playlistId: string | null;
  detail?: Record<string, unknown>;
  occurredAt: string;
}

export interface PlayerReadyMessage {
  type: 'player_ready';
}

export type PlayerToAgentMessage = PlayerPlaybackEventMessage | PlayerReadyMessage;
