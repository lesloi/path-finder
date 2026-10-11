import indexHtml from '../../index.html?raw';
import { applyDescription } from './page-meta.ts';

const description = (doc: Document, selector: string) => doc.head.querySelector(selector)?.getAttribute('content');

describe('applyDescription', () => {
  it('replaces the description of the page and that of its link previews', () => {
    const doc = new DOMParser().parseFromString(indexHtml, 'text/html');

    applyDescription('Une description', doc);

    expect(description(doc, 'meta[name="description"]')).toBe('Une description');
    expect(description(doc, 'meta[property="og:description"]')).toBe('Une description');
  });
});
