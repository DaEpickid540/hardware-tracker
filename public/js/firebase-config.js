// ============================================================
//  Firebase configuration
//  ------------------------------------------------------------
//  1. Go to https://console.firebase.google.com → create a project
//  2. Add a Web App (</>) → copy the config object below
//  3. In the console: Build → Authentication → Sign-in method →
//     enable "Google"
//  4. Build → Firestore Database → Create database (production mode)
//     then paste the rules from ../../firestore.rules
//  5. Replace the placeholder values below with your own.
// ============================================================

// ⚠️ TODO (personal-suite migration — see personal-suite/MIGRATION.md, Phase 2):
// Paste the NEW "personal-suite-hardware" web-app config here once you've created
// the personal-suite project and its Web App. Until then these are placeholders and
// the app will NOT connect. The collection layer (store.js) already targets the
// namespaced hw_* collections.
export const firebaseConfig = {
  apiKey:            "REPLACE_ME_personal_suite_hardware",
  authDomain:        "personal-suite.firebaseapp.com",
  projectId:         "personal-suite",
  storageBucket:     "personal-suite.firebasestorage.app",
  messagingSenderId: "REPLACE_ME",
  appId:             "REPLACE_ME",
  measurementId:     "REPLACE_ME",
};

// Previous project config (hardware-tracker-a99c6) — kept for reference/rollback only:
//   apiKey:            "AIzaSyBxHdtjP-GEiDYkMAR7hGv0SMd_Mgm8aWU"
//   authDomain:        "hardware-tracker-a99c6.firebaseapp.com"
//   projectId:         "hardware-tracker-a99c6"
//   storageBucket:     "hardware-tracker-a99c6.firebasestorage.app"
//   messagingSenderId: "4996237458"
//   appId:             "1:4996237458:web:07d5ecb052f0fcd644fe4b"
//   measurementId:     "G-HPJN6J3DZ6"

// This Firebase "apiKey" is NOT a secret — it only identifies your project.
// It is safe to commit. Access is controlled by Firestore security rules.
