# Visual page builder (`builder/`)

The drag-and-drop page editor for Therum CMS 2.0. Vite 8 + React 19. Built to
static assets that the **backend** serves at `/builder/` — it is not deployed as
its own server. Part of the [Therum CMS 2.0](../README.md) product.

## How it fits

- The editor authors a page's canvas and posts the result back to the backend's
  content API; the admin opens it with the operator's own edit token in the URL.
- Because the backend serves the built output on the same origin, there is no
  separate host, cookie, or CORS surface for it.

## Develop

```bash
npm install
npm run dev     # http://localhost:5174
npm run build   # emits static assets the backend serves at /builder/
```

## Layout

```
src/components/   editor UI
src/extensions/   element/block definitions
src/store/        editor state
src/lib/          helpers
test/             builder tests (node --test)
```
