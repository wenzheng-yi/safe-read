import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function copyFaceModels() {
  const src = join(root, "node_modules/@vladmandic/face-api/model");
  const dest = join(root, "public/models/face");
  if (!existsSync(src)) {
    console.warn("face-api models not found, skip copy");
    return;
  }
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log("copied face-api models to public/models/face");
}

async function downloadCocoSsd() {
  const dest = join(root, "public/models/coco-ssd");
  const modelJsonPath = join(dest, "model.json");
  if (existsSync(modelJsonPath)) {
    console.log("coco-ssd model already present");
    return;
  }

  const base = "https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/";
  mkdirSync(dest, { recursive: true });
  const modelJson = await (await fetch(`${base}model.json`)).json();
  writeFileSync(modelJsonPath, JSON.stringify(modelJson));

  const files = new Set();
  for (const group of modelJson.weightsManifest ?? []) {
    for (const path of group.paths ?? []) files.add(path);
  }
  for (const file of files) {
    const res = await fetch(`${base}${file}`);
    if (!res.ok) throw new Error(`failed to download ${file}: ${res.status}`);
    writeFileSync(join(dest, file), Buffer.from(await res.arrayBuffer()));
    console.log(`downloaded ${file}`);
  }
  console.log("coco-ssd model saved to public/models/coco-ssd");
}

copyFaceModels();
await downloadCocoSsd();
