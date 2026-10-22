import { render, screen } from '@testing-library/react';

import { MAX_AVOIDED_AREAS, type AvoidedArea } from '../contract/index.ts';
import { criteriaText } from '../i18n/index.ts';
import { AvoidedAreaList } from './avoided-area-list.tsx';

const en = criteriaText.en;

const renderList = (areas: AvoidedArea[]) =>
  render(
    <AvoidedAreaList
      language="en"
      areas={areas}
      placing={false}
      full={false}
      onToggle={() => {}}
      onResize={() => {}}
      onRemove={() => {}}
      onCenter={() => {}}
      onPoint={() => {}}
    />,
  );

describe('AvoidedAreaList', () => {
  it('shows how many areas are set out of the maximum', () => {
    renderList([{ center: [6.2, 45.8], radius: 200 }]);

    expect(screen.getByTestId('criteria-avoided-count')).toHaveTextContent(`1/${MAX_AVOIDED_AREAS}`);
    expect(screen.getByTestId('criteria-avoided-count')).toHaveTextContent(en.countOfMax(1, MAX_AVOIDED_AREAS));
  });

  it('shows no count while there are no areas', () => {
    renderList([]);

    expect(screen.queryByTestId('criteria-avoided-count')).not.toBeInTheDocument();
  });
});
