import { FaceLandmarker, FilesetResolver, HandLandmarker, type NormalizedLandmark, PoseLandmarker } from "@mediapipe/tasks-vision";
import { buildFrame } from "./frame";
import type { FramePayload } from "./protocol";

export interface Vision {
  detect(video: HTMLVideoElement, tsMs: number, gloves: FramePayload["gloves"]): FramePayload;
  lastHands(): { x: number; y: number; z: number }[][];
  close(): void;
}

export async function createVision(base = "/mediapipe"): Promise<Vision> {
  const fs = await FilesetResolver.forVisionTasks(`${base}/wasm`);
  const opts = (name: string) => ({ baseOptions: { modelAssetPath: `${base}/${name}.task`, delegate: "GPU" as const }, runningMode: "VIDEO" as const });
  const hands = await HandLandmarker.createFromOptions(fs, { ...opts("hand_landmarker"), numHands: 2, minHandDetectionConfidence: 0.3, minHandPresenceConfidence: 0.3, minTrackingConfidence: 0.3 });
  const pose = await PoseLandmarker.createFromOptions(fs, { ...opts("pose_landmarker_full"), minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3 });
  const face = await FaceLandmarker.createFromOptions(fs, { ...opts("face_landmarker"), numFaces: 1 });
  let n = 0;
  let lastPose: NormalizedLandmark[] | null = null;
  let lastFace: NormalizedLandmark[] | null = null;
  let lastHands: { x: number; y: number; z: number }[][] = [];
  return {
    detect(video, tsMs, gloves) {
      const h = hands.detectForVideo(video, tsMs);
      lastHands = h.landmarks;
      if (n % 2 === 0) lastPose = pose.detectForVideo(video, tsMs).landmarks[0] ?? null;
      if (n % 3 === 0) lastFace = face.detectForVideo(video, tsMs).faceLandmarks[0] ?? null;
      n++;
      return buildFrame({ w: video.videoWidth, h: video.videoHeight, hands: h.landmarks, pose: lastPose, face: lastFace, gloves });
    },
    lastHands: () => lastHands,
    close() { hands.close(); pose.close(); face.close(); },
  };
}
