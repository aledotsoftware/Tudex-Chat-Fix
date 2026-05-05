#!/bin/bash
# Apply some modifications using sed
sed -i 's/<div className="loadingSpinnerContainer" aria-live="assertive" aria-busy="true">/<div className="loadingSpinnerContainer" aria-busy="true">/g' frontend/src/App.jsx
sed -i 's/<div className="loadingSpinnerContainer" aria-busy="true">/<div className="loadingSpinnerContainer" aria-busy="true" aria-live="polite">/g' frontend/src/App.jsx
sed -i 's/<p className="helperText" aria-live="polite">/<p className="helperText">/g' frontend/src/App.jsx
