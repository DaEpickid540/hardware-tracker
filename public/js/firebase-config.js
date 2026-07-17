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

// personal-suite consolidation — points at the shared project personal-suite-ca587
// (hardware-tracker Web App). The collection layer (store.js) targets the
// namespaced hw_* collections. apiKey is not a secret — safe to commit.
export const firebaseConfig = {
  apiKey:            "AIzaSyAtRLYEN30W1eL4EwiRGN4x_oOzI-HlJZQ",
  authDomain:        "personal-suite-ca587.firebaseapp.com",
  projectId:         "personal-suite-ca587",
  storageBucket:     "personal-suite-ca587.firebasestorage.app",
  messagingSenderId: "894530323591",
  appId:             "1:894530323591:web:5abe5929c3554e6afc6422",
  measurementId:     "G-FK4JCT57MK",
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
