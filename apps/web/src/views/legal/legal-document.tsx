import { Fragment } from 'react';

import { LEAD, NOTE, PROSE, RichText } from '../../components/index.ts';
import type { Section } from '../../i18n/index.ts';

/** A legal page: its sections as headings, paragraphs and lists. Ids are `<testId>`, `<testId>-section-<id>` and `<testId>-<link>`. */
export function LegalDocument({
  testId,
  sections,
  footer,
}: {
  testId: string;
  sections: Section[];
  /** A line after the last section. */
  footer?: string;
}) {
  return (
    <div className={PROSE} data-testid={testId}>
      {sections.map(({ id, title, blocks }) => (
        <Fragment key={id}>
          {title && <h2 data-testid={`${testId}-section-${id}`}>{title}</h2>}
          {blocks.map((block, index) =>
            'paragraph' in block ? (
              // The introduction, which has no heading, opens the page.
              <p key={index} className={title ? undefined : LEAD}>
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
        </Fragment>
      ))}
      {footer && <p className={NOTE}>{footer}</p>}
    </div>
  );
}
