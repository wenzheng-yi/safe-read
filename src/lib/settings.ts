import { LazyStore } from "@tauri-apps/plugin-store";

export type Settings = {
  pageUrl: string;
  faceDescriptor: number[] | null;
  shortcut: string;
};

const DEFAULTS: Settings = {
  pageUrl: "",
  faceDescriptor: null,
  shortcut: "Ctrl+Shift+S",
};

const store = new LazyStore("settings.json");

export async function loadSettings(): Promise<Settings> {
  const pageUrl = (await store.get<string>("pageUrl")) ?? DEFAULTS.pageUrl;
  const faceDescriptor =
    (await store.get<number[]>("faceDescriptor")) ?? DEFAULTS.faceDescriptor;
  const shortcut = (await store.get<string>("shortcut")) ?? DEFAULTS.shortcut;
  return { pageUrl, faceDescriptor, shortcut };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await store.set("pageUrl", next.pageUrl);
  await store.set("faceDescriptor", next.faceDescriptor);
  await store.set("shortcut", next.shortcut);
  await store.save();
  return next;
}

export function isReady(settings: Settings): boolean {
  return Boolean(settings.pageUrl.trim() && settings.faceDescriptor?.length);
}
