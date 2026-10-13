import { Editor } from '@tiptap/core';
import { createReviewExtensions } from '../src/tiptap/schema';
import { InlineChange, BlockChange, LineBreakChange } from '../src/tiptap/changeNodes';
import type { ChangeDecision, ChangeDecisionGroup } from '../src/tiptap/changeOperations';
import { ReviewSession } from './session';
import { samples } from './samples';
import './style.css';

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!(value instanceof HTMLElement)) throw new Error(`Missing element: ${id}`);
  return value;
}
function button(id: string): HTMLButtonElement {
  const value = element(id);
  if (!(value instanceof HTMLButtonElement)) throw new Error(`Missing button: ${id}`);
  return value;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const value = document.createElement(tag);
  value.className = className;
  value.textContent = text;
  return value;
}
function select(id: string): HTMLSelectElement {
  const value = element(id);
  if (!(value instanceof HTMLSelectElement)) throw new Error('Missing example selector.');
  return value;
}
const selector = select('example');
for (const sample of samples) {
  const option = node('option', '', sample.label);
  option.value = sample.id;
  selector.append(option);
}

// The browser view shares the engine's schema; review controls live in the sidebar.
const displayExtensions = createReviewExtensions().map(extension => {
  if (extension.name === 'inlineChange' || extension.name === 'blockChange') {
    const base = extension.name === 'inlineChange' ? InlineChange : BlockChange;
    return base.extend({
      addNodeView() {
        return ({ node: change }) => {
          const dom = document.createElement(change.type.name === 'inlineChange' ? 'span' : 'div');
          dom.dataset.change = change.attrs.changeType === 'deleted' ? 'deleted' : 'added';
          if (typeof change.attrs.changeId === 'string') dom.dataset.changeId = change.attrs.changeId;
          const contentDOM = document.createElement(change.type.name === 'inlineChange' ? 'span' : 'div');
          dom.append(contentDOM);
          return { dom, contentDOM };
        };
      },
    });
  }
  if (extension.name === 'lineBreakChange') {
    return LineBreakChange.extend({
      addNodeView() {
        return ({ node: change }) => {
          const dom = node('span', 'linebreak-marker', '↵');
          dom.dataset.change = change.attrs.changeType === 'deleted' ? 'deleted' : 'added';
          if (typeof change.attrs.changeId === 'string') dom.dataset.changeId = change.attrs.changeId;
          dom.setAttribute('aria-label', `${dom.dataset.change} line break`);
          return { dom };
        };
      },
    });
  }
  return extension;
});

let session: ReviewSession | undefined;
let sample = samples[0];
let initializing = true;
let dirty = false;
let focusedGroup: string | null = null;

function formatting(editor: Editor, name: string) {
  document.querySelectorAll<HTMLButtonElement>(`.format-toolbar[data-editor="${name}"] button`).forEach(control => {
    const format = control.dataset.format;
    const active = format === 'heading' ? editor.isActive('heading', { level: 2 }) : format ? editor.isActive(format) : false;
    control.setAttribute('aria-pressed', String(active));
  });
}
function changed() {
  if (initializing) return;
  dirty = true;
  render(false);
}
const originalEditor = new Editor({
  element: element('original-editor'), extensions: createReviewExtensions(),
  editorProps: { attributes: { role: 'textbox', 'aria-label': 'Original document', 'aria-multiline': 'true' } },
  onUpdate: changed,
  onSelectionUpdate: ({ editor }) => formatting(editor, 'original'),
});
const proposedEditor = new Editor({
  element: element('proposed-editor'), extensions: createReviewExtensions(),
  editorProps: { attributes: { role: 'textbox', 'aria-label': 'Proposed document', 'aria-multiline': 'true' } },
  onUpdate: changed,
  onSelectionUpdate: ({ editor }) => formatting(editor, 'proposed'),
});
const reviewEditor = new Editor({
  element: element('review-editor'), extensions: displayExtensions, editable: false,
  editorProps: { attributes: { role: 'document', 'aria-label': 'Document with tracked changes' } },
});

function showError(value: unknown) {
  const message = value instanceof Error ? value.message : 'The operation could not be completed.';
  const output = element('error');
  output.textContent = `Unable to compare or resolve this edit. ${message}`;
  output.hidden = false;
  element('status').textContent = 'Your drafts are unchanged. Adjust the edit and try again.';
}
function clearError() { element('error').hidden = true; }
function act(operation: () => void) {
  try { clearError(); operation(); render(); } catch (error) { showError(error); }
}
function switchTab(view: 'review' | 'drafts') {
  for (const name of ['review', 'drafts']) {
    const active = name === view;
    button(`tab-${name}`).setAttribute('aria-selected', String(active));
    element(`panel-${name}`).hidden = !active;
  }
}
function compare() {
  try {
    const next = new ReviewSession(originalEditor.getJSON(), proposedEditor.getJSON());
    clearError();
    session = next;
    dirty = false;
    focusedGroup = null;
    render();
    switchTab('review');
  } catch (error) { showError(error); }
}
function loadExample() {
  initializing = true;
  originalEditor.commands.setContent(structuredClone(sample.original), { emitUpdate: false });
  proposedEditor.commands.setContent(structuredClone(sample.proposed), { emitUpdate: false });
  selector.value = sample.id;
  initializing = false;
  compare();
  formatting(originalEditor, 'original');
  formatting(proposedEditor, 'proposed');
}

function previews(group: ChangeDecisionGroup, kind: 'added' | 'deleted') {
  const values = group.snapshots.filter(snapshot => snapshot.changeType === kind).map(snapshot => {
    if (snapshot.textPreview) return snapshot.textPreview.replace(/([.!?])(?=\p{Lu})/gu, '$1 ');
    return snapshot.nodeType === 'lineBreakChange' ? 'Line break' : 'Empty block';
  });
  return [...new Set(values)].join(' · ');
}
function focusGroup(group: ChangeDecisionGroup) {
  focusedGroup = group.key;
  document.querySelectorAll<HTMLElement>('.change-card').forEach(card => card.classList.toggle('is-focused', card.dataset.group === group.key));
  let target: HTMLElement | undefined;
  reviewEditor.view.dom.querySelectorAll<HTMLElement>('[data-change-id]').forEach(mark => {
    const active = mark.dataset.changeId === group.changeId;
    mark.dataset.active = String(active);
    if (active && !target) target = mark;
  });
  if (target) target.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}
function decide(key: string, decision: ChangeDecision) {
  if (dirty || !session) return;
  session.decideGroup(key, decision);
  focusedGroup = null;
}
function changeCard(group: ChangeDecisionGroup, index: number) {
  const card = node('section', 'change-card');
  card.dataset.group = group.key;
  card.classList.toggle('is-focused', focusedGroup === group.key);
  const oldText = previews(group, 'deleted');
  const newText = previews(group, 'added');
  const type = oldText && newText ? oldText === newText ? 'Formatting change' : 'Replacement' : newText ? 'Addition' : 'Removal';
  const heading = node('div', 'change-title');
  heading.append(node('span', 'change-number', String(index + 1).padStart(2, '0')));
  const focus = node('button', 'group-focus', type);
  focus.type = 'button';
  focus.setAttribute('aria-label', `Highlight change ${index + 1}: ${type}`);
  focus.addEventListener('click', () => focusGroup(group));
  heading.append(focus);
  card.append(heading);
  if (oldText) card.append(node('p', 'change-copy deleted', oldText));
  if (newText) card.append(node('p', 'change-copy added', newText));
  if (type === 'Formatting change') card.append(node('p', 'change-copy', 'Text stays the same; formatting changes.'));
  const controls = node('div', 'change-buttons-row');
  for (const decision of ['accept', 'reject']) {
    if (decision !== 'accept' && decision !== 'reject') continue;
    const control = node('button', `${decision}-one`, decision === 'accept' ? '✓ Accept' : '× Reject');
    control.type = 'button';
    control.disabled = dirty;
    control.setAttribute('aria-label', `${decision === 'accept' ? 'Accept' : 'Reject'} change ${index + 1}`);
    control.addEventListener('click', () => act(() => decide(group.key, decision)));
    controls.append(control);
  }
  card.append(controls);
  return card;
}
function render(updateDocument = true) {
  if (!session) return;
  const groups = session.groups;
  if (updateDocument) reviewEditor.commands.setContent(session.document, { emitUpdate: false });
  document.querySelector('.app')?.setAttribute('data-dirty', String(dirty));
  element('pending-count').textContent = String(groups.length);
  element('tab-count').textContent = String(groups.length);
  element('document-status').textContent = dirty ? 'Drafts changed' : groups.length ? 'In review' : 'Resolved';
  element('document-label').textContent = groups.length ? 'PROPOSED REVISION' : 'FINAL DOCUMENT';
  element('decision-summary').textContent = `${session.accepted} accepted · ${session.rejected} rejected`;
  element('sample-description').textContent = dirty ? 'Compare your edited drafts to refresh this review.' : sample.description;
  element('status').textContent = dirty ? 'Drafts changed. Compare them to start a new review.' : session.message;
  element('json-output').textContent = JSON.stringify(session.document, null, 2);
  button('undo').disabled = dirty || !session.canUndo;
  button('accept-all').disabled = dirty || !groups.length;
  button('reject-all').disabled = dirty || !groups.length;
  button('export').disabled = dirty || Boolean(groups.length);
  const list = element('change-list');
  list.replaceChildren();
  if (groups.length) {
    groups.forEach((group, index) => list.append(changeCard(group, index)));
  } else {
    const empty = node('div', 'empty-state');
    empty.append(node('div', 'empty-icon', '✓'), node('h3', '', session.initialCount ? 'Review complete' : 'No changes to review'), node('p', '', session.initialCount ? 'Your final document is ready to download.' : 'Edit a draft to create a new comparison.'));
    list.append(empty);
  }
}
button('accept-all').addEventListener('click', () => act(() => { if (!dirty) session?.decideAll('accept'); }));
button('reject-all').addEventListener('click', () => act(() => { if (!dirty) session?.decideAll('reject'); }));
button('undo').addEventListener('click', () => act(() => { if (!dirty) session?.undo(); }));
button('reset').addEventListener('click', loadExample);
button('compare').addEventListener('click', compare);
button('tab-review').addEventListener('click', () => switchTab('review'));
button('tab-drafts').addEventListener('click', () => switchTab('drafts'));
selector.addEventListener('change', () => {
  const next = samples.find(value => value.id === selector.value);
  if (next) { sample = next; loadExample(); }
});
button('export').addEventListener('click', () => {
  if (!session || dirty || session.groups.length) return;
  const blob = new Blob([JSON.stringify(session.document, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = node('a');
  link.href = url;
  link.download = `${sample.id}-reviewed.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  element('status').textContent = 'Final document downloaded.';
});
for (const toolbar of document.querySelectorAll<HTMLElement>('.format-toolbar')) {
  for (const control of toolbar.querySelectorAll<HTMLButtonElement>('button')) {
    control.addEventListener('mousedown', event => event.preventDefault());
    control.addEventListener('click', () => {
      const editor = toolbar.dataset.editor === 'original' ? originalEditor : proposedEditor;
      switch (control.dataset.format) {
        case 'bold': editor.chain().focus().toggleBold().run(); break;
        case 'italic': editor.chain().focus().toggleItalic().run(); break;
        case 'heading': editor.chain().focus().toggleHeading({ level: 2 }).run(); break;
        case 'bulletList': editor.chain().focus().toggleBulletList().run(); break;
      }
      formatting(editor, toolbar.dataset.editor || 'original');
    });
  }
}
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); compare(); }
});
const tabs = [button('tab-review'), button('tab-drafts')];
tabs.forEach((tab, index) => tab.addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const nextIndex = (index + 1) % tabs.length;
  switchTab(nextIndex === 0 ? 'review' : 'drafts');
  tabs[nextIndex].focus();
}));
window.addEventListener('pagehide', () => { originalEditor.destroy(); proposedEditor.destroy(); reviewEditor.destroy(); });
loadExample();
