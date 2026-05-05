const fs = require('fs');
let css = fs.readFileSync('frontend/src/App.css', 'utf8');

css = css.replace(
  /\.buttonSpinner \{\s*width: 16px;\s*height: 16px;\s*border: 2px solid var\(--border-light\);\s*border-top-color: var\(--accent-primary\);\s*border-radius: 50%;/g,
  '.buttonSpinner {\n  width: 16px;\n  height: 16px;\n  border: 2px solid rgba(255, 255, 255, 0.3);\n  border-top-color: #ffffff;\n  border-radius: 50%;'
);

if (!css.includes('.passwordToggleBtn:focus-visible')) {
  css = css.replace(
    /\.passwordToggleBtn \{\s*position: absolute;/,
    '.passwordToggleBtn:focus-visible {\n  outline: 3px solid var(--border-focus);\n  outline-offset: 2px;\n  background: rgba(255, 255, 255, 0.1);\n}\n\n.passwordToggleBtn {\n  position: absolute;'
  );
}

fs.writeFileSync('frontend/src/App.css', css);
