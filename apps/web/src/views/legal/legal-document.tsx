import { Fragment } from 'react';

import { LEAD, NOTE, PROSE, RichText } from '../../components/index.ts';
import type { Section } from '../../i18n/index.ts';

/** A legal page: its sections as headings, paragraphs and lists. Ids are `<testId>`, `<testId>-section-<id>` and `<testId>-<link>`. */
export function LegalDocument({
  testId,
  sections,
  note,
}: {
  testId: string;
  sections: Section[];
  /** A line under the introduction, the section without a heading. */
  note?: string;
}) {
  return (
    <div className={PROSE} data-testid={testId}>
      {sections.map(({ id, title, blocks }) => (
        <Fragment key={id}>
          {title && <h2 data-testid={`${testId}-section-${id}`}>{title}</h2>}
          {blocks.map((block, index) =>
            'paragraph' in block ? (
              // The first paragraph of the introduction, which has no heading, opens the page.
              <p key={index} className={!title && index === 0 ? LEAD : undefined}>
                <RichText paragraph={block.paragraph} testId={testId} />
              </p>
            ) : (
              <ul key={index}>
                {block.list.map((item, position) => (
                  <li key={position}>
                    <RichText paragraph={item} testId={testId} />
                  </li>
                ))}
              </ul>
            ),
          )}
          {!title && note && <p className={NOTE}>{note}</p>}
        </Fragment>
      ))}
    </div>
  );
}
