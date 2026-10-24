import { fireEvent, render, screen } from '@testing-library/react';

import { MAX_AVOIDED_AREAS, type AvoidedArea } from '../contract/index.ts';
import { criteriaText } from '../i18n/index.ts';
import { AvoidedAreaList } from './avoided-area-list.tsx';

const en = criteriaText.en;

const AREA: AvoidedArea = { center: [6.2, 45.8], radius: 200 };

const renderList = (areas: AvoidedArea[], props: Partial<Parameters<typeof AvoidedAreaList>[0]> = {}) =>
  render(
    <AvoidedAreaList
      language="en"
      areas={areas}
      onRemove={() => {}}
      onCenter={() => {}}
      onPoint={() => {}}
      {...props}
    />,
  );

describe('AvoidedAreaList', () => {
  it('shows how many areas are set out of the maximum', () => {
    renderList([AREA]);

    expect(screen.getByTestId('criteria-avoided-count')).toHaveTextContent(`1/${MAX_AVOIDED_AREAS}`);
    expect(screen.getByTestId('criteria-avoided-count')).toHaveTextContent(en.countOfMax(1, MAX_AVOIDED_AREAS));
  });

  it('shows no count while there are no areas', () => {
    renderList([]);

    expect(screen.queryByTestId('criteria-avoided-count')).not.toBeInTheDocument();
  });

  it('adds areas only where it is given the button to do so', () => {
    renderList([AREA]);
    expect(screen.queryByTestId('criteria-avoided')).not.toBeInTheDocument();

    const onToggle = vi.fn();
    renderList([AREA], { add: { placing: false, full: false, onToggle } });

    fireEvent.click(screen.getByTestId('criteria-avoided'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows the radius of each area, which the map sets', () => {
    renderList([AREA]);

    expect(screen.getByTestId('criteria-avoided-item-1-radius')).toHaveTextContent('200 m');
    expect(screen.getByTestId('criteria-avoided-item-1').querySelector('input')).toBeNull();
  });

  it('centres the map on an area from its row', () => {
    const onCenter = vi.fn();
    renderList([AREA], { onCenter });

    fireEvent.click(screen.getByTestId('criteria-avoided-item-1-name'));

    expect(onCenter).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('makes a row a button only where it can move the map to its area', () => {
    renderList([AREA], { onCenter: undefined });

    expect(screen.getByTestId('criteria-avoided-item-1-name').tagName).toBe('DIV');
  });
});
