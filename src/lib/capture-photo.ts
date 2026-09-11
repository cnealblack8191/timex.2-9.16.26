/**
 * Takes a single small snapshot from the front camera.
 * Returns null whenever the camera is missing, blocked or slow — a punch is
 * never blocked by the photo.
 */
export async function capturePunchPhoto(): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    await video.play();

    // give the sensor a moment to expose
    await new Promise((resolve) => setTimeout(resolve, 350));

    const width = 480;
    const ratio = video.videoHeight && video.videoWidth ? video.videoHeight / video.videoWidth : 0.75;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.round(width * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause();
    video.srcObject = null;
    // heavy compression keeps mobile data use tiny
    return canvas.toDataURL("image/jpeg", 0.45);
  } catch {
    return null;
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}
