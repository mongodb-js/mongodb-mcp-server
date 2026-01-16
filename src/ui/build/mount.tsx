/// <reference types="vite/client" />
import "../styles/fonts.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { components } from "./components.generated.js";

function mount(): void {
    const container = document.getElementById("root");
    if (!container) {
        console.error("[mount] No #root element found");
        return;
    }

    const componentName = container.dataset.component;
    if (!componentName) {
        console.error("[mount] No data-component attribute found on #root");
        return;
    }

    const Component = components[componentName];
    if (!Component) {
        console.error(`[mount] Unknown component: ${componentName}`);
        console.error(`[mount] Available components: ${Object.keys(components).join(", ")}`);
        return;
    }

    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            <Component />
        </React.StrictMode>
    );
}

mount();
