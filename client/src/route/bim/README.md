# Building Models

A route that opens an IFC building model from the signed-in user's library,
draws it, and colours it by whatever the sensors in it are reading.

## What Lives Here and What Does Not

One file, `Bim.tsx`, forty-eight lines including its comments. It is an adapter
and nothing else: it puts the DTaaS layout around the page and hands it the
library URL.

The page itself comes from `@into-cps-association/bim-kit`, a package
maintained in the [ifc-utils](https://github.com/INTO-CPS-Association/ifc-utils)
repository. The IFC file is converted to geometry in the browser by that same
package, at its `./converter` entry point, so nothing is installed beside
DTaaS and no separate service runs.

The reason for the split is release cadence. A change to how a model is drawn,
to the markers, or to how a sensor manifest is read is a version of that
package. It reaches a DTaaS install as a dependency bump and never as a pull
request against this repository.

## The Whole Diff Against the Target Branch

Branched from `feature/distributed-demo`, which is the repository's default
branch and the one pull requests are opened against. The `release-v1.0` branch
is thirty commits behind it, so a branch cut from that release cannot be merged
without being moved first.

Eighteen lines added and one changed, across four of their files, plus files of
our own that stand alone.

| File                            | Lines | What                                                                |
| ------------------------------- | ----- | ------------------------------------------------------------------- |
| `client/src/routes.tsx`         | +9    | The import and the route object, behind `PrivateRoute`              |
| `client/package.json`           | +5    | The two packages, `three`, and `@types/three`                       |
| `client/src/page/MenuItems.tsx` | +2    | The import and the menu entry, at index 3                           |
| `client/jest.config.json`       | +2 -1 | The viewer mapped to a stub, beside the same arrangement for `uuid` |

Everything else added is one directory, `client/src/route/bim/`, following the
shape their other routes use, and two test files in the places their test tree
already puts them: `client/test/__mocks__/bimViewerMock.tsx` and
`client/test/unit/routes/Bim.test.tsx`.

Nothing else of ours is in the tree. What is needed to run this here and nowhere
else is not versioned, and the `.gitignore` entries say which: the tarball
directory, and a Compose override file.

No source file of theirs outside that table differs from the target branch by a
byte, `README.md` included.

## Where This Meets the Interface Redesign

Pull request 1765 redesigns the client and is open against the same branch. The
two overlap in four files, and none of that overlap is duplicated work: each
changes different lines for different reasons, and whichever merges second
resolves a textual conflict.

| File                            | What 1765 does                                                      | What this does                         |
| ------------------------------- | ------------------------------------------------------------------- | -------------------------------------- |
| `client/src/routes.tsx`         | Adds a catch-all route for unknown paths                            | Adds the `bim` route                   |
| `client/src/page/MenuItems.tsx` | Replaces the three icons with a named module, `components/appIcons` | Adds a fourth entry, at index 3        |
| `client/package.json`           | Adds `@fontsource/inter`                                            | Adds the two BIM packages and three.js |
| `client/yarn.lock`              | The resolved tree for the above                                     | The resolved tree for the above        |

Nothing from 1765 is copied here, and nothing here belongs in 1765. Two things
follow from that, and both are left for after both have merged.

**The menu icon.** This branch imports `ViewInArIcon` straight from
`@mui/icons-material`, because `components/appIcons` does not exist on the
target branch yet. Once 1765 merges, the menu would carry three icons from that
module and one raw import, which is the inconsistency the module exists to
prevent. The fix is two lines: export a `BuildingModelsIcon` from `appIcons` and
use it here.

**The page frame.** 1765 introduces `PageShell`, which gives every page one
heading and one surface, so that no page invents its own. This page has no
heading at all today, which is why it does not conflict. Once 1765 merges it
would be the only page without one. The fix is wrapping the viewer in
`PageShell` with a title and a description, and it changes nothing else, because
this route deliberately holds no colour, spacing or typography of its own.

## How the Page Finds a Model

The route asks for the user's library URL through `useURLforLIB`, which is the
same call Library and Digital Twins make, and hands it to the viewer. The viewer
lists what is in `common/models`, so a person uploads an IFC there the way they
upload anything else and it appears in the picker. No path, host, or user name
is written in this code.

A model may sit beside a `.manifest.json` naming which object each sensor is
attached to and which MQTT topic it publishes on. When one is present the viewer
binds the readings to the geometry. When it is absent the model still opens,
with no sensors, which is the ordinary case for a file that has just been
uploaded.

With readings arriving, the heatmap groups them four ways: per sensor, per room,
per floor and over the whole building. A scope is offered when it puts the
sensors in more than one group, so a model declaring ten storeys with all its
sensors on one of them is not offered Per Floor, which would paint the building
one colour. Per Sensor is the one that says something on an architectural model:
it rasterises the floor, floods outwards from each sensor through open cells,
and draws the result as a sheet over the floor. Walls stop it and doors let it
through, so a sensor colours its own room and not the office next door.

## Running It Locally

Two steps, and both stop being needed once an image carries the route. The viewer comes from `@into-cps-association/bim-kit` on npmjs, pinned to an exact version in `client/package.json`, so `yarn install` fetches it like any other dependency.

**Build the client.**

```sh
cd client
yarn install
yarn build && yarn config:local
```

**Serve that build.** The deployment runs the published `intocps/dtaas-web`
image, which does not carry this route, so the build has to be mounted over it.
Compose reads a file called `docker-compose.override.yml` beside
`docker-compose.yml` automatically, so write one in
`deploy/dtaas/docker/localhost` naming this machine's build directory, and start
the stack with no flags:

```sh
docker compose -p dtaas up -d
```

That file is not versioned, because it names a path on one machine. Their own
compose file is untouched.

## The Deployment's User Name Has to Be the One That Signs In

`DEFAULT_USER` in the deployment's `.env` decides which workspace container is
started and which path Traefik routes to it. The name the page asks for comes
from somewhere else entirely: the identity provider, through the OIDC profile.

When the two differ, nothing reports an error. The request for the library
simply stops matching the workspace route, falls through to the client's
`PathPrefix(/)`, and the React application answers with its own page and
HTTP 200. Library shows a 404 inside its frame and Building Models says the
library returned a web page. Both are downstream of one line of
configuration.

This has already cost time once, with `DEFAULT_USER=jady.pamella` against a
GitLab account named `jadypamella`. To check a deployment in one command, with
the stack up:

```sh
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  "http://localhost/$(grep DEFAULT_USER .env | cut -d= -f2)/api/contents/common"
```

`200 application/json` is right. `200 text/html` means the name is wrong: it is
being served by the client instead of by the workspace. The name to use is the
last segment of the profile URL the identity provider returns, which is what the
client itself uses to build the address.

## Against the Criteria in Issue 1762

Measured on this branch, not recalled. The user-facing half of the
documentation is `docs/user/website/bim.md`.

| Criterion                                                           | State                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Manifest schema validated with zod, clear errors                    | Done. An error names `bindings[3].display.ramp` and says why                                |
| GLB or OBJ renders in a lazy route, outside the main chunk          | Done for GLB. See below for OBJ                                                             |
| Markers resolve by `globalId` and `nodeName`, show live MQTT values | Resolver done. Live values are open, see below                                              |
| Clicking a marker opens the Grafana panel                           | Not built. The manifest already carries the `history` block the address would be built from |
| IFC viewable end to end, conversion documented                      | Done. Conversion runs in the browser and is documented                                      |
| WASM and workers from the DTaaS origin, works offline               | Done. A production build contains no `.wasm` file and fetches none                          |
| Derived artifacts record source hash and converter version          | Done. The schema refuses a manifest without them                                            |
| Documentation under `docs/`                                         | Done                                                                                        |
| Unit tests for manifest and resolver, Playwright for the route      | Done. 159 unit tests in the package, 5 for this route, 4 Playwright tests                   |
| No qlty issues                                                      | Not run. See below                                                                          |

Three of those need a sentence instead of a word.

**OBJ is deliberately out.** The binding key is the IFC `GlobalId`, and glTF
carries it per node in `extras`. OBJ has no equivalent field, so a marker on an
OBJ model can resolve only by node name, and the resolver refuses a name two
objects share instead of guessing. Supporting OBJ would deliver the half of the
contract the manifest exists to prevent.

**Live values are not settled.** The viewer subscribes to nothing and draws
whatever readings it is handed, which is what lets the same component serve a
local demonstration and a platform deployment. Whether the client subscribes to
RabbitMQ over WebSocket, or a platform service does it and serves the latest
value, is an open question with Prasad Talasila and is recorded in
`docs/user/website/bim.md`.

**qlty was not run.** The tool is distributed by a shell installer and is
present in neither Homebrew nor npm, and this machine's rules forbid installing
from a piped script. The criterion is checked by Qlty Cloud on the pull request
itself, which is where it belongs. Reported here as not run, never as passed.

## Security Notes

The route is behind `PrivateRoute`, like every page that reads a user's files.

Model conversion happens in the browser, in WebAssembly, against a file the
signed-in user already has access to. No new server-side endpoint exists: the
route reads and writes through the workspace's own Jupyter Contents API, which
the Library page already uses.

The route does write. When a model has no geometry beside it, the conversion
produced in the browser is written back as a `.glb` next to the `.ifc`, so the
next visit loads a file instead of converting again. That is the one
state-changing thing on this page, and `persistGeometry.ts` is where all of it
lives. What bounds it:

- The destination is derived from the model's own path and then checked: it has
  to be a single file directly inside `common/models`, with no `..` and no
  leading slash. The path comes from a listing the workspace returned, so it is
  not user input today, and the check is there for the day something else feeds
  that function.
- An address that already holds a file is left alone, so a geometry produced
  outside the browser is never replaced by one produced inside it.
- The request is credentialed, and the address it goes to is assembled by the
  application from its own deployment configuration and the signed-in user name.
  That is what makes sending credentials to it acceptable.

One deployment assumption is load-bearing. The Jupyter server guards writes with
a token it sets as the `_xsrf` cookie and expects echoed in a header. The
workspace image this runs against sets no such cookie and accepts the write, so
the token is sent when present and left out when it is not. On a workspace that
does enable that protection the cookie is `HttpOnly`, script cannot read it, and
every write here is refused. That failure costs a reconversion and nothing else,
and it is written to the browser console so the deployment does not look like
one where the feature works.

The GitLab application id used for sign-in is deployment configuration and stays
in the deployment's own `config/client.js`, which is gitignored. It is not a
secret (it is compiled into the JavaScript any visitor downloads), but it
differs per install and does not belong in source.
