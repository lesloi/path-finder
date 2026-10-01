const CONTROLS = 'a[href], button, input, select, textarea, dialog, [role="slider"], [role="listbox"], [role="option"]';

/**
 * Expects every control inside `container` to have an accessible name, so a view rendered in a
 * language that lacks a label fails here and not in front of a screen reader user.
 */
export function expectNamedControls(container: Element) {
  const controls = [...container.querySelectorAll(CONTROLS)];
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) expect(control).toHaveAccessibleName();
}
