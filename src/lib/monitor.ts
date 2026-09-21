import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { startCamera, stopCamera } from "./camera";
import {
  classifyFaces,
  detectFaces,
  loadFaceModels,
  type FaceMatch,
} from "./face";
import { hideApp, setReaderTitle } from "./reader";
import { countNearbyPeople, loadPersonModel } from "./person";

const INTERVAL_MS = 280;
const HIT_FRAMES = 2;
const TITLE_PREFIX = "SafeRead";

export type MonitorStatus = {
  running: boolean;
  hiding: boolean;
  minimized: boolean;
  unfocused: boolean;
  faces: number;
  people: number;
  faceMatch: FaceMatch;
  error: string | null;
};

export function formatDetectionLine(status: MonitorStatus): string {
  const face =
    status.faceMatch === "owner"
      ? `人脸 ${status.faces}（本人）`
      : status.faceMatch === "stranger"
        ? `人脸 ${status.faces}（非本人）`
        : status.faceMatch === "multiple"
          ? `人脸 ${status.faces}（多人）`
          : `人脸 ${status.faces}`;
  const people = `人体 ${status.people}`;
  const other =
    status.people >= 2 || status.faceMatch === "multiple"
      ? "出现其他人"
      : status.faceMatch === "stranger"
        ? "出现非本人"
        : null;
  return other ? `${face} · ${people} · ${other}` : `${face} · ${people}`;
}

export function formatReaderTitle(status: MonitorStatus): string {
  if (status.error) return `${TITLE_PREFIX}  ·  检测异常`;
  if (status.hiding) return `${TITLE_PREFIX}  ·  ${formatDetectionLine(status)}  ·  已隐藏`;
  if (status.minimized || status.unfocused) return `${TITLE_PREFIX}  ·  监控已暂停`;
  if (!status.running) return TITLE_PREFIX;
  return `${TITLE_PREFIX}  ·  ${formatDetectionLine(status)}`;
}

type Options = {
  getOwner: () => number[] | null;
  onStatus: (status: MonitorStatus) => void;
};

export function createMonitor(options: Options) {
  let timer: number | null = null;
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let hits = 0;
  let hiding = false;
  let minimized = false;
  let unfocused = false;
  let running = false;
  let unlistenHidden: UnlistenFn | null = null;
  let unlistenPrivacyRestored: UnlistenFn | null = null;
  let unlistenMinimized: UnlistenFn | null = null;
  let unlistenWindowRestored: UnlistenFn | null = null;
  let unlistenBlurred: UnlistenFn | null = null;
  let unlistenFocused: UnlistenFn | null = null;
  let unlistenClosed: UnlistenFn | null = null;

  let last: MonitorStatus = {
    running: false,
    hiding: false,
    minimized: false,
    unfocused: false,
    faces: 0,
    people: 0,
    faceMatch: "none",
    error: null,
  };
  let lastTitle = TITLE_PREFIX;

  const emit = (patch: Partial<MonitorStatus>) => {
    last = { ...last, ...patch };
    options.onStatus(last);
    const title = formatReaderTitle(last);
    if (title === lastTitle) return;
    lastTitle = title;
    void setReaderTitle(title);
  };

  let ticking = false;

  function canRun() {
    return !hiding && !minimized && !unfocused;
  }

  async function tick() {
    if (!running || !canRun() || !video || ticking) return;
    ticking = true;
    try {
      const [detections, people] = await Promise.all([
        detectFaces(video),
        countNearbyPeople(video),
      ]);
      const faceMatch = classifyFaces(detections, options.getOwner());
      const danger =
        people >= 2 || faceMatch === "stranger" || faceMatch === "multiple";
      if (danger) {
        hits += 1;
      } else {
        hits = 0;
      }
      emit({ faces: detections.length, people, faceMatch, error: null });
      if (hits >= HIT_FRAMES) {
        hits = 0;
        hiding = true;
        running = false;
        stopLoop();
        stopCamera(stream);
        stream = null;
        await hideApp();
        emit({
          running: false,
          hiding: true,
          faces: detections.length,
          people,
          faceMatch,
        });
      }
    } catch (error) {
      emit({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      ticking = false;
    }
  }

  function stopLoop() {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function pauseCamera() {
    running = false;
    stopLoop();
    stopCamera(stream);
    stream = null;
    emit({
      running: false,
      hiding,
      minimized,
      unfocused,
    });
  }

  async function start(target: HTMLVideoElement) {
    video = target;
    await Promise.all([loadFaceModels(), loadPersonModel()]);
    stopCamera(stream);
    stream = await startCamera(target);
    running = true;
    hiding = false;
    minimized = false;
    unfocused = false;
    hits = 0;
    stopLoop();
    timer = window.setInterval(() => {
      void tick();
    }, INTERVAL_MS);
    emit({
      running: true,
      hiding: false,
      minimized: false,
      unfocused: false,
      faces: 0,
      people: 0,
      faceMatch: "none",
      error: null,
    });
  }

  async function pauseForHide() {
    hiding = true;
    pauseCamera();
  }

  async function pauseForMinimize() {
    if (hiding) return;
    minimized = true;
    if (running) pauseCamera();
    else emit({ minimized: true, running: false });
  }

  async function pauseForBlur() {
    if (hiding || minimized) return;
    unfocused = true;
    if (running) pauseCamera();
    else emit({ unfocused: true, running: false });
  }

  async function tryResume() {
    if (!video || !canRun()) {
      emit({ running: false, hiding, minimized, unfocused });
      return;
    }
    await start(video);
  }

  async function resume() {
    if (!video) return;
    hiding = false;
    minimized = false;
    unfocused = false;
    await start(video);
  }

  async function resumeFromMinimize() {
    if (hiding) return;
    minimized = false;
    await tryResume();
  }

  async function resumeFromFocus() {
    if (hiding || minimized) return;
    unfocused = false;
    await tryResume();
  }

  async function stop() {
    running = false;
    hiding = false;
    minimized = false;
    unfocused = false;
    stopLoop();
    stopCamera(stream);
    stream = null;
    emit({
      running: false,
      hiding: false,
      minimized: false,
      unfocused: false,
      faces: 0,
      people: 0,
      faceMatch: "none",
      error: null,
    });
  }

  async function attachEvents() {
    unlistenHidden = await listen("privacy-hidden", () => {
      void pauseForHide();
    });
    unlistenPrivacyRestored = await listen("privacy-restored", () => {
      void resume();
    });
    unlistenMinimized = await listen("reader-minimized", () => {
      void pauseForMinimize();
    });
    unlistenWindowRestored = await listen("reader-restored", () => {
      void resumeFromMinimize();
    });
    unlistenBlurred = await listen("reader-blurred", () => {
      void pauseForBlur();
    });
    unlistenFocused = await listen("reader-focused", () => {
      void resumeFromFocus();
    });
    unlistenClosed = await listen<string>("reader-closed", () => {
      void stop();
    });
  }

  function dispose() {
    void stop();
    unlistenHidden?.();
    unlistenPrivacyRestored?.();
    unlistenMinimized?.();
    unlistenWindowRestored?.();
    unlistenBlurred?.();
    unlistenFocused?.();
    unlistenClosed?.();
  }

  return { start, stop, resume, dispose, attachEvents };
}
