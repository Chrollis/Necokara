//
// whisper-types.ts — shared whisper data types (main + renderer)
// The onnx whisper implementation was replaced by the Python backend
// (stable-ts); these types describe the timestamped segments the main
// process hands back to the renderer.
//

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}
