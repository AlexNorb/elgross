(async function() {
    
    const correctHash = "0d2ae312a745d204ad6589324bdd7bde1e29ce38e6cbd64d4fa3675f41d3bef9";
    const storageKey = "access";

    // 2. Dölj hela sidan omedelbart så inget syns
    const style = document.createElement('style');
    style.innerHTML = 'html { display: none; }';
    document.head.appendChild(style);

    // 3. Hjälpfunktion för att räkna ut hash
    async function sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // 4. Huvudfunktion
    async function checkAccess() {
        // Om vi redan har slagit in rätt kod tidigare
        if (localStorage.getItem(storageKey) === "true") {
            style.innerHTML = 'html { display: block; }'; // Visa sidan
            return;
        }

        // Loopa tills rätt lösenord anges
        while (true) {
            const password = prompt("Sidan är skyddad. Ange lösenord:");
            
            // Om användaren trycker "Avbryt"
            if (password === null) {
                document.body.innerHTML = "<div style='display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;'><h1>Åtkomst nekad</h1></div>";
                style.innerHTML = 'html { display: block; }';
                return;
            }

            const hash = await sha256(password);

            if (hash === correctHash) {
                localStorage.setItem(storageKey, "true");
                style.innerHTML = 'html { display: block; }'; // Visa sidan
                break;
            } else {
                alert("Fel lösenord. Försök igen.");
            }
        }
    }

    // Kör igång direkt
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkAccess);
    } else {
        checkAccess();
    }
})();
