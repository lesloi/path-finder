import { fireEvent, render, screen } from '@testing-library/react';

import { expectNamedControls } from '../accessible-names.ts';
import { criteriaText } from '../i18n/index.ts';
import { CriteriaBar } from './criteria-bar.tsx';

describe('CriteriaBar', () => {
  it('says the criteria and the start point, and names the tap that edits them', () => {
    render(<CriteriaBar language="en" summary="10.0 km · Hilly" start="45.8992, 6.1294" onClick={vi.fn()} />);

    const bar = screen.getByTestId('criteria-bar');
    expect(bar).toHaveTextContent('10.0 km · Hilly');
    expect(bar).toHaveTextContent('45.8992, 6.1294');
    expect(bar).toHaveAccessibleName(`${criteriaText.en.editCriteria}: 10.0 km · Hilly, 45.8992, 6.1294`);
  });

  it('only says the criteria while there is no start point', () => {
    render(<CriteriaBar language="fr" summary="10,0 km" onClick={vi.fn()} />);

    expect(screen.getByTestId('criteria-bar')).toHaveAccessibleName(`${criteriaText.fr.editCriteria}: 10,0 km`);
  });

  it('opens the criteria on a tap', () => {
    const onClick = vi.fn();
    render(<CriteriaBar language="en" summary="10 km" onClick={onClick} />);

    fireEvent.click(screen.getByTestId('criteria-bar'));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('names its control', () => {
    const { container } = render(<CriteriaBar language="en" summary="10 km" onClick={vi.fn()} />);

    expectNamedControls(container);
  });
});
