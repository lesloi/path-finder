const CONTROLS = 'a[href], button, input, select, textarea, dialog, [role="slider"], [role="listbox"], [role="option"]';

/**
 * Expects every control inside `container` to have an accessible name, so a view rendered in a
 * language that lacks a label fails here and not in front of a screen reader user.
 */
export function expectNamedControls(container: Element) {
  // The button of a styleable <select> only shows the picked option: the select is the control and is named.
  const controls = [...container.querySelectorAll(CONTROLS)].filter((control) => !control.matches('select > button'));
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) expect(control).toHaveAccessibleName();
}
