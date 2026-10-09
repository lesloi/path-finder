/** Puts the description in the user's language, in the tags of `index.html` that search engines and link previews read. */
export function applyDescription(description: string, doc: Document = document) {
  doc.querySelectorAll('meta[name="description"], meta[property="og:description"]').forEach((tag) => {
    tag.setAttribute('content', description);
  });
}
