import type {
  AgentToPlayerMessage,
  PlayerState,
  PlayerStateItem,
  PlayerToAgentMessage,
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
): void {
  send({
    type: 'playback_event',
    eventType,
    itemId: item.id,
    mediaId: item.mediaId,
    playlistId,
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

function advance(reason: 'end' | 'error'): void {
  if (!state || state.items.length === 0) return;
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
  if (!state || state.items.length === 0) return;
  const token = ++playToken;
  clearAdvanceTimer();
  const item = state.items[index];
  currentItemId = item.id;
  const playlistId = state.playlistId;
  const single = state.items.length === 1 && state.loop;

  let element: HTMLImageElement | HTMLVideoElement;
  try {
    element = await buildMediaElement(item);
  } catch (err) {
    if (token !== playToken) return;
    sendEvent('error', item, playlistId, {
      error: err instanceof Error ? err.message : String(err),
    });
    advanceTimer = window.setTimeout(() => advance('error'), ERROR_RETRY_DELAY_MS);
    return;
  }
  if (token !== playToken) return;

  activeLayer = 1 - activeLayer;
  swapToLayer(activeLayer, element);
  showFallback(false);
  sendEvent('start', item, playlistId);

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
      sendEvent('error', item, playlistId, { error: 'video playback error' });
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
  ]);
}

function applyState(next: PlayerState): void {
  state = next;

  stage.classList.remove('portrait', 'inverted_portrait', 'inverted_landscape');
  if (next.orientation !== 'landscape') stage.classList.add(next.orientation);

  updateFallbackContent(next);
  offlineDot.classList.toggle('hidden', next.online || next.items.length === 0);

  const fingerprint = contentFingerprint(next);
  if (fingerprint === playFingerprint) return;
  playFingerprint = fingerprint;

  if (next.items.length === 0) {
    playToken++;
    currentItemId = null;
    clearAdvanceTimer();
    layerEls[0].classList.remove('visible');
    layerEls[1].classList.remove('visible');
    layerEls[0].replaceChildren();
    layerEls[1].replaceChildren();
    showFallback(true);
    return;
  }

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
