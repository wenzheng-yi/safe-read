import { invoke } from "@tauri-apps/api/core";
import type { ReaderBounds } from "./settings";

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.includes("://")) return trimmed;
  return `https://${trimmed}`;
}

export async function openReader(
  url: string,
  readerBounds?: ReaderBounds | null,
): Promise<void> {
  await invoke("open_reader", {
    url: normalizeUrl(url),
    readerBounds: readerBounds ?? null,
  });
}

export async function hideApp(): Promise<void> {
  await invoke("hide_app");
}

export async function restoreApp(): Promise<void> {
  await invoke("restore_app");
}

export async function showSettingsWindow(): Promise<void> {
  await invoke("show_settings");
}

export async function setReaderTitle(title: string): Promise<void> {
  await invoke("set_reader_title", { title });
}
