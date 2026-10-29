import indexHtml from '../../index.html?raw';
import { HOME_TITLE, applyTitle } from './page-title.ts';

const parsed = () => new DOMParser().parseFromString(indexHtml, 'text/html');

describe('applyTitle', () => {
  it('names the home page after the app and what it does', () => {
    const doc = new DOMParser().parseFromString('<!doctype html><title>Anything</title>', 'text/html');

    applyTitle(undefined, doc);

    expect(doc.title).toBe(HOME_TITLE);
  });

  it('puts the name of another page first', () => {
    const doc = new DOMParser().parseFromString('<!doctype html><title>Anything</title>', 'text/html');

    applyTitle('Réglages', doc);

    expect(doc.title).toBe('Réglages · Path finder');
  });
});

describe('the title of index.html', () => {
  it('is the one the app puts back on its home page, which a search engine indexes', () => {
    // A search engine reads the file, not the app: a tab that renames the home page would also rename it there.
    expect(parsed().title).toBe(HOME_TITLE);
  });
});
