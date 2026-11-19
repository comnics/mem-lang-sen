// Shared by the upload service and both Storage provisioning entrypoints.
// Preserve the browser's Content-Type (including the MP3 alias); do not relabel bytes.
export const AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg'] as const;
export const MAX_AUDIO_SIZE = 10 * 1024 * 1024;

export function audioBucketOptions() {
  return { public: false, fileSizeLimit: MAX_AUDIO_SIZE, allowedMimeTypes: [...AUDIO_MIME_TYPES] };
}
