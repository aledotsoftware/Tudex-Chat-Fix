const fs = require('fs');
let code = fs.readFileSync('frontend/src/App.jsx', 'utf8');

// Fixing generic loader
code = code.replace(
  /<div className="loadingSpinnerContainer" aria-busy="true">\s*<div className="largeSpinner" aria-hidden="true"><\/div>\s*<p className="helperText" aria-live="polite">Generando código QR\.\.\.<\/p>/g,
  '<div className="loadingSpinnerContainer" aria-busy="true" aria-live="polite">\n                  <div className="largeSpinner" aria-hidden="true"></div>\n                  <p className="helperText">Generando código QR...</p>'
);

// Specifically fix the assertive one for reconecting
code = code.replace(
  /<div className="loadingSpinnerContainer" aria-live="assertive" aria-busy="true">\s*<div className="largeSpinner warningSpinner" aria-hidden="true"><\/div>\s*<p className="helperText errorText" role="alert">Reconectando con el servidor\.\.\.<\/p>/g,
  '<div className="loadingSpinnerContainer" aria-busy="true" aria-live="assertive">\n                <div className="largeSpinner warningSpinner" aria-hidden="true"></div>\n                <p className="helperText errorText">Reconectando con el servidor...</p>'
);


// Fixing syncing chat loading spinner
code = code.replace(
  /<div className="loadingSpinnerContainer" aria-busy="true">\s*<div className="largeSpinner" aria-hidden="true"><\/div>\s*<p className="helperText" aria-live="polite">Sincronizando mensajes y contactos\.\.\.<\/p>/g,
  '<div className="loadingSpinnerContainer" aria-busy="true" aria-live="polite">\n              <div className="largeSpinner" aria-hidden="true"></div>\n              <p className="helperText">Sincronizando mensajes y contactos...</p>'
);

fs.writeFileSync('frontend/src/App.jsx', code);
