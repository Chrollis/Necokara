import { useState, useMemo, useEffect, useCallback } from 'react';
import '@mdi/font/css/materialdesignicons.css';
import './shared-components.css';
import './App.css';
import LyricsEditor from '../features/editor/LyricsEditor';
import TimingView from '../features/timing/TimingView';
import TopBar from './TopBar';
import { UndoManager } from '../shared/undo-manager';
import { useSnackBar } from './SnackBar';
import { Lyrics } from '../editor/lyrics';
import {
  createUnsetWord,
  createSpaceWord,
  createNewlineWord,
} from '../editor/word';
import { createTimingState } from '../timing/state';
import AudioEngine from '../features/timing/AudioEngine';

function useDemoLyrics() {
  return useMemo(() => {
    const lyrics = new Lyrics();

    // |Hello| |World| \n|
    lyrics.words.push(createUnsetWord('Hello'));
    lyrics.words.push(createSpaceWord());
    lyrics.words.push(createUnsetWord('World'));
    lyrics.words.push(createNewlineWord());

    // |あ|た|し|は|ネ|コ|カ|ラ|な|の|にゃ|\n|
    const kana = 'あたしはネコカラなの';
    for (let i = 0; i < kana.length; i += 1) {
      lyrics.words.push(createUnsetWord(kana[i]));
    }
    lyrics.words.push(createUnsetWord('にゃ'));
    lyrics.words.push(createNewlineWord());

    return lyrics;
  }, []);
}

export default function App() {
  const lyrics = useDemoLyrics();
  const [currentView, setCurrentView] = useState<'editor' | 'timing'>('editor');
  const [renderVersion, setRenderVersion] = useState(0);
  const [undoManager] = useState(() => new UndoManager());
  const [snack, snackNode] = useSnackBar();
  const [timingState, setTimingState] = useState(() => createTimingState());
  const [audioEngine, setAudioEngine] = useState<AudioEngine | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioFileName, setAudioFileName] = useState('');

  const handleLyricsChange = useCallback(() => {
    setRenderVersion((v) => v + 1);
  }, []);

  const handleAudioChange = useCallback((engine: AudioEngine | null, durationSec: number, fileName: string) => {
    setAudioEngine(engine);
    setAudioDuration(durationSec * 1000); // convert to ms
    setAudioFileName(fileName);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoManager.undo(lyrics);
        setRenderVersion((v) => v + 1);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        undoManager.redo(lyrics);
        setRenderVersion((v) => v + 1);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [lyrics, undoManager]);

  return (
    <div className="app-root">
      <TopBar currentView={currentView} onViewChange={setCurrentView} />
      {currentView === 'editor' ? (
        <LyricsEditor lyrics={lyrics} undoManager={undoManager} snack={snack} onLyricsChange={handleLyricsChange} />
      ) : (
        <TimingView
          lyrics={lyrics}
          state={timingState}
          onStateChange={setTimingState}
          undoManager={undoManager}
          renderVersion={renderVersion}
          onRequestRender={handleLyricsChange}
          snack={snack}
          audioEngine={audioEngine}
          audioDuration={audioDuration}
          audioFileName={audioFileName}
          onAudioChange={handleAudioChange}
        />
      )}
      {snackNode}
    </div>
  );
}
