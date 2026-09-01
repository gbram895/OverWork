# OverWork

A small app for registering and tracking your overtime hours.

- **Backend**: Express + TypeScript + SQLite (`server/`)
- **Frontend**: React + TypeScript + Vite (`client/`)

## Setup

```bash
npm install
```

This installs dependencies for both the `server` and `client` workspaces.

## Run in development

```bash
npm run dev
```

This starts the API server on [http://localhost:3001](http://localhost:3001) and the web app on [http://localhost:5173](http://localhost:5173). The web app proxies `/api` requests to the server, so just open the client URL in your browser.

Data is stored in a local SQLite file at `server/data/overwork.sqlite` (created automatically on first run).

## Features

- Log an overtime entry: date, hours, and an optional reason
- Edit or delete existing entries
- See total overtime hours and entry count at a glance

## API

| Method | Path                | Description                          |
| ------ | ------------------- | ------------------------------------ |
| GET    | `/api/overtime`      | List all entries (supports `?from=&to=` date filters) |
| GET    | `/api/overtime/summary` | Total hours and entry count       |
| POST   | `/api/overtime`      | Create an entry `{ date, hours, reason }` |
| PUT    | `/api/overtime/:id`  | Update an entry                      |
| DELETE | `/api/overtime/:id`  | Delete an entry                      |

## Build for production

```bash
npm run build
```

Then run the server with `npm run start -w server` (serves the API on port 3001; serve the built client from `client/dist` with any static file host).

## Automatic logging

Want overtime logged without touching a form? See [`automation/`](./automation) for
an iPhone Shortcuts + Google Sheets setup that logs it automatically when you
arrive at or leave work.
