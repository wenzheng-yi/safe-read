import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { captureOwnerDescriptor, loadFaceModels } from "./lib/face";
import { startCamera, stopCamera } from "./lib/camera";
import {
  createMonitor,
  formatDetectionLine,
  type MonitorStatus,
} from "./lib/monitor";
import { openReader } from "./lib/reader";
import { loadPersonModel } from "./lib/person";
import {
  isReady,
  loadSettings,
  saveSettings,
  type ReaderBounds,
  type Settings,
} from "./lib/settings";
import "./App.css";

type Step = "loading" | "enroll" | "url" | "ready";

const EMPTY_STATUS: MonitorStatus = {
  running: false,
  hiding: false,
  minimized: false,
  unfocused: false,
  faces: 0,
  people: 0,
  faceMatch: "none",
  error: null,
};

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewStream = useRef<MediaStream | null>(null);
  const monitorRef = useRef<ReturnType<typeof createMonitor> | null>(null);
  const ownerRef = useRef<number[] | null>(null);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [step, setStep] = useState<Step>("loading");
  const [urlDraft, setUrlDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<MonitorStatus>(EMPTY_STATUS);
  const [modelsLoaded, setModelsLoaded] = useState(false);

  const enrolled = Boolean(settings?.faceDescriptor?.length);

  const statusText = useMemo(() => {
    if (status.error) return `检测异常：${status.error}`;
    if (status.hiding) return "已隐藏，等待 Ctrl+Shift+S 或托盘恢复";
    if (status.minimized) return "阅读窗口已最小化，监控已暂停";
    if (status.unfocused) return "阅读窗口不在前台，监控已暂停";
    if (status.running) {
      return `监控中 · ${formatDetectionLine(status)}`;
    }
    return modelsLoaded ? "模型已就绪" : "正在加载检测模型";
  }, [modelsLoaded, status]);

  useEffect(() => {
    const monitor = createMonitor({
      getOwner: () => ownerRef.current,
      onStatus: setStatus,
    });
    monitorRef.current = monitor;
    void monitor.attachEvents();

    let unlistenClosed: (() => void) | undefined;
    void listen<{ url: string; bounds: ReaderBounds | null }>("reader-closed", (event) => {
      const url = event.payload?.url?.trim();
      const bounds = event.payload?.bounds ?? null;
      const patch: Partial<Settings> = {};
      if (url && url !== "about:blank") {
        patch.pageUrl = url;
      }
      if (bounds) {
        patch.readerBounds = bounds;
      }
      if (Object.keys(patch).length === 0) return;
      void saveSettings(patch).then((next) => {
        setSettings(next);
        setUrlDraft(next.pageUrl);
      });
    }).then((unlisten) => {
      unlistenClosed = unlisten;
    });

    void (async () => {
      const loaded = await loadSettings();
      ownerRef.current = loaded.faceDescriptor;
      setSettings(loaded);
      setUrlDraft(loaded.pageUrl);
      setStep(isReady(loaded) ? "ready" : loaded.faceDescriptor ? "url" : "enroll");
      try {
        await Promise.all([loadFaceModels(), loadPersonModel()]);
        setModelsLoaded(true);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    })().catch((error) => {
      setSettings({
        pageUrl: "",
        faceDescriptor: null,
        shortcut: "Ctrl+Shift+S",
        readerBounds: null,
      });
      setStep("enroll");
      setMessage(error instanceof Error ? error.message : String(error));
    });

    return () => {
      unlistenClosed?.();
      monitor.dispose();
      stopCamera(previewStream.current);
    };
  }, []);

  useEffect(() => {
    if (step !== "enroll") {
      stopCamera(previewStream.current);
      previewStream.current = null;
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    void (async () => {
      try {
        const stream = await startCamera(video);
        if (cancelled) {
          stopCamera(stream);
          return;
        }
        previewStream.current = stream;
      } catch (error) {
        setMessage(
          error instanceof Error
            ? `无法打开摄像头：${error.message}`
            : "无法打开摄像头",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step]);

  async function handleEnroll() {
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    setMessage("正在采集人脸，请正对摄像头…");
    try {
      const descriptor = await captureOwnerDescriptor(video);
      const next = await saveSettings({ faceDescriptor: descriptor });
      ownerRef.current = descriptor;
      setSettings(next);
      setStep("url");
      setMessage("人脸已保存到本地。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveUrl(openAfterSave: boolean) {
    if (!urlDraft.trim()) {
      setMessage("请先填写网页地址。");
      return;
    }
    setBusy(true);
    try {
      const next = await saveSettings({ pageUrl: urlDraft.trim() });
      setSettings(next);
      setStep("ready");
      setMessage("网页地址已保存。");
      if (openAfterSave) {
        await handleOpen(next.pageUrl);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen(url = settings?.pageUrl) {
    if (!url?.trim()) {
      setMessage("请先填写网页地址。");
      return;
    }
    if (!ownerRef.current) {
      setMessage("请先录入人脸。");
      setStep("enroll");
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    setMessage(null);
    try {
      await openReader(url, settings?.readerBounds);
      await monitorRef.current?.start(video);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <header className="hero">
        <p className="eyebrow">本地隐私阅读</p>
        <h1>SafeRead</h1>
        <p className="lead">
          录入本人人脸后打开网页。检测到第二个人靠近、或出现非本人面孔时，窗口会立刻隐藏。
        </p>
      </header>

      <section className="panel">
        <ol className="steps">
          <li className={step === "enroll" ? "active" : enrolled ? "done" : ""}>
            1. 录入人脸
          </li>
          <li className={step === "url" ? "active" : settings?.pageUrl ? "done" : ""}>
            2. 设置网页
          </li>
          <li className={step === "ready" ? "active" : ""}>3. 开始阅读</li>
        </ol>

        <div className="video-wrap">
          <video ref={videoRef} autoPlay muted playsInline />
          <span className={`badge ${status.running ? "live" : ""}`}>
            {status.running ? "摄像头监控中" : "摄像头待机"}
          </span>
        </div>
        <p className="status">{statusText}</p>

        {step === "loading" && <p className="hint">正在读取本地设置并加载检测模型…</p>}

        {step === "enroll" && (
          <div className="stack">
            <p className="hint">请保证只有你自己在画面中，正对镜头后点击录入。</p>
            <button disabled={busy || !modelsLoaded} onClick={() => void handleEnroll()}>
              {busy ? "正在录入…" : enrolled ? "重新录入人脸" : "录入人脸"}
            </button>
            {enrolled && (
              <button className="ghost" disabled={busy} onClick={() => setStep("url")}>
                已录入，下一步
              </button>
            )}
          </div>
        )}

        {step === "url" && (
          <div className="stack">
            <label htmlFor="page-url">阅读网页地址</label>
            <input
              id="page-url"
              value={urlDraft}
              placeholder="https://example.com"
              onChange={(event) => setUrlDraft(event.target.value)}
            />
            <button disabled={busy} onClick={() => void handleSaveUrl(true)}>
              保存并打开网页
            </button>
            <button className="ghost" disabled={busy} onClick={() => setStep("enroll")}>
              返回重新录入
            </button>
          </div>
        )}

        {step === "ready" && (
          <div className="stack">
            <label htmlFor="page-url-ready">阅读网页地址</label>
            <input
              id="page-url-ready"
              value={urlDraft}
              placeholder="https://example.com"
              onChange={(event) => setUrlDraft(event.target.value)}
            />
            <button disabled={busy || !modelsLoaded} onClick={() => void handleSaveUrl(true)}>
              {status.running ? "重新打开网页" : "打开网页并开始监控"}
            </button>
            <div className="actions">
              <button className="ghost" disabled={busy} onClick={() => setStep("enroll")}>
                重新录入人脸
              </button>
              <button className="ghost" disabled={busy} onClick={() => setStep("url")}>
                只改地址
              </button>
            </div>
            <p className="hint">
              隐藏后用快捷键 Ctrl+Shift+S，或点击托盘图标恢复。关闭阅读窗口会回到本设置页。
            </p>
          </div>
        )}

        {message && <p className="message">{message}</p>}
      </section>
    </div>
  );
}

export default App;
