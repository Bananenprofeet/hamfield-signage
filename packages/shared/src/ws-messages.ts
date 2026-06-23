import type {
  CommandType,
  FitMode,
  PlaybackOrderMode,
  PlayedAs,
  PositionMode,
  PrioritySelectionMode,
} from './enums';

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
  /** Resolved (effective) display settings — never null in player state. */
  fitMode: FitMode;
  backgroundColor: string;
  positionMode: PositionMode;
  width: number | null;
  height: number | null;
  name?: string;
}

export interface PlayerPriorityRule {
  id: string;
  name: string;
  /** One rule item plays after every `intervalCount` normal items. */
  intervalCount: number;
  selectionMode: PrioritySelectionMode;
  position: number;
  createdAt?: string;
  /** Playable rule content, resolved and cached like normal items. */
  items: PlayerStateItem[];
}

export interface PlayerState {
  /** Increments whenever the playable content changes. */
  revision: number;
  deviceName: string;
  /** Content canvas shape; drives content-matching and the dashboard preview. */
  orientation: 'landscape' | 'portrait';
  /** Software rotation (clockwise degrees) the player applies to the stage. */
  rotation: 0 | 90 | 180 | 270;
  source: 'emergency' | 'schedule' | 'default' | 'none';
  playlistId: string | null;
  playlistName: string | null;
  loop: boolean;
  /**
   * How the player should order `items`. For manual/alphabetical the items
   * are already in final order; for the random modes the player shuffles.
   */
  playbackOrderMode: PlaybackOrderMode;
  items: PlayerStateItem[];
  /** Active only when playbackOrderMode is random_with_priority_rules. */
  priorityRules: PlayerPriorityRule[];
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
  /** Whether the item played as normal content or via a priority rule. */
  playedAs?: PlayedAs;
  priorityRuleId?: string | null;
  durationSeconds?: number | null;
  detail?: Record<string, unknown>;
  occurredAt: string;
}

export interface PlayerReadyMessage {
  type: 'player_ready';
}

export type PlayerToAgentMessage = PlayerPlaybackEventMessage | PlayerReadyMessage;
