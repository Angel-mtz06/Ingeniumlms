import urllib.request

from lsm.paths import MP_MODELS

URLS = {
    "hand_landmarker.task": "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    "pose_landmarker_full.task": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
    "pose_landmarker_heavy.task": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
    "face_landmarker.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
}

if __name__ == "__main__":
    MP_MODELS.mkdir(parents=True, exist_ok=True)
    for name, url in URLS.items():
        dst = MP_MODELS / name
        if not dst.exists():
            urllib.request.urlretrieve(url, dst)
        print(name, dst.stat().st_size // 1024, "KB")
