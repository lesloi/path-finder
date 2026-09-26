# Web app instead of a native mobile app

Path finder is a web app (an installable PWA with a manifest and no service worker), not a
native Android/iOS app. The flow needs nothing native: set criteria, look at a few routes on
a map, export one as GPX. Foreground location, the share sheet with files, and MapLibre all
work in mobile browsers, and offline use was never a goal (ADR 0001). The web removes
Google Play Services and store reviews, reaches iOS and desktop at no extra cost, and ships
the front end and the API as one Docker image. The price is no store listing to be found
through. The owner decided on 2026-09-26, before any app code was written.

The front end is a Vite + React single-page app, served by the Hono API on the same origin.
The API stays on Hono: it has one stateless endpoint, no database, no accounts and no
sessions, so a full-stack framework such as AdonisJS would bring nothing we use.

## Considered Options

- **Expo native app** (the original plan): store presence, but native builds, Google Play
  Services, and store reviews for a flow the browser already handles.
- **Expo for web** (React Native Web): MapLibre React Native has no web support, and we
  would keep the native toolchain without its benefits.
- **PWA now, native app later**: kept as the way out if a store presence ever turns out to
  matter; nothing here prevents it.
