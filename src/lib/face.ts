import * as faceapi from "@vladmandic/face-api";

const MODEL_URI = "/models/face";
const MATCH_THRESHOLD = 0.5;

let modelsReady = false;

export async function loadFaceModels(): Promise<void> {
  if (modelsReady) return;
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URI),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URI),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URI),
  ]);
  modelsReady = true;
}

export async function detectFaces(input: HTMLVideoElement) {
  return faceapi
    .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
}

export async function captureOwnerDescriptor(video: HTMLVideoElement): Promise<number[]> {
  await loadFaceModels();
  const samples: Float32Array[] = [];

  for (let i = 0; i < 8 && samples.length < 5; i += 1) {
    const detections = await detectFaces(video);
    if (detections.length === 1) {
      samples.push(detections[0].descriptor);
    }
    await wait(180);
  }

  if (samples.length < 3) {
    throw new Error("没有稳定检测到一张人脸，请正对摄像头后重试");
  }

  return Array.from(averageDescriptors(samples));
}

export function faceShouldHide(
  detections: faceapi.WithFaceDescriptor<
    faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }, faceapi.FaceLandmarks68>
  >[],
  owner: number[] | null,
): boolean {
  if (!owner || detections.length === 0) return false;
  if (detections.length >= 2) return true;

  const ownerDesc = new Float32Array(owner);
  const distance = faceapi.euclideanDistance(detections[0].descriptor, ownerDesc);
  return distance > MATCH_THRESHOLD;
}

function averageDescriptors(descriptors: Float32Array[]): Float32Array {
  const length = descriptors[0].length;
  const acc = new Float32Array(length);
  for (const item of descriptors) {
    for (let i = 0; i < length; i += 1) acc[i] += item[i];
  }
  for (let i = 0; i < length; i += 1) acc[i] /= descriptors.length;
  return acc;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
