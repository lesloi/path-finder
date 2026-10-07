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
Everything the user sets to ask for routes: start point, a target distance or a
target duration, an optional target elevation gain, a surface preference, whether to include
technical stretches, and up to three optional waypoints.
_Avoid_: Filters, query, search parameters

**Waypoint**:
A point a route must pass through between its start and its end, in the order the user
placed it. Up to three per set of criteria. Waypoints never replace the target distance or
target duration: criteria whose waypoints alone exceed the target are refused. A waypoint
off the ways a route can use is moved to the nearest one, unless it is too far from any.
_Avoid_: Stage, via, étape

**Target distance**:
The route length the user asks for, met within a tolerance. Given directly or derived from
a target duration and a pace.
_Avoid_: Length

**Target duration**:
How long the user wants to be out. It replaces the target distance and is never set
together with it.
_Avoid_: Time

**Target elevation gain**:
The cumulative climb (D+) the user asks for, met within a tolerance. Optional: without one,
elevation gain does not count. The user can pick a shortcut instead of a target.
_Avoid_: Elevation, denivelé, climb

**Flat** / **Hilly**:
Elevation gain shortcuts: at most (flat) or at least (hilly) a set climb per kilometre of
the route, rather than a target in metres.
_Avoid_: Easy, mountainous

**Surface preference**:
A soft preference for paved roads, unpaved paths, or no preference. It picks the **routing profile**
of the search, so it weights the generation, and the loops found are ranked on it too. It never excludes
a route outright: the only hard rule of the criteria is the exclusion of **technical stretches**.
_Avoid_: Road type, terrain filter

**Technical stretch**:
A way tagged as asking for the hands, ropes or chains: on foot, `sac_scale` from
`demanding_mountain_hiking` (T3) up. T1 and T2 are ordinary hiking and trail running. The switch « Autoriser les
passages techniques signalés » in the criteria is off by default, kept with the last criteria, and shown unless
the surface preference is paved, when the form always asks to exclude them and keeps the stored value. When it is off, flagged ways are excluded outright,
not weighted, and a start point or waypoint on one moves to the nearest way allowed. An untagged way is never
excluded: the switch says « signalés », it does not promise safety. A route that holds one carries the badge
« passages techniques ».
_Avoid_: Dangerous, difficult, T3

**Routing profile**:
The costs of a search, one per surface preference (`any`, `paved`, `unpaved`): a multiplier per way kind and
per surface, and one climb cost for all of them. It is not an activity.
_Avoid_: Activity profile

**Error code**:
The short key the server answers with when it refuses or fails a request (`invalid-criteria`,
`rate-limited`…), never a message. For invalid criteria it also names the field. The web
app words each code in the user's language.
_Avoid_: Error message

### Pace and effort

**Activity**:
The app has none. Run, trail run and hike are told apart by what the user sets: the
length, the surface preference, the elevation gain, and the pace. Travel by bike will be a
travel mode, not an activity.
_Avoid_: Sport, mode, profile

**Trail run**:
Running on unpaved ways: the unpaved surface preference. Not a separate kind of route.

**Pace**:
The user's flat-ground pace, in minutes per km (or per mile), 6 min/km until they set it.
It gives the estimated duration, and turns a target duration into a distance. It is set
under the duration and in the route list, and stored in their settings.
_Avoid_: Speed

**Effort distance**:
Distance plus climb converted to distance, at 100 m of elevation gain for 1 km. Without
an elevation gain, the distance alone. Estimated duration is effort distance times pace.
_Avoid_: Kilomètre-effort, adjusted distance

### Results

**Route**:
One generated loop, with its geometry, distance, elevation gain, surface breakdown, and estimated duration.
_Avoid_: Trace, track, itinerary, path

**Route name**:
The label of a route in its GPX export: the day of the export, the distance,
and the elevation gain when known, such as "28 sept. · 12,3 km · +340 m", in the
user's language and units. It never names where the route starts.
_Avoid_: Title

**Loop**:
A route that ends at its start point. The only route shape for now.
_Avoid_: Round trip, circuit

**Point-to-point route**:
A route that ends at a finish point other than its start point. Not offered yet.
_Avoid_: One-way, parcours, traversée

**Route set**:
The three to five routes generated for one set of criteria: matches first, then
suggestions. Routes are never saved, so a route set is gone when the user asks again or
leaves the app.
_Avoid_: Results, search results

**Match**:
A route whose distance (or estimated duration, when the user asked for a target duration)
and elevation gain (when known) are within the tolerances of the criteria. Surface
preference only affects ranking, never whether a route is a match.
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
The user's preferences kept on the device: pace, language (English or French,
the browser's until the user picks one), units, the last criteria (surface preference,
elevation gain, technical stretches, whether the length is a distance or a duration), and which POI categories the map shows. Lost if the user clears the site's data.
_Avoid_: Profile, account

### On the map

**Point of interest** (POI):
A useful place shown on the map wherever the user looks, whether or not a route passes
by it. Display only: POIs never change which routes are generated. Each belongs to one POI
category, which the user can show or hide.
_Avoid_: Marker, place, amenity

**Water point**:
A POI with drinking water. Seasonal ones are shown and marked as seasonal. Shown by default.
_Avoid_: Fountain (not every fountain has drinking water)

**Viewpoint**:
A POI with a view worth stopping for. Hidden by default.
_Avoid_: Panorama, summit
