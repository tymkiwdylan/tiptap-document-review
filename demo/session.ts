import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { buildServerSchema } from '../src/tiptap/schema';
import { buildTrackedDocument, resolveTrackedDocument, type ProseMirrorJsonNode } from '../src/diff/trackedDocument';
import { collectChangeDecisionGroups, createAtomicChangeDecisionTransaction, type ChangeDecision } from '../src/tiptap/changeOperations';

interface Snapshot {
  document: ProseMirrorNode;
  accepted: number;
  rejected: number;
  message: string;
}

export class ReviewSession {
  private readonly schema = buildServerSchema();
  private current: ProseMirrorNode;
  private readonly history: Snapshot[] = [];
  accepted = 0;
  rejected = 0;
  message = 'Choose which changes to keep.';
  readonly initialCount: number;

  constructor(original: unknown, proposed: unknown) {
    const result = buildTrackedDocument(original, proposed);
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    this.current = this.schema.nodeFromJSON(result.document);
    this.initialCount = this.groups.length;
    if (this.initialCount === 0) this.message = 'The drafts are identical.';
  }

  get document(): ProseMirrorJsonNode { return this.current.toJSON(); }
  get groups() { return collectChangeDecisionGroups(this.current); }
  get canUndo() { return this.history.length > 0; }

  private remember() {
    this.history.push({ document: this.current, accepted: this.accepted, rejected: this.rejected, message: this.message });
  }

  decideGroup(key: string, decision: ChangeDecision) {
    const group = this.groups.find(value => value.key === key);
    if (!group) throw new Error('This change is no longer pending.');
    const result = createAtomicChangeDecisionTransaction(this.current, group.snapshots, decision, this.schema);
    if (!result.ok) throw new Error('This change could not be resolved safely.');
    this.remember();
    this.current = result.transaction.doc;
    if (decision === 'accept') this.accepted++; else this.rejected++;
    this.message = decision === 'accept' ? 'Change accepted.' : 'Change rejected.';
  }

  decideAll(decision: ChangeDecision) {
    if (this.groups.length === 0) return;
    const result = resolveTrackedDocument(this.document, decision);
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    this.remember();
    this.current = this.schema.nodeFromJSON(result.document);
    if (decision === 'accept') this.accepted += result.changesResolved; else this.rejected += result.changesResolved;
    this.message = decision === 'accept' ? 'All remaining changes accepted.' : 'All remaining changes rejected.';
  }

  undo() {
    const snapshot = this.history.pop();
    if (!snapshot) return;
    this.current = snapshot.document;
    this.accepted = snapshot.accepted;
    this.rejected = snapshot.rejected;
    this.message = 'Last decision undone.';
  }
}
