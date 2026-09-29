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

afterEach(() => localStorage.clear());
