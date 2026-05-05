const fs = require('fs');
let code = fs.readFileSync('frontend/src/App.jsx', 'utf8');

// The original strings to replace:
// 1. QR Code Loader
code = code.replace(
  /<div className="loadingSpinnerContainer" aria-busy="true">\s*<div className="largeSpinner" aria-hidden="true"><\/div>\s*<p className="helperText" aria-live="polite">Generando código QR\.\.\.<\/p>\s*<\/div>/g,
  `<div className="loadingSpinnerContainer" aria-busy="true" aria-live="polite">
                  <div className="largeSpinner" aria-hidden="true"></div>
                  <p className="helperText">Generando código QR...</p>
                </div>`
);

// 2. Connecting Loader
code = code.replace(
  /<div className="loadingSpinnerContainer" aria-busy="true">\s*<div className="largeSpinner" aria-hidden="true"><\/div>\s*<p className="helperText" aria-live="polite">Sincronizando mensajes y contactos\.\.\.<\/p>\s*<\/div>/g,
  `<div className="loadingSpinnerContainer" aria-busy="true" aria-live="polite">
              <div className="largeSpinner" aria-hidden="true"></div>
              <p className="helperText">Sincronizando mensajes y contactos...</p>
            </div>`
);


// 3. Not Connected Reconnecting Loader
code = code.replace(
  /<div className="loadingSpinnerContainer" aria-live="assertive" aria-busy="true">\s*<div className="largeSpinner warningSpinner" aria-hidden="true"><\/div>\s*<p className="helperText errorText" role="alert">Reconectando con el servidor\.\.\.<\/p>\s*<\/div>/g,
  `<div className="loadingSpinnerContainer" aria-busy="true" aria-live="assertive">
                <div className="largeSpinner warningSpinner" aria-hidden="true"></div>
                <p className="helperText errorText">Reconectando con el servidor...</p>
             </div>`
);

fs.writeFileSync('frontend/src/App.jsx', code);
