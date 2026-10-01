import '@testing-library/jest-dom/vitest';

// jsdom has no layout: tests run on a phone-sized screen unless they stub `matchMedia`.
window.matchMedia = (query: string) =>
  ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.setPointerCapture = () => {};
// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};

// Unit tests never call the network: a test that needs an answer mocks `fetch` itself.
vi.stubGlobal('fetch', () => Promise.reject(new Error('No network in unit tests')));

afterEach(() => localStorage.clear());
