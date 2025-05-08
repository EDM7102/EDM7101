# EDMBOOK Chat & Teilen App

Dies ist eine Echtzeit-Chat-Anwendung mit Sprachkommunikation (Audio) und optionalem Bildschirmteilen, entwickelt mit Node.js, Express und Socket.IO, sowie WebRTC für die Medienströme.

## Features

- Text-Chat in Räumen
- Sprach-Chat (Gruppen-Telefonie)
- Benutzerliste mit Anzeige, wer online ist
- Tipp-Indikator
- Bildschirmteilung (andere Benutzer können den Bildschirm auf Klick ansehen)
- Lokale Stummschaltung des Mikrofons
- Lokale Stummschaltung der Audio-Streams anderer Benutzer
- Sound-Benachrichtigungen bei neuen Nachrichten und Benutzer-Joins
- Speicherung des Benutzernamens im lokalen Speicher

## Installation

1.  Klone dieses Repository oder lade die Dateien herunter und lege sie in einem Ordner ab.
2.  Navigiere im Terminal zu diesem Ordner.
3.  Stelle sicher, dass Node.js und npm installiert sind.
4.  Installiere die Abhängigkeiten:

    ```bash
    npm install
    ```

## Ausführung

Starte den Server:

```bash
npm start
