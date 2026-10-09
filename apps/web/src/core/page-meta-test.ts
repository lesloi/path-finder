import indexHtml from '../../index.html?raw';
import { commonText } from '../i18n/index.ts';
import { applyDescription } from './page-meta.ts';

const page = new DOMParser().parseFromString(indexHtml, 'text/html');
const description = (doc: Document, selector: string) => doc.head.querySelector(selector)?.getAttribute('content');

describe('applyDescription', () => {
  it('replaces the description of the page and that of its link previews', () => {
    const doc = new DOMParser().parseFromString(indexHtml, 'text/html');

    applyDescription('Une description', doc);

    expect(description(doc, 'meta[name="description"]')).toBe('Une description');
    expect(description(doc, 'meta[property="og:description"]')).toBe('Une description');
  });
});

describe('index.html', () => {
  it('describes the app as the English text does, for what runs no script', () => {
    expect(description(page, 'meta[name="description"]')).toBe(commonText.en.description);
    expect(description(page, 'meta[property="og:description"]')).toBe(commonText.en.description);
  });
});
