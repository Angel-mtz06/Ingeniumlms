import { cpSync, existsSync, mkdirSync } from "node:fs";

const dst = "public/mediapipe";
mkdirSync(`${dst}/wasm`, { recursive: true });
cpSync("node_modules/@mediapipe/tasks-vision/wasm", `${dst}/wasm`, { recursive: true });
for (const m of ["hand_landmarker", "pose_landmarker_full", "face_landmarker"]) {
  const src = `../models/mediapipe/${m}.task`;
  if (existsSync(src)) cpSync(src, `${dst}/${m}.task`);
  else console.warn(`falta ${src}: ejecuta training/download_models.py`);
}
