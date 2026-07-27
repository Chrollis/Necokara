// jsondiffpatch is an ES module — use require() to work around
// CommonJS module system of this project.
const jsondiffpatch = require('jsondiffpatch');

import type { Project, ProjectSnapshot } from './project';

type Delta = any;

export class UndoManager {
  private undoStack: Delta[] = [];
  private redoStack: Delta[] = [];
  private lastSnapshot: ProjectSnapshot | null = null;
  private maxSteps: number;

  constructor(maxSteps: number = 200) {
    this.maxSteps = maxSteps;
  }

  record(project: Project): void {
    const snap = project.toSnapshot();

    if (this.lastSnapshot) {
      const delta = jsondiffpatch.diff(this.lastSnapshot, snap);
      if (delta && Object.keys(delta).length > 0) {
        this.undoStack.push(delta);
      }
    }

    this.lastSnapshot = snap;
    this.redoStack = [];

    while (this.undoStack.length > this.maxSteps) {
      this.undoStack.shift();
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(project: Project): boolean {
    const delta = this.undoStack.pop();
    if (!delta) return false;

    this.redoStack.push(delta);

    const currentSnap = project.toSnapshot();
    jsondiffpatch.unpatch(currentSnap, delta);
    project.applySnapshot(currentSnap);
    this.lastSnapshot = project.toSnapshot();
    return true;
  }

  redo(project: Project): boolean {
    const delta = this.redoStack.pop();
    if (!delta) return false;

    this.undoStack.push(delta);

    const currentSnap = project.toSnapshot();
    jsondiffpatch.patch(currentSnap, delta);
    project.applySnapshot(currentSnap);
    this.lastSnapshot = project.toSnapshot();
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastSnapshot = null;
  }
}
