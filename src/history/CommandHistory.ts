/**
 * Undo/redo with the Command pattern. Build commands mutate a shared model; each command keeps
 * a memento of the model before and after it ran, so undo/redo restore exact states.
 */

/** Everything a build command may change. */
export interface Memento<S> {
  save(): S;
  restore(state: S): void;
}

export abstract class Command<Ctx> {
  /** Short name for UI / debugging (e.g. "CreateRoad"). */
  abstract readonly name: string;
  /** Apply the change. Return false to abort (nothing is recorded). */
  abstract perform(ctx: Ctx): boolean;
}

interface Entry<S> {
  name: string;
  before: S;
  after: S;
}

export class CommandHistory<Ctx, S> {
  private undoStack: Entry<S>[] = [];
  private redoStack: Entry<S>[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly memento: Memento<S>,
    private readonly limit = 200,
  ) {}

  /** Run a command; if it succeeds it becomes undoable and clears the redo stack. */
  execute(cmd: Command<Ctx>): boolean {
    const before = this.memento.save();
    if (!cmd.perform(this.ctx)) {
      this.memento.restore(before);
      return false;
    }
    this.undoStack.push({ name: cmd.name, before, after: this.memento.save() });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    return true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Name of the command that undo would revert. */
  get nextUndo(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.name ?? null;
  }

  undo(): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.memento.restore(e.before);
    this.redoStack.push(e);
    return true;
  }

  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.memento.restore(e.after);
    this.undoStack.push(e);
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
