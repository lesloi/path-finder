import { useState } from 'react';

import type { Language } from './language.ts';
import { StartPointMap, type Position } from './start-point-map.tsx';

/** The first view: where the user sets the criteria of a route set. */
export function CriteriaView({ language }: { language: Language }) {
  const [start, setStart] = useState<Position>();
  return <StartPointMap language={language} start={start} onStartChange={setStart} />;
}
