import type { Lyrics } from '../editor/lyrics';
import type { TimingState } from '../timing/types';
import { toJson, fromJson } from '../editor/jsonlyrics';
import {
  serializeTimingState,
  deserializeTimingState,
} from '../timing/serialization';
import { createTimingState } from '../timing/state';

import pkg from '../../release/app/package.json';

export interface ProjectSnapshot {
  lyrics: ReturnType<typeof toJson>;
  timing: ReturnType<typeof serializeTimingState>;
}

export const APP_VERSION = pkg.version;

export interface ProjectJson {
  version: string;
  createdAt: string;
  updatedAt: string;
  userPassword?: string;
  skipSetPasswordPrompt?: boolean;
  skipChangePasswordPrompt?: boolean;
}

export interface OpenResult {
  project: Project;
  filePath: string;
}
export interface OpenError {
  error: 'bad_password';
  filePath: string;
}

export class Project {
  lyrics: Lyrics;
  timing: TimingState;
  filePath: string = '';
  hasUnsavedChanges: boolean = false;
  projectJson: ProjectJson = {
    version: APP_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  constructor(lyrics: Lyrics, timing: TimingState) {
    this.lyrics = lyrics;
    this.timing = timing;
  }

  toSnapshot(): ProjectSnapshot {
    return {
      lyrics: toJson(this.lyrics),
      timing: serializeTimingState(this.timing),
    };
  }

  applySnapshot(snap: ProjectSnapshot): void {
    const restored = fromJson(snap.lyrics as any);
    this.lyrics.words.length = 0;
    restored.words.forEach((w) => this.lyrics.words.push(w));
    this.lyrics.metadata = { ...restored.metadata };

    this.timing = deserializeTimingState(snap.timing);
  }

  /** Build the data object to pass to window.electron.project.save() */
  toSaveData() {
    return {
      projectJson: this.projectJson,
      lyrics: toJson(this.lyrics),
      timing: serializeTimingState(this.timing),
    };
  }

  private static electronApi() {
    return (typeof window !== 'undefined' && window.electron?.project) || null;
  }

  /** Save to disk. Returns the file path or null if cancelled. */
  async save(password?: string): Promise<string | null> {
    const api = Project.electronApi();
    if (!api) return null;
    this.projectJson.updatedAt = new Date().toISOString();
    this.projectJson.version = APP_VERSION;
    const pw = password ?? this.projectJson.userPassword;
    if (pw) this.projectJson.userPassword = pw;
    const data = JSON.stringify(this.toSaveData());
    if (this.filePath) {
      const result = await api.saveDirect(data, this.filePath, pw);
      if (result?.filePath) {
        this.hasUnsavedChanges = false;
      }
      return result?.filePath ?? null;
    }
    const result = await api.save(data, undefined, pw);
    if (result?.filePath) {
      this.filePath = result.filePath;
      this.hasUnsavedChanges = false;
    }
    return result?.filePath ?? null;
  }

  /** Save as new file. Always shows the save dialog. */
  async saveAs(password?: string): Promise<string | null> {
    const api = Project.electronApi();
    if (!api) return null;
    this.projectJson.updatedAt = new Date().toISOString();
    this.projectJson.version = APP_VERSION;
    const pw = password ?? this.projectJson.userPassword;
    if (pw) this.projectJson.userPassword = pw;
    const data = JSON.stringify(this.toSaveData());
    const result = await api.save(data, undefined, pw);
    if (result?.filePath) {
      this.filePath = result.filePath;
      this.hasUnsavedChanges = false;
    }
    return result?.filePath ?? null;
  }

  /** Load from disk. Returns a new Project, null if cancelled, or { error } if bad password. */
  static async open(password?: string): Promise<OpenResult | OpenError | null> {
    const api = Project.electronApi();
    if (!api) return null;
    const result = await api.open(password);
    if (!result) return null;
    if (result.error === 'bad_password') return result as OpenError;

    const lyrics = fromJson(result.lyrics);
    const timing = deserializeTimingState(result.timing);
    const project = new Project(lyrics, timing);
    project.filePath = result.filePath;
    project.projectJson = result.projectJson || {
      version: APP_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    project.hasUnsavedChanges = false;
    return { project, filePath: result.filePath };
  }
}
