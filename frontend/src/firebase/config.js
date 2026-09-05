import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDeIZxypW3lvmIAVRfehuQNh9Gq68yx-uY",

  authDomain: "e-farm-83698.firebaseapp.com",

  projectId: "e-farm-83698",

  storageBucket: "e-farm-83698.firebasestorage.app",

  messagingSenderId: "1049244418178",

  appId: "1:1049244418178:web:cada219be9a114c0a3f49b",

};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);