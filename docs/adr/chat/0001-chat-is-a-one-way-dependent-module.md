# The chat is a module the rest of the app does not know about

The chat lives in its own package `app.retrofit.chat` and in `frontend/src/features/chat`, with its own changelog files and i18n bundle. It depends on the rest of the app: it looks up the signed-in user through `CallerLookup` and reads the names of the caller's organizations and teams through `OrganizationAccess` for its context block (chat ADR 0008). Nothing outside the chat imports from it. The app has to build and run with the chat removed, so the chat is an optional feature on top of the ticket app. With a one-way dependency, the chat's whole footprint is its own folders plus a short list of seams where the app registers it:

- the panel slot and its toggle button in the SPA's `AppShell` (chat ADR 0006)
- the `/settings` route in `router.tsx` and the Settings link, shown to support staff only, in the SPA's `AppShell` (chat ADR 0015)
- the `/api/chat/settings` matcher in `SecurityConfig`, which allows support staff only
- the i18n bundle registration, and the bundle in the en/pl key-parity test
- the Markdown renderer dependency in `frontend/package.json`
- the header building of the SPA's `api/client.ts` (CSRF header), extracted from `api()` into an exported function so the chat's stream reuses it (chat ADR 0004)
- a `ref` prop on the shared `FieldTextarea` (`frontend/src/components/ui/form-field.tsx`), a general capability for any form that moves focus to its text area; the chat's panel focuses its question with it
- the Spring AI and tracing dependencies in `pom.xml` (chat ADR 0007)
- the LLM proxy and the tracing backend in `compose.yaml`
- the chat and tracing keys in `application.yml`
- the public read API of `organization` (`OrganizationAccess`, `Organization`, `Team`, `TeamMember`, `CallerLookup`), made public on the lesson branch because the chat is their only caller outside their package

A new seam goes on this list. If the chat needs something from the base that also makes sense without the chat, the base gets it as a general capability, and the chat does not reach into the base's internals.

## Considered Options

- **Chat code spread across the existing feature packages** (chat endpoints in `ticket`, chat UI in the app shell). This was rejected because the chat would no longer be one removable unit, and every change to the base would risk touching chat code.
