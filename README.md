```markdown
# Drugbattle

Ein kleines, text-/knopf-basiertes Multiplayer-Handelsspiel (fiktiv).  
Nur ein Spiel — keine Anleitung oder Förderung realer illegaler Handlungen.

Features:
- Socket.IO Echtzeit-Mehrspieler
- SQLite für Substanzliste & Highscores (lokal)
- Räume / Einstellungen pro Raum
- Einstellbare Siegbedingungen (Geldziel oder Zeitlimit)
- Docker + docker-compose Konfiguration

WICHTIG: Für Produktion empfehle ich, Frontend (statisch) auf Vercel zu hosten und den Socket.IO-Server auf einem Host mit dauerhaften Prozessen (Render, Railway, Fly.io, VPS, Docker-Server). Vercel ist nicht ideal für dauerhafte WebSocket-Server.

## Schnellstart (lokal)
1. Node.js (>=18) installieren
2. Repo klonen / Dateien ins Verzeichnis legen
3. Abhängigkeiten installieren:
   npm install
4. Server starten:
   npm start
5. Öffne im Browser: http://localhost:3000

Konfiguration über Umgebungsvariablen:
- PORT (Standard 3000)
- TICK_MS (Millisekunden zwischen Preis-Updates, Standard 1000)
- START_MONEY (Startkapital pro Spieler, Standard 1000)
- DB_FILE (Pfad zur SQLite DB, Standard ./data.db)

## Docker
Build & run:
docker compose up --build -d
Dann: http://localhost:3000

## Deployment-Empfehlung
- Frontend: Vercel (nur /public). In index.html den Socket-Server als Umgebungs-URL konfigurieren.
- Backend: Render, Railway, Fly.io oder ein eigener VPS / Docker-Server für Socket.IO (dauerhafte Prozesse nötig).
  - Setze Umgebungsvariablen (PORT, TICK_MS, START_MONEY).
  - Achte darauf, dass WebSocket-Verbindungen vom Provider unterstützt werden.

## Vercel Hinweis
- Du kannst das Verzeichnis `public/` als separates Projekt auf Vercel deployen (statische Dateien).
- Setze in der Vercel-Umgebung die Variable `REACT_APP_SERVER_URL` oder ähnliches (bei uns heisst die Option `window.SERVER_URL` - siehe public/index.html).
- Den Backend-Server deploye separat (Rails/Render/Heroku/Render) und setze die URL in der Frontend-Konfiguration.

## Dateien
- server.js (Node + Socket.IO + SQLite)
- public/ (Frontend)
- Dockerfile, docker-compose.yml, README.md

Wenn du willst, helfe ich dir beim Anlegen des GitHub-Repos oder bei der Einrichtung auf Railway/Render. Ich kann das Repo nicht automatisch für dich anlegen/pushen, aber ich kann jeden Schritt anleiten oder die Dateien per ZIP bereitstellen.
```
