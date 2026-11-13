Structural conventions for the React SPA in `frontend/`, served from the same jar as the API.

# SPA Architecture Standards

### Vite SPA, No SSR
React + Vite SPA with no server-side rendering. SSR frameworks (Next.js) are rejected: the app is an authenticated shell with no SEO use case, and the jar serves the built bundle as static files.

### Internationalization-Ready, English Default
All user-facing copy goes through i18n keys (no hardcoded strings in components). English is the default locale and Polish is the shipped translation. Every key exists in both `en` and `pl`; `frontend/src/i18n/i18n-keys.test.ts` fails on a missing key. Domain identifiers that are codes rather than words (role names in the contract, language codes) stay untranslated in data; only their display labels are translated.

### English URL Paths, Translated UI Copy
Route paths, path segments and query-parameter names are English (`/login`, `/tickets/:id`, `?next=`). All user-visible copy goes through i18n keys, so a Polish label can sit on an English path. The URL surface is a technical contract shared with the backend, deep links, tests and future locales; localising it makes routes untranslatable and couples them to a single locale.

### Plurals via i18next Plural Keys
Any user-facing string carrying a count must use i18next plural keys (`_one` / `_few` / `_many` / `_other`), never plain interpolation. Polish has three plural forms and the genitive plural takes a singular verb, so 1 and 5 share a form while 2 to 4 differ, exactly the case that gets missed. The rule is about grammatical agreement, not about numbers: a string with a number but no word that inflects with it (a label-colon-number) correctly stays plain interpolation, since plural keys there just yield identical strings. `i18n-keys.test.ts` accepts the un-suffixed base of a plural key, so key-coverage checks do not fight a correct plural family.

### A Link Inside a Sentence Goes Through `Trans`, Under a Tag Name That Is No HTML Element
When a translated sentence holds a link or emphasis, the whole sentence stays one key and the markup is a named tag in it, rendered with `<Trans components={{ … }}>` (the closed-ticket notice's `<newTicket>create a new ticket</newTicket>`), so each language orders its own words around the link. Name the tag after its role, never after an HTML element: i18next parses the string as HTML, and a void element's name (`link`, `br`, `img`, `input`, `hr`, `meta`) closes the tag at once, so the component renders empty and its words follow it as plain text. Nothing fails to compile or lint, and a text query still finds the sentence; only a test that queries the link by its role and name catches it.

### i18n Bundles Registered Centrally, Never by the Feature
Every translation namespace is registered in one place: `frontend/src/i18n/index.ts`, in the `resources` map passed to `init()`. A feature module never registers its own bundle, whether by `addResourceBundle` at module scope, a side-effect import, or a lazy import in the page that happens to use it. The failure mode is what makes this a rule rather than a preference: a component that reaches a namespace whose owning module it did not import renders **raw keys**: no exception, no console error, nothing a `tsc` run or a lint pass can see, and nothing an unrendered unit test exercises. Side-effect and type-only imports are the specific trap, because both are legitimately erased: a type-only import never emits, and a bare `import './x.ts'` looks exactly like the dead import an "unused imports" cleanup deletes. Registering everything at init also costs nothing here: the bundles are small and served from the same jar as the API, so per-feature splitting buys no load time and only reintroduces the hazard.

### TypeScript Strict Mode with Generated API Types
TypeScript strict mode is required; the OpenAPI-generated API types (`frontend/src/api/types.gen.ts`, from `docs/api/openapi.json`) are the single wire contract, never hand-written request/response types. Lint with oxlint, format with oxfmt.

### Enum-Keyed Maps Are Exhaustive Over the Type, and the Lookup Is Still Guarded
The direct continuation of the rule above, in two halves that must both hold. *Compile side*: derive a vocabulary type from the OpenAPI contract (`components['schemas'][...]['roles'][number]`), never hand-write it, and key every style/variant/label map as `Record<Enum, ...>` so a value the contract gains becomes a **compile error** instead of a silent fallback. A `?? MAP.SOME_MEMBER` fallback is valid code that simply chooses the wrong branch, invisible to `tsc` and to lint.

*Runtime side*: `Record<Enum, ...>` guarantees the **map**, not the **payload**. The values arrive as JSON, and a browser tab can be running a bundle older than the server that answered it after a deploy, so an unguarded `MAP[value].prop` throws and unmounts the page. Guarding the lookup is not a retreat from exhaustiveness; the compile-time map is what makes the guard reachable only by genuine version skew. The guard must be **visibly not one of the enum members** (render the raw value neutrally so the drift reports itself), never a silent default that impersonates a real member.

```ts
type Role = components['schemas']['SessionUser']['roles'][number]

// Exhaustive over the type: a new contract role fails to compile here.
const CHIP_STYLES: Record<Role, ChipStyle> = { /* ... */ }

// Deliberately not one of the members: a bundle older than the server renders
// the raw value neutrally instead of throwing, or impersonating a real role.
const UNKNOWN_ROLE_STYLE = { bg: 'bg.subtle', color: 'fg.subtle' }
const style = CHIP_STYLES[role] ?? UNKNOWN_ROLE_STYLE
```

### State Management Split
TanStack Query owns server state (the session, meta and every API read; mutations invalidate or set the affected queries). A list's filters and paging live in the URL's query string, under the API's parameter names, so reload, back and a shared link restore the same list; other client state is React local state (`useState`, `useReducer`) in the component that owns it. A draft that must survive leaving the page goes to `sessionStorage`, keyed by user and the thing it drafts (the comment composer's draft per user and ticket, `use-comment-draft.ts`). No global client store until a feature needs one.

Ticket writes on the ticket page go through `useTicketWrites`: an editor never calls a ticket mutation or keeps a refusal message of its own, so the refusal rules (a conflict per place until its Reload, one refusal message on the page) live in one module rather than in each editor.

A URL outlives the data it was written for: a ticket stops matching while it is open, a link is shared days later, a reader edits it by hand. So a list reads its URL defensively and writes it only on a real change:
- **Drop what the API would refuse** before the request (an unknown enum value, a malformed id, a page that is not a non-negative number), so an edited URL never turns into a 400.
- **A page past the end moves to the last page** (replacing the history entry), never shows the empty state next to an impossible range such as "21–20 of 20".
- **Any filter change returns to the first page, but a pick that changes nothing writes nothing**, so re-picking the current value or re-submitting the same search keeps the reader's page.

### A Failed Refetch Keeps What Is on Screen
A query that refetches in the background (on returning to the tab, after a write, on Try again) can fail while its earlier data is still cached. TanStack Query then sets `error` *and* keeps `data`, so a view that branches on `query.error` throws away a loaded page, and with it whatever the reader was typing, because of a passing network blip. Only a query that never loaded replaces its content with the failure: branch on `query.isLoadingError`, not on `query.error`. A refetch failure, if it is shown at all, sits beside the data it failed to refresh (a `ProblemText` with `onRetry`).

```tsx
if (ticket.isPending) return <Loading />
// Not `ticket.error`: that is also set when a refetch of a loaded ticket fails.
if (ticket.isLoadingError) return <LoadFailure error={ticket.error} onRetry={ticket.refetch} />
return <TicketView ticket={ticket.data} />
```

### Flat State, Derived Values in Render
Keep component state minimal and primitive; compute display values and handlers during render (useMemo/useCallback as needed). Never cache derived data in state.
