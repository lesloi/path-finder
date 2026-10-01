import { LINKS, type LinkId, type Paragraph } from '../i18n/index.ts';

/** A paragraph's text, with each `{id}` replaced by its link; a link's test id is `<testId>-<id>`. */
export function RichText({ paragraph, testId }: { paragraph: Paragraph; testId: string }) {
  const { text, links = {} } = paragraph;
  return text.split(/\{(\w+)\}/).map((part, index) => {
    // The odd parts are the ids between braces.
    if (index % 2 === 0) return part;
    const id = part as LinkId;
    return (
      <a key={id} data-testid={`${testId}-${id}`} href={LINKS[id]}>
        {links[id]}
      </a>
    );
  });
}
