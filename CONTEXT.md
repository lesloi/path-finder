# Path finder

Generates running and hiking loops from a start point and a few criteria, so the user can
pick one and export it to a GPS watch.

## Language

### Asking for routes

**Start point**:
Where every generated route begins and ends, set from the device location or by picking a
spot on the map.
_Avoid_: Origin, departure

**Criteria**:
Everything the user sets to ask for routes: start point, activity, a target distance or a
target duration, an optional target elevation gain, and a surface preference.
_Avoid_: Filters, query, search parameters

**Target distance**:
The route length the user asks for, met within a tolerance. Given directly or derived from
a target duration and a pace.
_Avoid_: Length

**Target duration**:
How long the user wants to be out. It replaces the target distance and is never set
together with it.
_Avoid_: Time

**Target elevation gain**:
The cumulative climb (D+) the user asks for, met within a tolerance. Optional.
_Avoid_: Elevation, denivelé, climb

**Surface preference**:
A soft preference for paved roads, unpaved paths, or no preference. It weights the
generation and never excludes a route outright.
_Avoid_: Road type, terrain filter

### Activities and effort

**Activity**:
What the user is doing: run or hike (ride later). An activity is data (default pace,
allowed ways), not a branch in the code.
_Avoid_: Sport, mode, profile

**Trail run**:
A run with the unpaved surface preference. Not a separate activity.

**Pace**:
The user's flat-ground speed for an activity, stored in their settings.
_Avoid_: Speed (except as the imperial/metric display of the same value)

**Effort distance**:
Distance plus climb converted to distance, at 100 m of elevation gain for 1 km. Estimated
duration is effort distance times pace.
_Avoid_: Kilomètre-effort, adjusted distance

### Results

**Route**:
One generated loop, with its geometry, distance, elevation gain, surface breakdown, and
estimated duration.
_Avoid_: Trace, track, itinerary, path

**Route name**:
The label of a route in the app and in its GPX export: the commune of the start point, the
distance, and the elevation gain, such as "Boucle Annecy · 12.3 km · +340 m".
_Avoid_: Title

**Loop**:
A route that ends at its start point. The only route shape for now.
_Avoid_: Round trip, circuit

**Route set**:
The three to five routes generated for one set of criteria: matches first, then
suggestions. Routes are never saved, so a route set is gone when the user asks again or
leaves the app.
_Avoid_: Results, search results

**Match**:
A route whose distance (or estimated duration, when the user asked for a target duration)
and elevation gain are within the tolerances of the criteria. Surface preference only
affects ranking, never whether a route is a match.
_Avoid_: Good route, result

**Suggestion**:
A route outside the tolerances but within a wider margin. Each criterion it misses is
marked on the route itself, with how far off it is. It fills the route set when there are
not enough matches.
_Avoid_: Alternative, fallback

**GPX export**:
A GPX file for one route, sent to the device share sheet when the browser supports it,
otherwise downloaded, so the user can open it in their watch vendor's app.
_Avoid_: Sync, upload

**Settings**:
The user's preferences kept on the device: pace per activity, language, units. Lost if the
user clears the site's data.
_Avoid_: Profile, account
