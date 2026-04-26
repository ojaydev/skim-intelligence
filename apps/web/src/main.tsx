import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { App } from "./App";
import "./index.css";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const root = ReactDOM.createRoot(document.getElementById("root")!);

if (!PUBLISHABLE_KEY) {
  // Dashboard still works without Clerk — only wallet features are gated.
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} else {
  root.render(
    <React.StrictMode>
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
        <App />
      </ClerkProvider>
    </React.StrictMode>,
  );
}
