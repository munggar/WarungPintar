import { BrowserMultiFormatReader } from '@zxing/browser';

export async function startFallbackScanner(video, onDetected, onFailure) {
  const reader = new BrowserMultiFormatReader();
  const controls = await reader.decodeFromVideoElement(video, (result, error) => {
    if (result) onDetected(result.getText());
    else if (error && error.name !== 'NotFoundException') onFailure(error);
  });
  return () => controls.stop();
}
