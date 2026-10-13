import type { ProseMirrorJsonNode } from '../src';

export interface DemoSample {
  id: string;
  label: string;
  description: string;
  original: ProseMirrorJsonNode;
  proposed: ProseMirrorJsonNode;
}
const text = (value: string): ProseMirrorJsonNode => ({ type: 'text', text: value });
const paragraph = (value: string): ProseMirrorJsonNode => ({ type: 'paragraph', content: [text(value)] });
const heading = (value: string, level = 2): ProseMirrorJsonNode => ({ type: 'heading', attrs: { level }, content: [text(value)] });
const list = (...values: string[]): ProseMirrorJsonNode => ({ type: 'bulletList', content: values.map(value => ({ type: 'listItem', content: [paragraph(value)] })) });
const doc = (...content: ProseMirrorJsonNode[]): ProseMirrorJsonNode => ({ type: 'doc', content });

export const samples: DemoSample[] = [
  {
    id: 'proposal', label: 'Client proposal', description: 'Review a new timeline, budget, and scope.',
    original: doc(
      heading('Website redesign', 1), paragraph('A focused redesign for Northstar Studio.'),
      heading('Timeline'),
      paragraph('We’ll deliver a responsive website in four weeks.'),
      heading('Investment'), paragraph('The project fee is $4,800, with a 50% deposit to begin.'), heading('Included in the project'),
      list('Responsive design across desktop and mobile.', 'CMS setup and editor training.'),
      heading('Next steps'), paragraph('Please send your feedback within five business days.'),
    ),
    proposed: doc(
      heading('Website redesign', 1), paragraph('A focused redesign for Northstar Studio.'),
      heading('Timeline'),
      paragraph('We’ll deliver a responsive website in three weeks.'),
      heading('Investment'), paragraph('The project fee is $5,400, with a 50% deposit to begin.'), heading('Included in the project'),
      list('Responsive design across desktop and mobile.', 'CMS setup, editor training, and a handover guide.', 'Accessibility pass on core pages.'),
      heading('Next steps'), paragraph('Please send your feedback within three business days.'),
    ),
  },
  {
    id: 'release', label: 'Release notes', description: 'Compare edits across paragraphs and a checklist.',
    original: doc(
      heading('A better workspace', 1), paragraph('Release 0.4 · Product update'),
      paragraph('You can now find recent documents from the home screen.'),
      heading('What changed'), list('New document search.', 'Faster navigation between projects.'),
      paragraph('The legacy search page will remain available.'),
    ),
    proposed: doc(
      heading('A better workspace', 1), paragraph('Release 0.5 · Product update'),
      paragraph('You can now find and pin recent documents from the home screen.'),
      heading('What changed'), list('New document search with filters.', 'Faster navigation between projects.', 'Keyboard shortcuts for common actions.'),
      paragraph('The legacy search page has been retired. Your saved searches are still available.'),
    ),
  },
  {
    id: 'formatting', label: 'Formatting & structure', description: 'Track formatting, a line break, and a new list item.',
    original: doc(
      heading('Project handover', 1),
      { type: 'paragraph', content: [text('Please review the final deliverables before Friday.')] },
      heading('Deliverables'), list('Design source files.', 'Setup instructions.'),
      { type: 'paragraph', content: [text('Contact: Maya Chen'), { type: 'hardBreak' }, text('Design lead')] },
    ),
    proposed: doc(
      heading('Project handover', 1),
      { type: 'paragraph', content: [text('Please review the '), { type: 'text', text: 'final deliverables', marks: [{ type: 'bold' }] }, text(' before Friday.')] },
      heading('Deliverables'), list('Design source files.', 'Setup instructions.', 'A recorded walkthrough.'),
      { type: 'paragraph', content: [text('Contact: Maya Chen · Design lead')] },
    ),
  },
];
