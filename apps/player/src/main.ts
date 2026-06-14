import {
  PlaybackQueueEngine,
  type AgentToPlayerMessage,
  type PlayerState,
  type PlayerStateItem,
  type PlayerToAgentMessage,
  type QueueResult,
} from '@signage/shared';
import './style.css';

// The agent serving this page is also the websocket/media host. During
// `vite dev` you can point at a remote agent with ?agent=host:port.
const params = new URLSearchParams(location.search);
const agentHost = params.get('agent') ?? location.host;
const isSecure = location.protocol === 'https:';
const mediaBase =
  agentHost === location.host ? '' : `${isSecure ? 'https' : 'http'}://${agentHost}`;
const wsUrl = `${isSecure ? 'wss' : 'ws'}://${agentHost}/ws`;

const stage = document.getElementById('stage') as HTMLDivElement;
const layerEls = [
  document.getElementById('layer-a') as HTMLDivElement,
  document.getElementById('layer-b') as HTMLDivElement,
];
const fallbackEl = document.getElementById('fallback') as HTMLDivElement;
const fbName = document.getElementById('fb-name') as HTMLDivElement;
const fbMessage = document.getElementById('fb-message') as HTMLDivElement;
const fbPaired = document.getElementById('fb-paired') as HTMLSpanElement;
const fbOnline = document.getElementById('fb-online') as HTMLSpanElement;
const fbClock = document.getElementById('fb-clock') as HTMLDivElement;
const identifyEl = document.getElementById('identify') as HTMLDivElement;
const offlineDot = document.getElementById('offline-dot') as HTMLDivElement;

let socket: WebSocket | null = null;

function send(message: PlayerToAgentMessage): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function sendEvent(
  eventType: 'start' | 'end' | 'error' | 'skip',
  item: PlayerStateItem,
  playlistId: string | null,
  detail?: Record<string, unknown>,
  play?: { playedAs: 'normal' | 'priority'; priorityRuleId?: string } | null,
): void {
  send({
    type: 'playback_event',
    eventType,
    itemId: item.id,
    mediaId: item.mediaId,
    playlistId,
    playedAs: play?.playedAs ?? 'normal',
    priorityRuleId: play?.priorityRuleId ?? null,
    detail,
    occurredAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------- playback

const DEFAULT_IMAGE_DURATION = 10;
const ERROR_RETRY_DELAY_MS = 3_000;
const PRELOAD_TIMEOUT_MS = 15_000;

let state: PlayerState | null = null;
let playFingerprint = '';
let currentItemId: string | null = null;
let index = 0;
let activeLayer = 0;
let advanceTimer: number | null = null;
let playToken = 0;

// Random order modes: the agent ships the resolved pool + priority rules and
// the player shuffles locally so reshuffles never need a state update.
const LAST_MEDIA_KEY = 'signage.lastPlayedMediaId';
let engine: PlaybackQueueEngine | null = null;
let engineItems = new Map<string, PlayerStateItem>();
let currentPlay: QueueResult | null = null;

function isRandomMode(s: PlayerState): boolean {
  return s.playbackOrderMode === 'random' || s.playbackOrderMode === 'random_with_priority_rules';
}

function rebuildEngine(s: PlayerState): void {
  engineItems = new Map(s.items.map((item) => [item.id, item]));
  const rules = (s.playbackOrderMode === 'random_with_priority_rules' ? s.priorityRules : []).map(
    (rule) => {
      for (const item of rule.items) engineItems.set(item.id, item);
      return {
        id: rule.id,
        name: rule.name,
        intervalCount: rule.intervalCount,
        selectionMode: rule.selectionMode,
        position: rule.position,
        createdAt: rule.createdAt,
        entries: rule.items.map((item) => ({ id: item.id, mediaId: item.mediaId })),
      };
    },
  );
  // Remembering the last played media survives player reloads and reboots,
  // avoiding an obvious immediate repeat when a new cycle starts.
  let lastPlayed: string | null = null;
  try {
    lastPlayed = localStorage.getItem(LAST_MEDIA_KEY);
  } catch {
    // storage unavailable (e.g. incognito kiosk) — fine, start fresh
  }
  engine = new PlaybackQueueEngine({
    entries: s.items.map((item) => ({ id: item.id, mediaId: item.mediaId })),
    priorityRules: rules,
    lastPlayedMediaId: lastPlayed,
  });
  currentPlay = null;
}

function rememberLastPlayed(mediaId: string): void {
  try {
    localStorage.setItem(LAST_MEDIA_KEY, mediaId);
  } catch {
    // ignored
  }
}

function clearAdvanceTimer(): void {
  if (advanceTimer !== null) {
    window.clearTimeout(advanceTimer);
    advanceTimer = null;
  }
}

function fitClass(item: PlayerStateItem): string {
  return `fit-${item.fitMode}`;
}

function buildMediaElement(item: PlayerStateItem): Promise<HTMLImageElement | HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const url = `${mediaBase}${item.url}`;
    const timeout = window.setTimeout(
      () => reject(new Error('media load timeout')),
      PRELOAD_TIMEOUT_MS,
    );

    if (item.mediaType === 'image') {
      const img = document.createElement('img');
      img.className = fitClass(item);
      img.onload = () => {
        window.clearTimeout(timeout);
        resolve(img);
      };
      img.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('image failed to load'));
      };
      img.src = url;
    } else {
      const video = document.createElement('video');
      video.className = fitClass(item);
      // Muted autoplay is required for kiosk Chromium; audio is out of scope
      // for v1 but nothing here prevents unmuting later.
      video.muted = true;
      video.autoplay = false;
      video.playsInline = true;
      video.preload = 'auto';
      video.oncanplay = () => {
        window.clearTimeout(timeout);
        resolve(video);
      };
      video.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('video failed to load'));
      };
      video.src = url;
    }
  });
}

function swapToLayer(layer: number, element: HTMLElement): void {
  const next = layerEls[layer];
  const prev = layerEls[1 - layer];
  next.replaceChildren(element);
  next.classList.add('visible');
  prev.classList.remove('visible');
  window.setTimeout(() => {
    if (!next.classList.contains('visible')) return;
    prev.replaceChildren();
  }, 600);
}

function scheduleAdvance(seconds: number): void {
  clearAdvanceTimer();
  advanceTimer = window.setTimeout(() => advance('end'), Math.max(0.5, seconds) * 1000);
}

/** The item that should be on screen right now, for any order mode. */
function activeItem(): PlayerStateItem | null {
  if (!state) return null;
  if (isRandomMode(state)) {
    return currentPlay ? (engineItems.get(currentPlay.entry.id) ?? null) : null;
  }
  return state.items[index] ?? null;
}

function advance(reason: 'end' | 'error'): void {
  if (!state) return;

  if (isRandomMode(state)) {
    const item = activeItem();
    if (item && reason === 'end') {
      sendEvent('end', item, state.playlistId, undefined, currentPlay);
    }
    currentPlay = engine?.next() ?? null;
    if (!currentPlay) return;
    void showCurrent();
    return;
  }

  if (state.items.length === 0) return;
  const item = state.items[index];
  if (item && reason === 'end') sendEvent('end', item, state.playlistId);

  const last = index >= state.items.length - 1;
  if (last && !state.loop) {
    // Non-looping playlist finished: hold the final still frame; videos have
    // ended so for a video item we fall back to the info screen instead.
    clearAdvanceTimer();
    if (item?.mediaType === 'video') {
      playToken++;
      layerEls[activeLayer].classList.remove('visible');
      showFallback(true);
    }
    return;
  }
  index = last ? 0 : index + 1;
  void showCurrent();
}

async function showCurrent(): Promise<void> {
  if (!state) return;
  const item = activeItem();
  if (!item) return;
  const token = ++playToken;
  clearAdvanceTimer();
  currentItemId = item.id;
  const playlistId = state.playlistId;
  const play = isRandomMode(state) ? currentPlay : null;
  const single = !isRandomMode(state) && state.items.length === 1 && state.loop;

  let element: HTMLImageElement | HTMLVideoElement;
  try {
    element = await buildMediaElement(item);
  } catch (err) {
    if (token !== playToken) return;
    sendEvent(
      'error',
      item,
      playlistId,
      { error: err instanceof Error ? err.message : String(err) },
      play,
    );
    advanceTimer = window.setTimeout(() => advance('error'), ERROR_RETRY_DELAY_MS);
    return;
  }
  if (token !== playToken) return;

  activeLayer = 1 - activeLayer;
  swapToLayer(activeLayer, element);
  showFallback(false);
  sendEvent('start', item, playlistId, undefined, play);
  if (state && isRandomMode(state)) rememberLastPlayed(item.mediaId);

  if (element instanceof HTMLVideoElement) {
    if (single) {
      // One looping video: let the element loop natively, no re-decode churn.
      element.loop = true;
    } else {
      element.onended = () => {
        if (token === playToken) advance('end');
      };
    }
    element.onerror = () => {
      if (token !== playToken) return;
      sendEvent('error', item, playlistId, { error: 'video playback error' }, play);
      advanceTimer = window.setTimeout(() => advance('error'), ERROR_RETRY_DELAY_MS);
    };
    element.play().catch(() => {
      /* autoplay block should not happen with muted=true */
    });
    if (item.durationSeconds && item.durationSeconds > 0 && !single) {
      scheduleAdvance(item.durationSeconds);
    }
  } else if (!single) {
    scheduleAdvance(item.durationSeconds ?? DEFAULT_IMAGE_DURATION);
  }
}

// ------------------------------------------------------------ state intake

function contentFingerprint(s: PlayerState): string {
  return JSON.stringify([
    s.items.map((i) => [i.id, i.url, i.durationSeconds, i.fitMode]),
    s.loop,
    s.source,
    s.playbackOrderMode,
    (s.priorityRules ?? []).map((r) => [
      r.id,
      r.intervalCount,
      r.selectionMode,
      r.position,
      r.items.map((i) => i.id),
    ]),
  ]);
}

function hasPlayableContent(s: PlayerState): boolean {
  if (s.items.length > 0) return true;
  return isRandomMode(s) && (s.priorityRules ?? []).some((r) => r.items.length > 0);
}

function applyState(next: PlayerState): void {
  state = next;

  stage.classList.remove('portrait', 'inverted_portrait', 'inverted_landscape');
  if (next.orientation !== 'landscape') stage.classList.add(next.orientation);

  updateFallbackContent(next);
  offlineDot.classList.toggle('hidden', next.online || !hasPlayableContent(next));

  const fingerprint = contentFingerprint(next);
  if (fingerprint === playFingerprint) return;
  playFingerprint = fingerprint;

  if (!hasPlayableContent(next)) {
    playToken++;
    currentItemId = null;
    currentPlay = null;
    engine = null;
    clearAdvanceTimer();
    layerEls[0].classList.remove('visible');
    layerEls[1].classList.remove('visible');
    layerEls[0].replaceChildren();
    layerEls[1].replaceChildren();
    showFallback(true);
    return;
  }

  if (isRandomMode(next)) {
    // Content changed: build a fresh shuffle over the new pool and start it.
    rebuildEngine(next);
    currentPlay = engine?.next() ?? null;
    void showCurrent();
    return;
  }
  engine = null;
  currentPlay = null;

  // Keep playing the same item if it survived the update; otherwise restart.
  const keepIndex = currentItemId ? next.items.findIndex((i) => i.id === currentItemId) : -1;
  index = keepIndex >= 0 ? keepIndex : 0;
  if (keepIndex < 0) {
    void showCurrent();
  }
}

function showFallback(visible: boolean): void {
  fallbackEl.classList.toggle('hidden', !visible);
}

function updateFallbackContent(s: PlayerState): void {
  fbName.textContent = s.deviceName;
  fbMessage.textContent = s.statusMessage ?? '';
  fbPaired.textContent = s.paired ? 'Paired' : 'Not paired';
  fbPaired.className = `badge ${s.paired ? 'ok' : 'bad'}`;
  fbOnline.textContent = s.online ? 'Online' : 'Offline';
  fbOnline.className = `badge ${s.online ? 'ok' : 'bad'}`;
}

window.setInterval(() => {
  fbClock.textContent = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}, 1000);

// --------------------------------------------------------------- identify

let identifyTimer: number | null = null;

function showIdentify(deviceName: string, durationSeconds: number): void {
  identifyEl.textContent = deviceName;
  identifyEl.classList.remove('hidden');
  if (identifyTimer !== null) window.clearTimeout(identifyTimer);
  identifyTimer = window.setTimeout(() => {
    identifyEl.classList.add('hidden');
    identifyTimer = null;
  }, durationSeconds * 1000);
}

// ------------------------------------------------------------- agent link

function connect(): void {
  socket = new WebSocket(wsUrl);
  socket.onopen = () => send({ type: 'player_ready' });
  socket.onmessage = (event) => {
    let message: AgentToPlayerMessage;
    try {
      message = JSON.parse(String(event.data)) as AgentToPlayerMessage;
    } catch {
      return;
    }
    if (message.type === 'state') {
      applyState(message.state);
    } else if (message.type === 'identify') {
      showIdentify(message.deviceName, message.durationSeconds);
    }
  };
  socket.onclose = () => {
    socket = null;
    window.setTimeout(connect, 2000);
  };
  socket.onerror = () => {
    socket?.close();
  };
}

showFallback(true);
fbMessage.textContent = 'Connecting to signage agent…';
connect();
