import { LazyStore } from "@tauri-apps/plugin-store";

export type ReaderBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
};

export type Settings = {
  pageUrl: string;
  faceDescriptor: number[] | null;
  shortcut: string;
  readerBounds: ReaderBounds | null;
};

const DEFAULTS: Settings = {
  pageUrl: "",
  faceDescriptor: null,
  shortcut: "Ctrl+Shift+S",
  readerBounds: null,
};

const store = new LazyStore("settings.json");

export async function loadSettings(): Promise<Settings> {
  const pageUrl = (await store.get<string>("pageUrl")) ?? DEFAULTS.pageUrl;
  const faceDescriptor =
    (await store.get<number[]>("faceDescriptor")) ?? DEFAULTS.faceDescriptor;
  const shortcut = (await store.get<string>("shortcut")) ?? DEFAULTS.shortcut;
  const readerBounds =
    (await store.get<ReaderBounds>("readerBounds")) ?? DEFAULTS.readerBounds;
  return { pageUrl, faceDescriptor, shortcut, readerBounds };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await store.set("pageUrl", next.pageUrl);
  await store.set("faceDescriptor", next.faceDescriptor);
  await store.set("shortcut", next.shortcut);
  await store.set("readerBounds", next.readerBounds);
  await store.save();
  return next;
}

export function isReady(settings: Settings): boolean {
  return Boolean(settings.pageUrl.trim() && settings.faceDescriptor?.length);
}
