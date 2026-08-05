// Replace these with your Firebase project credentials
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAzSlk-rvcQiOqI5pSqWAJXGpEvasCBo-s",
  authDomain: "book-house-ee2d6.firebaseapp.com",
  projectId: "book-house-ee2d6",
  storageBucket: "book-house-ee2d6.firebasestorage.app",
  messagingSenderId: "751755650288",
  appId: "1:751755650288:web:c7c4bc87980dd9a7b40e35",
  measurementId: "G-BBYXXNBPL9"
};

// Initialize Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

console.log('Firebase initialized successfully');
