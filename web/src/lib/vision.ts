import { FaceLandmarker, FilesetResolver, HandLandmarker, type NormalizedLandmark, PoseLandmarker } from "@mediapipe/tasks-vision";
import { realHands } from "./body";
import { buildFrame } from "./frame";
import type { FramePayload } from "./protocol";

/** Cara (malla completa, 478 puntos) y cuerpo (pose, 33 puntos con visibilidad), normalizados 0..1 y sin espejo. */
export interface BodyPoints {
  face: NormalizedLandmark[] | null;
  pose: NormalizedLandmark[] | null;
}

export interface Vision {
  detect(video: HTMLVideoElement, tsMs: number, gloves: FramePayload["gloves"]): FramePayload;
  lastHands(): { x: number; y: number; z: number }[][];
  /** Última cara y pose. Objeto nuevo solo cuando alguna cambia: quien dibuja compara por referencia. */
  lastBody(): BodyPoints;
  close(): void;
}

export type Delegate = "GPU" | "CPU";

/** `delegate` "GPU" por defecto; si su inicialización falla, quien llama puede reintentar con "CPU". */
export async function createVision(base = "/mediapipe", delegate: Delegate = "GPU"): Promise<Vision> {
  const fs = await FilesetResolver.forVisionTasks(`${base}/wasm`);
  const opts = (name: string) => ({ baseOptions: { modelAssetPath: `${base}/${name}.task`, delegate }, runningMode: "VIDEO" as const });
  const created: { close(): void }[] = [];
  const track = <T extends { close(): void }>(t: T): T => (created.push(t), t);
  let hands: HandLandmarker, pose: PoseLandmarker, face: FaceLandmarker;
  try {
    hands = track(await HandLandmarker.createFromOptions(fs, { ...opts("hand_landmarker"), numHands: 2, minHandDetectionConfidence: 0.3, minHandPresenceConfidence: 0.3, minTrackingConfidence: 0.3 }));
    pose = track(await PoseLandmarker.createFromOptions(fs, { ...opts("pose_landmarker_full"), minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3 }));
    face = track(await FaceLandmarker.createFromOptions(fs, { ...opts("face_landmarker"), numFaces: 1 }));
  } catch (err) {
    // No dejar modelos a medio crear si falla uno (p. ej. GPU no disponible): quien llama reintenta con CPU.
    created.forEach((c) => { try { c.close(); } catch { /* ya cerrado */ } });
    throw err;
  }
  let n = 0;
  let lastPose: NormalizedLandmark[] | null = null;
  let lastFace: NormalizedLandmark[] | null = null;
  let lastHands: { x: number; y: number; z: number }[][] = [];
  let lastBody: BodyPoints = { face: null, pose: null };
  return {
    detect(video, tsMs, gloves) {
      const h = hands.detectForVideo(video, tsMs);
      if (n % 2 === 0) lastPose = pose.detectForVideo(video, tsMs).landmarks[0] ?? null;
      if (n % 3 === 0) lastFace = face.detectForVideo(video, tsMs).faceLandmarks[0] ?? null;
      n++;
      if (lastBody.pose !== lastPose || lastBody.face !== lastFace) lastBody = { face: lastFace, pose: lastPose };
      // Sin las "manos" que en realidad son la cara, el cuello o la ropa (no llegan al servidor ni al alfabeto).
      const w = video.videoWidth, vh = video.videoHeight;
      lastHands = realHands(h.landmarks, lastPose, lastFace, w, vh);
      return buildFrame({ w, h: vh, hands: lastHands, pose: lastPose, face: lastFace, gloves, t: tsMs });
    },
    lastHands: () => lastHands,
    lastBody: () => lastBody,
    close() { hands.close(); pose.close(); face.close(); },
  };
}
