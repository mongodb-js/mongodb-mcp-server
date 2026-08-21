/// <reference types="vite/client" />
import "../styles/fonts.css";
import React from "react";
import { createRoot } from "react-dom/client";

// Type for component modules loaded via glob import
type ComponentModule = Record<string, React.ComponentType>;

// Auto-import all components using Vite's glob import
// Each component folder must have an index.ts that exports the component as a named export matching the folder name
const componentModules: Record<string, ComponentModule> = import.meta.glob("../components/*/index.ts", {
    eager: true,
});

// Build component registry from glob imports
// Extracts component name from path: "../components/ListDatabases/index.ts" -> "ListDatabases"
const components: Record<string, React.ComponentType> = {};

for (const [path, module] of Object.entries(componentModules)) {
    const match = path.match(/\.\.\/components\/([^/]+)\/index\.ts$/);
    if (match) {
        const componentName = match[1];
        if (!componentName) continue;
        // The component should be exported with the same name as the folder
        const Component = module[componentName];
        if (Component) {
            components[componentName] = Component;
        } else {
            console.warn(
                `[mount] Component "${componentName}" not found in ${path}. ` +
                    `Make sure to export it as: export { ${componentName} } from "./${componentName}.js"`
            );
        }
    }
}

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
