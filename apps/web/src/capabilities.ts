import { useEffect, useState } from 'react';

/**
 * Whether the API has elevation data (BD ALTI), asked once from our own origin: nothing about
 * the user is sent. False until it answers, and when it cannot, so the form never offers a target
 * the API would ignore.
 */
export function useElevation(): boolean {
  const [elevation, setElevation] = useState(false);

  useEffect(() => {
    const request = new AbortController();
    fetch('/api/v1/capabilities', { signal: request.signal })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((body: unknown) => {
        const known = typeof body === 'object' && body !== null && 'elevation' in body;
        setElevation(known && body.elevation === true);
      })
      // Offline or without the API, as in development without it: no elevation.
      .catch(() => {});
    return () => request.abort();
  }, []);

  return elevation;
}
