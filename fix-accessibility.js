const fs = require('fs');
let code = fs.readFileSync('frontend/src/App.jsx', 'utf8');

// Fixing loading spinner containers to avoid nested aria-live or conflicting ones
code = code.replace(
  /<div className="loadingSpinnerContainer" aria-busy="true">\s*<div className="largeSpinner" aria-hidden="true"><\/div>\s*<p className="helperText" aria-live="polite">/g,
  '<div className="loadingSpinnerContainer" aria-busy="true" aria-live="polite">\n                  <div className="largeSpinner" aria-hidden="true"></div>\n                  <p className="helperText">'
);

// Specifically fix the assertive one for reconecting
code = code.replace(
  /<div className="loadingSpinnerContainer" aria-live="assertive" aria-busy="true">\s*<div className="largeSpinner warningSpinner" aria-hidden="true"><\/div>\s*<p className="helperText errorText" role="alert">/g,
  '<div className="loadingSpinnerContainer" aria-busy="true" aria-live="assertive">\n                <div className="largeSpinner warningSpinner" aria-hidden="true"></div>\n                <p className="helperText errorText">'
);


// Fixing syncing chat loading spinner
code = code.replace(
  /<div className="loadingSpinnerContainer" aria-busy="true">\s*<div className="largeSpinner" aria-hidden="true"><\/div>\s*<p className="helperText" aria-live="polite">Sincronizando mensajes y contactos\.\.\.<\/p>/g,
  '<div className="loadingSpinnerContainer" aria-busy="true" aria-live="polite">\n              <div className="largeSpinner" aria-hidden="true"></div>\n              <p className="helperText">Sincronizando mensajes y contactos...</p>'
);

// Fixing technical inputs attributes
code = code.replace(/<input\s+id="apiKeyInput"([\s\S]*?)onKeyDown/g, '<input\n              id="apiKeyInput"$1spellCheck="false"\n              autoComplete="off"\n              autoCorrect="off"\n              autoCapitalize="none"\n              onKeyDown');

// Cloudflare ID and Token inputs
code = code.replace(/<input\s+id="cfAccountId"([\s\S]*?)onChange/g, '<input\n                  id="cfAccountId"$1spellCheck="false"\n                  autoComplete="off"\n                  autoCorrect="off"\n                  autoCapitalize="none"\n                  onChange');

code = code.replace(/<input\s+id="cfApiToken"([\s\S]*?)onChange/g, '<input\n                    id="cfApiToken"$1spellCheck="false"\n                    autoComplete="off"\n                    autoCorrect="off"\n                    autoCapitalize="none"\n                    onChange');

// CF base url
code = code.replace(/<input\s+id="cfBaseUrl"([\s\S]*?)onChange/g, '<input\n                  id="cfBaseUrl"$1spellCheck="false"\n                  autoComplete="off"\n                  autoCorrect="off"\n                  autoCapitalize="none"\n                  onChange');

// LM Studio URL
code = code.replace(/<input\s+id="lmStudioBaseUrl"([\s\S]*?)onChange/g, '<input\n                  id="lmStudioBaseUrl"$1spellCheck="false"\n                  autoComplete="off"\n                  autoCorrect="off"\n                  autoCapitalize="none"\n                  onChange');

// AI Model
code = code.replace(/<input\s+id="aiModelInput"([\s\S]*?)onChange/g, '<input\n              id="aiModelInput"$1spellCheck="false"\n              autoComplete="off"\n              autoCorrect="off"\n              autoCapitalize="none"\n              onChange');

// Button Show Password ARIA Pressed
code = code.replace(/<button\s+type="button"\s+className="passwordToggleBtn"\s+onClick=\{[^}]+\}\s+aria-label=\{[^}]+\}\s*>\s*\{showApiKey \? "🙈" : "👁️"\}\s*<\/button>/g, (match) => {
    return match.replace(/className="passwordToggleBtn"/, 'className="passwordToggleBtn" aria-pressed={showApiKey}');
});

code = code.replace(/<button\s+type="button"\s+className="passwordToggleBtn"\s+onClick=\{[^}]+\}\s+aria-label=\{[^}]+\}\s*>\s*\{showCloudflareToken \? "🙈" : "👁️"\}\s*<\/button>/g, (match) => {
    return match.replace(/className="passwordToggleBtn"/, 'className="passwordToggleBtn" aria-pressed={showCloudflareToken}');
});

fs.writeFileSync('frontend/src/App.jsx', code);
