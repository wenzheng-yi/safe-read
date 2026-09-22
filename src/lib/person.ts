import * as tf from "@tensorflow/tfjs";
import type * as cocoSsd from "@tensorflow-models/coco-ssd";

let model: cocoSsd.ObjectDetection | null = null;
let loading: Promise<cocoSsd.ObjectDetection> | null = null;

async function getModel(): Promise<cocoSsd.ObjectDetection> {
  if (model) return model;
  if (!loading) {
    loading = (async () => {
      await tf.ready();
      const coco = await import("@tensorflow-models/coco-ssd");
      model = await coco.load({
        base: "lite_mobilenet_v2",
        modelUrl: "/models/coco-ssd/model.json",
      });
      return model;
    })();
  }
  return loading;
}

export async function loadPersonModel(): Promise<void> {
  await getModel();
}

export async function countNearbyPeople(video: HTMLVideoElement): Promise<number> {
  if (video.readyState < 2 || video.videoWidth === 0) return 0;
  const detector = await getModel();
  const predictions = await detector.detect(video, 6);
  const frameArea = video.videoWidth * video.videoHeight;
  const minArea = frameArea * 0.04;

  return predictions.filter((item) => {
    if (item.class !== "person" || item.score < 0.45) return false;
    const [, , width, height] = item.bbox;
    return width * height >= minArea;
  }).length;
}
