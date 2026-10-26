# Buscando Chamba

Juego multijugador de 2 personas. Un jugador crea una sala y recibe un código de 5 caracteres; el otro se une con ese código. Los dos recorren una oficina buscando solicitudes de empleo (hojas) y las entregan en su casillero. Gana quien tenga más solicitudes guardadas a los 2 minutos.

**Controles:** WASD o flechas (en celular, desliza el dedo). Mochila: máximo 5 solicitudes. Entrega acercándote a tu casillero.

## Probar en tu computadora
Requiere Node.js 18 o superior.

    npm install
    npm start

Abre http://localhost:3000 en dos pestañas (o dos dispositivos en la misma red con la IP de tu equipo).

## Subirlo a internet (necesita un servidor Node, no sirve GitHub Pages)
1. Sube esta carpeta a un repositorio de GitHub (sin `node_modules`).
2. En https://render.com crea un **Web Service** desde ese repositorio.
   - Build command: `npm install`
   - Start command: `npm start`
   - (o usa `render.yaml` con "New > Blueprint")
3. Render te da una URL `https://...onrender.com`. Compártela: ahí se juega con WebSocket seguro.

Railway, Fly.io o cualquier hosting Node funcionan igual (el servidor usa la variable `PORT`).
Nota: los planes gratuitos se duermen; la primera conexión puede tardar unos segundos.

## Pruebas
    node test/bots.js      # bots por WebSocket (reglas, anti-trampas, rondas completas)
