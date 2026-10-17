# 🪜 Leiterlispiel Online

Leiterlispiel (Leiterspiel / Snakes & Ladders) für bis zu 6 Spieler – direkt im Browser.

**▶ Spielen:** https://timonbi97-gif.github.io/leiterlispiel/

## Modi
- **Spiel hosten** – du bekommst einen 5-stelligen Code (oder einen Link). Alle, die den Code kennen, können beitreten.
- **Öffentliche Lobbys** – 8 offene Lobbys, in denen du mit anderen Leuten spielst. Eine leere Lobby anklicken = du wirst Host.
- **Schnellspiel** – springt automatisch in die beste offene Lobby.
- **Bots** – der Host kann Bots hinzufügen (sie machen automatisch Platz, wenn echte Spieler beitreten).

## Spielbretter
- **🗺️ Abenteuer** – klassisches Brett plus 18 Spezialfelder
- **🎲 Zufall** – jede Runde ein neues, zufällig erzeugtes Brett
- **🪜 Klassisch pur** – nur Hoch & Runter

## Spezialfelder
| Feld | Wirkung |
|---|---|
| ⭐ Bonus | Nochmal würfeln |
| 💨 Vorwärts | 3 Felder vor (kann Kettenreaktionen auslösen!) |
| 🌬️ Zurück | 3 Felder zurück |
| ⛈️ Aussetzen | Nächste Runde aussetzen |
| 🌀 Portal | Teleport zum anderen Portal |
| 🎁 Überraschung | Zufällig: Bonus, +3, +5, −3, Schild, Aussetzen oder **Platztausch** mit einem Mitspieler |
| 🪂 Schild | Schützt einmal vor dem nächsten Absturz |

Die Symbole und Namen passen sich dem Thema an (z.B. ✈️ Rückenwind, 🐬 Delfin-Ritt, ☄️ Komet …).
Mit der Maus über ein Feld fahren zeigt, was es macht.

## Themen
| Thema | Hoch | Runter |
|---|---|---|
| ✈️ Flugzeuge | Aufwind | Turbulenz |
| 🐍 Klassisch | Leiter | Schlange |
| 🚀 Weltraum | Raketen-Boost | Schwarzes Loch |
| 🐙 Unterwasser | Luftblasen | Krake |

## Regeln
- Wer eine 6 würfelt, darf nochmal.
- Genau auf 100 landen – sonst prallt man zurück.
- Wer 30 Sekunden nicht würfelt, würfelt automatisch.

## Technik
Reines HTML/CSS/JavaScript (`themes.js` zeichnet das Brett, `game.js` enthält Spiel und Netzwerk) ohne Build-Schritt, gehostet auf GitHub Pages.
Multiplayer läuft Peer-to-Peer über [PeerJS](https://peerjs.com/) (WebRTC): Der Host-Browser ist der „Server“,
würfelt und schickt den Spielzustand an alle. Wenn der Host das Spiel verlässt, endet die Runde.
